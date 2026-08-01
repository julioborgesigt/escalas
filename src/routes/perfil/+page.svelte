<script lang="ts">
	/**
	 * "Meu perfil" — o que o próprio policial vê e pode mudar sobre si.
	 *
	 * A distinção central: o policial NÃO edita o próprio cadastro. Telefone,
	 * classe, regime e lotação viram uma SOLICITAÇÃO (`?/solicitar` →
	 * `cadastro_solicitacoes`) que um administrador aprova; até lá o valor
	 * exibido continua sendo o do banco. Quem mexe direto é a tela
	 * administrativa `/policiais/[id]`.
	 *
	 * O que muda na hora é o que pertence ao próprio usuário e não afeta a
	 * escala: e-mail pessoal (com verificação por código) e rubrica — esses vão
	 * por API e refletem imediatamente.
	 *
	 * Os `$state` do formulário nascem com `untrack` de propósito: são o
	 * RASCUNHO do usuário, e re-sincronizar com `data` a cada `invalidate`
	 * apagaria o que ele está digitando. `solicitacoes` é o oposto — `$derived`
	 * regravável, para aceitar a lista devolvida pela action sem esperar um
	 * novo `load`.
	 */
	import type { PageProps } from './$types';
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { toaster } from '$lib/toast';
	import { apiFetch } from '$lib/api-fetch';
	import ModalCadastrarRubrica from '$lib/components/ModalCadastrarRubrica.svelte';
	import ModalAlterarEmailPessoal from './ModalAlterarEmailPessoal.svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { ROTULO_CAMPO } from '$lib/perfil-campos';
	import { formatarData } from '$lib/utils/datas';
	import type { ActionResult } from '@sveltejs/kit';

	const { data }: PageProps = $props();

	const perfil = $derived(data.perfil);

	// --- Solicitação de alteração cadastral ---
	let telefone = $state(untrack(() => data.perfil.telefone ?? ''));
	let classe = $state(untrack(() => data.perfil.classe ?? ''));
	let regime = $state(untrack(() => data.perfil.regime ?? 'plantao'));
	let lotacao = $state(untrack(() => data.perfil.lotacao ?? ''));
	let pendingSolicitar = $state(false);

	// Derivado gravável: espelha o load, mas admite a lista devolvida pela action.
	let solicitacoes = $derived(data.solicitacoes);

	const lotacaoOptions = $derived(data.lotacoes.map((n: string) => ({ value: n, label: n })));
	const lotacaoSelectedOption = $derived(lotacao ? { value: lotacao, label: lotacao } : null);

	const houveMudanca = $derived(
		telefone.trim() !== (perfil.telefone ?? '') ||
			(classe && classe !== perfil.classe) ||
			(regime && regime !== perfil.regime) ||
			(lotacao && lotacao !== perfil.lotacao)
	);

	const pendentes = $derived(solicitacoes.filter((s) => s.status === 'pendente'));

	function handleSolicitar() {
		pendingSolicitar = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingSolicitar = false;
			if (result.type === 'success') {
				solicitacoes = (result.data?.solicitacoes as typeof solicitacoes) ?? solicitacoes;
				toaster.create({
					title: 'Solicitação enviada',
					description: 'As alterações aguardam aprovação do administrador.',
					type: 'success'
				});
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao solicitar'), type: 'error' });
			}
		};
	}

	// --- E-mail pessoal (cadastro/troca com OTP; espelho local pós-sucesso) ---
	let alterandoEmail = $state(false);
	let emailPessoal = $state(untrack(() => data.perfil.email_pessoal ?? null));
	let emailPessoalVerificado = $state(untrack(() => !!data.perfil.email_pessoal_verificado));

	// --- Rubrica ---
	let cadastrandoRubrica = $state(false);
	let minhaRubrica = $state(untrack(() => data.perfil.rubrica ?? null));
	let excluindoRubrica = $state(false);

	async function excluirRubrica() {
		if (
			!confirm(
				'Excluir sua rubrica cadastrada? Você precisará cadastrá-la novamente para assinar pelo computador.'
			)
		)
			return;
		excluindoRubrica = true;
		try {
			await apiFetch('/api/perfil/rubrica', { method: 'DELETE' });
			minhaRubrica = null;
			toaster.create({ title: 'Rubrica excluída', type: 'info' });
		} catch (e: unknown) {
			toaster.create({
				title: e instanceof Error ? e.message : 'Erro ao excluir rubrica',
				type: 'error'
			});
		} finally {
			excluindoRubrica = false;
		}
	}

	function statusBadge(status: string): { rotulo: string; classe: string } {
		if (status === 'aprovada')
			return {
				rotulo: 'Aprovada',
				classe: 'bg-success-500/15 text-success-700 dark:text-success-400'
			};
		if (status === 'rejeitada')
			return { rotulo: 'Rejeitada', classe: 'bg-error-500/15 text-error-700 dark:text-error-400' };
		return {
			rotulo: 'Pendente',
			classe: 'bg-warning-500/15 text-warning-700 dark:text-warning-400'
		};
	}

	/**
	 * Formata os timestamps das solicitações para "DD/MM/AAAA HH:MM".
	 * `created_at` chega como "YYYY-MM-DD HH:MM:SS" (já em horário local, -3h);
	 * `decidido_em` chega como ISO UTC (`new Date().toISOString()`) — convertido
	 * para o fuso de Fortaleza na exibição.
	 */
	function fmtDataHora(ts: string | null | undefined): string {
		if (!ts) return '—';
		if (ts.includes('T')) {
			const d = new Date(ts);
			if (isNaN(d.getTime())) return ts;
			// toLocaleString pt-BR devolve "DD/MM/AAAA, HH:MM" — remove a vírgula
			// para casar com o formato do created_at ("DD/MM/AAAA HH:MM").
			return d
				.toLocaleString('pt-BR', {
					timeZone: 'America/Fortaleza',
					day: '2-digit',
					month: '2-digit',
					year: 'numeric',
					hour: '2-digit',
					minute: '2-digit'
				})
				.replace(',', '');
		}
		const [dia, hora] = ts.split(' ');
		return `${formatarData(dia)}${hora ? ' ' + hora.slice(0, 5) : ''}`;
	}
</script>

<svelte:head><title>Meu perfil</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="h2 font-bold">Meu perfil</h1>
		<p class="text-sm text-surface-500 dark:text-surface-400 mt-1">
			Dados do seu cadastro. Alterações de telefone, classe, regime e lotação passam pela aprovação
			do administrador.
		</p>
	</div>

	<!-- Identificação + Rubrica lado a lado (rubrica verticalizada à direita) -->
	<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
		<!-- Identificação (somente leitura) -->
		<section class="card-glass p-4 sm:p-6 rounded-3xl lg:col-span-2">
			<h2 class="font-semibold text-sm uppercase tracking-wider text-surface-500 mb-4">
				Identificação
			</h2>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div>
					<span class="label-text text-xs text-surface-500 dark:text-surface-400 block">Nome</span>
					<p class="font-semibold">{perfil.nome}</p>
				</div>
				<div>
					<span class="label-text text-xs text-surface-500 dark:text-surface-400 block"
						>Matrícula</span
					>
					<p class="font-semibold">{perfil.matricula}</p>
				</div>
				<div>
					<span class="label-text text-xs text-surface-500 dark:text-surface-400 block">Cargo</span>
					<p class="font-semibold">{perfil.cargo}</p>
				</div>
				<div>
					<span class="label-text text-xs text-surface-500 dark:text-surface-400 block"
						>E-mail funcional</span
					>
					<p class="font-semibold">{perfil.email || '—'}</p>
				</div>
				<div class="sm:col-span-2">
					<span class="label-text text-xs text-surface-500 dark:text-surface-400 block"
						>E-mail pessoal</span
					>
					<div class="flex items-center gap-2 flex-wrap">
						<p class="font-semibold">
							{emailPessoal || '—'}
							{#if emailPessoal}
								<span
									class="ml-1 text-3xs font-bold uppercase px-1.5 py-0.5 rounded {emailPessoalVerificado
										? 'bg-success-500/15 text-success-700 dark:text-success-400'
										: 'bg-warning-500/15 text-warning-700 dark:text-warning-400'}"
								>
									{emailPessoalVerificado ? 'Verificado' : 'Não verificado'}
								</span>
							{/if}
						</p>
						<button
							type="button"
							class="btn btn-sm preset-outlined-primary-500 text-xs"
							onclick={() => (alterandoEmail = true)}
						>
							{emailPessoal ? 'Alterar' : 'Cadastrar'}
						</button>
					</div>
					{#if emailPessoal}
						<p class="text-2xs text-surface-500 dark:text-surface-400 mt-1">
							A troca exige sua senha e um código enviado ao novo endereço.
						</p>
					{/if}
				</div>
			</div>
		</section>

		<!-- Rubrica (verticalizada) -->
		<section class="card-glass p-4 sm:p-6 rounded-3xl lg:col-span-1">
			<h2 class="font-semibold text-sm uppercase tracking-wider text-surface-500 mb-4">Rubrica</h2>
			<div class="flex flex-col gap-4">
				{#if minhaRubrica}
					<div
						class="bg-white rounded-xl border border-surface-200 p-2 flex items-center justify-center w-full"
					>
						<img src={minhaRubrica} alt="Sua rubrica cadastrada" class="h-16 object-contain" />
					</div>
					<p class="text-xs text-surface-500">
						Usada como assinatura gráfica nos documentos assinados digitalmente e na assinatura por
						certificado digital (Token A3) no computador.
					</p>
					<div class="flex gap-2">
						<button
							type="button"
							class="btn btn-sm preset-outlined-primary-500 flex-1"
							onclick={() => (cadastrandoRubrica = true)}
						>
							Atualizar
						</button>
						<button
							type="button"
							class="btn btn-sm preset-outlined-error-500 flex-1"
							onclick={excluirRubrica}
							disabled={excluindoRubrica}
						>
							{excluindoRubrica ? 'Excluindo…' : 'Excluir'}
						</button>
					</div>
				{:else}
					<p class="text-sm text-surface-500">
						Você ainda não cadastrou sua rubrica. Ela é necessária para assinar pelo computador com
						certificado digital e permite conferência visual em documentos impressos.
					</p>
					<button
						type="button"
						class="btn btn-sm preset-filled-primary-500 font-bold w-full"
						onclick={() => (cadastrandoRubrica = true)}
					>
						Cadastrar rubrica
					</button>
				{/if}
			</div>
		</section>
	</div>

	<!-- Dados alteráveis via solicitação -->
	<section class="card-glass p-4 sm:p-6 rounded-3xl">
		<h2 class="font-semibold text-sm uppercase tracking-wider text-surface-500 mb-1">
			Dados cadastrais
		</h2>
		<p class="text-xs text-surface-500 dark:text-surface-400 mb-4">
			As alterações abaixo são enviadas como <strong>solicitação</strong> e só entram em vigor após a
			aprovação do administrador.
		</p>

		<form method="POST" action="?/solicitar" use:enhance={handleSolicitar}>
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
				<label class="label">
					<span class="label-text">Telefone</span>
					<input
						type="text"
						name="telefone"
						class="input"
						bind:value={telefone}
						placeholder="(85) 9 9999-9999"
						maxlength="20"
					/>
				</label>
				<label class="label">
					<span class="label-text">Classe</span>
					<select class="select" name="classe" bind:value={classe}>
						{#each data.classes as c (c)}
							<option value={c}>{c}</option>
						{/each}
					</select>
				</label>
				<label class="label">
					<span class="label-text">Regime de trabalho</span>
					<select class="select" name="regime" bind:value={regime}>
						<option value="plantao">Plantão</option>
						<option value="expediente">Expediente</option>
					</select>
				</label>
				<label class="label">
					<span class="label-text">Lotação</span>
					<SearchableSelect
						name="lotacao"
						bind:value={lotacao}
						options={lotacaoOptions}
						selectedOption={lotacaoSelectedOption}
						placeholder="Buscar unidade..."
						class="w-full"
					/>
				</label>
			</div>
			<div class="flex justify-end">
				<button
					type="submit"
					class="btn preset-filled-primary-500 font-bold disabled:opacity-40"
					disabled={pendingSolicitar || !houveMudanca}
				>
					{pendingSolicitar ? 'Enviando…' : 'Solicitar alteração'}
				</button>
			</div>
		</form>
	</section>

	<!-- Histórico de solicitações -->
	{#if solicitacoes.length > 0}
		<section class="card-glass p-4 sm:p-6 rounded-3xl">
			<h2 class="font-semibold text-sm uppercase tracking-wider text-surface-500 mb-4">
				Minhas solicitações
				{#if pendentes.length > 0}
					<span
						class="ml-2 text-3xs font-bold px-2 py-0.5 rounded-full bg-warning-500/15 text-warning-700 dark:text-warning-400"
					>
						{pendentes.length} pendente{pendentes.length > 1 ? 's' : ''}
					</span>
				{/if}
			</h2>
			<div class="overflow-x-auto">
				<table class="table w-full text-sm">
					<thead>
						<tr class="text-left text-xs uppercase text-surface-500 dark:text-surface-400">
							<th class="py-2">Campo</th>
							<th class="py-2">De</th>
							<th class="py-2">Para</th>
							<th class="py-2 whitespace-nowrap">Solicitado em</th>
							<th class="py-2 whitespace-nowrap">Decidido em</th>
							<th class="py-2">Status</th>
						</tr>
					</thead>
					<tbody>
						{#each solicitacoes as s (s.id)}
							{@const b = statusBadge(s.status)}
							<tr class="border-t border-surface-200 dark:border-white/5">
								<td class="py-2 font-medium">{ROTULO_CAMPO[s.campo]}</td>
								<td class="py-2 text-surface-500">{s.valor_atual || '—'}</td>
								<td class="py-2 font-semibold">{s.valor_novo}</td>
								<td class="py-2 whitespace-nowrap text-xs tabular-nums text-surface-500">
									{fmtDataHora(s.created_at)}
								</td>
								<td class="py-2 whitespace-nowrap text-xs tabular-nums text-surface-500">
									{s.status === 'pendente' ? '—' : fmtDataHora(s.decidido_em)}
								</td>
								<td class="py-2">
									<span class="text-3xs font-bold uppercase px-2 py-0.5 rounded {b.classe}">
										{b.rotulo}
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</div>

<ModalCadastrarRubrica
	bind:open={cadastrandoRubrica}
	rubricaAtual={minhaRubrica}
	onSaved={(nova) => (minhaRubrica = nova)}
/>

<ModalAlterarEmailPessoal
	bind:open={alterandoEmail}
	emailAtual={emailPessoal}
	onConfirmado={(novo) => {
		emailPessoal = novo;
		emailPessoalVerificado = true;
	}}
/>
