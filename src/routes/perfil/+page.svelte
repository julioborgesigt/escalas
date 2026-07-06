<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import { toaster } from '$lib/toast';
	import { csrfHeaders } from '$lib/csrf';
	import ModalCadastrarRubrica from '$lib/components/ModalCadastrarRubrica.svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import { ROTULO_CAMPO } from '$lib/perfil-campos';
	import type { ActionResult } from '@sveltejs/kit';

	const { data } = $props();

	const perfil = $derived(data.perfil);

	// --- Solicitação de alteração cadastral ---
	let telefone = $state(untrack(() => data.perfil.telefone ?? ''));
	let classe = $state(untrack(() => data.perfil.classe ?? ''));
	let regime = $state(untrack(() => data.perfil.regime ?? 'plantao'));
	let lotacao = $state(untrack(() => data.perfil.lotacao ?? ''));
	let pendingSolicitar = $state(false);

	// eslint-disable-next-line svelte/prefer-writable-derived
	let solicitacoes = $state(untrack(() => data.solicitacoes));
	$effect(() => {
		solicitacoes = data.solicitacoes;
	});

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
			const res = await fetch('/api/perfil/rubrica', { method: 'DELETE', headers: csrfHeaders() });
			if (res.ok) {
				minhaRubrica = null;
				toaster.create({ title: 'Rubrica excluída', type: 'info' });
			} else {
				toaster.create({ title: 'Erro ao excluir rubrica', type: 'error' });
			}
		} catch {
			toaster.create({ title: 'Erro de rede ao excluir rubrica', type: 'error' });
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
</script>

<svelte:head><title>Meu perfil</title></svelte:head>

<div class="max-w-3xl mx-auto space-y-6">
	<div>
		<h1 class="h2 font-bold">Meu perfil</h1>
		<p class="text-sm text-surface-500 dark:text-surface-400 mt-1">
			Dados do seu cadastro. Alterações de telefone, classe, regime e lotação passam pela aprovação
			do administrador.
		</p>
	</div>

	<!-- Identificação (somente leitura) -->
	<section class="card-glass p-4 sm:p-6 rounded-3xl">
		<h2 class="font-semibold text-sm uppercase tracking-wider text-surface-500 mb-4">
			Identificação
		</h2>
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
			<div>
				<span class="label-text text-xs text-surface-400 block">Nome</span>
				<p class="font-semibold">{perfil.nome}</p>
			</div>
			<div>
				<span class="label-text text-xs text-surface-400 block">Matrícula</span>
				<p class="font-semibold">{perfil.matricula}</p>
			</div>
			<div>
				<span class="label-text text-xs text-surface-400 block">Cargo</span>
				<p class="font-semibold">{perfil.cargo}</p>
			</div>
			<div>
				<span class="label-text text-xs text-surface-400 block">E-mail funcional</span>
				<p class="font-semibold">{perfil.email || '—'}</p>
			</div>
			<div>
				<span class="label-text text-xs text-surface-400 block">E-mail pessoal</span>
				<p class="font-semibold">
					{perfil.email_pessoal || '—'}
					{#if perfil.email_pessoal}
						<span
							class="ml-1 text-[0.6rem] font-bold uppercase px-1.5 py-0.5 rounded {perfil.email_pessoal_verificado
								? 'bg-success-500/15 text-success-700 dark:text-success-400'
								: 'bg-warning-500/15 text-warning-700 dark:text-warning-400'}"
						>
							{perfil.email_pessoal_verificado ? 'Verificado' : 'Não verificado'}
						</span>
					{/if}
				</p>
			</div>
		</div>
	</section>

	<!-- Rubrica -->
	<section class="card-glass p-4 sm:p-6 rounded-3xl">
		<h2 class="font-semibold text-sm uppercase tracking-wider text-surface-500 mb-4">Rubrica</h2>
		<div class="flex flex-col sm:flex-row sm:items-center gap-4">
			{#if minhaRubrica}
				<div
					class="bg-white rounded-xl border border-surface-200 p-2 flex items-center justify-center sm:w-56"
				>
					<img src={minhaRubrica} alt="Sua rubrica cadastrada" class="h-14 object-contain" />
				</div>
				<div class="flex-1 text-xs text-surface-500">
					Usada como assinatura gráfica nos documentos assinados digitalmente e na assinatura por
					certificado digital (Token A3) no computador.
				</div>
				<div class="flex gap-2 shrink-0">
					<button
						type="button"
						class="btn btn-sm preset-outlined-primary-500"
						onclick={() => (cadastrandoRubrica = true)}
					>
						Atualizar
					</button>
					<button
						type="button"
						class="btn btn-sm preset-outlined-error-500"
						onclick={excluirRubrica}
						disabled={excluindoRubrica}
					>
						{excluindoRubrica ? 'Excluindo…' : 'Excluir'}
					</button>
				</div>
			{:else}
				<div class="flex-1 text-sm text-surface-500">
					Você ainda não cadastrou sua rubrica. Ela é necessária para assinar pelo computador com
					certificado digital e permite conferência visual em documentos impressos.
				</div>
				<button
					type="button"
					class="btn btn-sm preset-filled-primary-500 font-bold shrink-0"
					onclick={() => (cadastrandoRubrica = true)}
				>
					Cadastrar rubrica
				</button>
			{/if}
		</div>
	</section>

	<!-- Dados alteráveis via solicitação -->
	<section class="card-glass p-4 sm:p-6 rounded-3xl">
		<h2 class="font-semibold text-sm uppercase tracking-wider text-surface-500 mb-1">
			Dados cadastrais
		</h2>
		<p class="text-xs text-surface-400 mb-4">
			As alterações abaixo são enviadas como <strong>solicitação</strong> e só entram em vigor após a
			aprovação do administrador.
		</p>

		<form method="POST" action="?/solicitar" use:enhance={handleSolicitar}>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
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
						class="ml-2 text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-warning-500/15 text-warning-700 dark:text-warning-400"
					>
						{pendentes.length} pendente{pendentes.length > 1 ? 's' : ''}
					</span>
				{/if}
			</h2>
			<div class="overflow-x-auto">
				<table class="table w-full text-sm">
					<thead>
						<tr class="text-left text-xs uppercase text-surface-400">
							<th class="py-2">Campo</th>
							<th class="py-2">De</th>
							<th class="py-2">Para</th>
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
								<td class="py-2">
									<span class="text-[0.65rem] font-bold uppercase px-2 py-0.5 rounded {b.classe}">
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
