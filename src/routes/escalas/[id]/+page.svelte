<script lang="ts">
	import type { PageProps } from './$types';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
	import { invalidateAll } from '$app/navigation';
	import { apiFetch } from '$lib/api-fetch';
	import type { ActionResult } from '@sveltejs/kit';
	import type { EscalaPolicialComDados } from '$lib/types';
	import PainelAssinaturaEscala from '$lib/components/PainelAssinaturaEscala.svelte';
	import { useConfirmationDialog } from '$lib/composables';
	import ModalConfirmar from './_components/ModalConfirmar.svelte';
	import EscalaCabecalho from './_components/EscalaCabecalho.svelte';
	import FormAdicionarServidores from './_components/FormAdicionarServidores.svelte';
	import ToolbarSelecao from './_components/ToolbarSelecao.svelte';
	import ListaFds from './_components/ListaFds.svelte';
	import TabelaServidores from './_components/TabelaServidores.svelte';
	import TabelaPlantao from './_components/TabelaPlantao.svelte';

	const { data }: PageProps = $props();

	const horas = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
	const minutos = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

	const confirmDialog = useConfirmationDialog<{ itemId: number | number[]; nome: string }>();

	const escala = $derived(data.escala);
	// Derivados graváveis: espelham o load, mas admitem as atualizações
	// otimistas locais (finalizar/solicitar) até o próximo invalidate.
	let finalizadaEm: string | null = $derived(data.escala?.finalizada_em ?? null);
	const emailEnvioInicial = $derived(data.escala?.email_envio ?? null);
	let solicitacaoAtual: { tipo: string; destinatario_id?: number } | null = $derived(
		data.solicitacaoAtual ?? null
	);
	let documentoAssinadoInfo = $derived(
		data.documentoAssinadoInfo
			? {
					existe: data.documentoAssinadoInfo.existe,
					assinante_nome: data.documentoAssinadoInfo.assinante_nome,
					assinante_cpf: data.documentoAssinadoInfo.assinante_cpf ?? undefined,
					data: data.documentoAssinadoInfo.data ?? undefined
				}
			: null
	);

	// Derivado gravável: espelha o load, mas admite a remoção otimista local.
	let policiaisEscalaLocal: EscalaPolicialComDados[] = $derived(
		data.policiaisEscala as EscalaPolicialComDados[]
	);

	const isFDS = $derived(escala?.tipo === 'fds');
	const isExpediente = $derived(escala?.tipo === 'expediente');

	let modoEdicao = $state(true);
	const podeEditar = $derived(
		data.podeOIPSolicitar ||
			((page.data.usuario?.papel === 'admin_seccional' ||
				page.data.usuario?.papel === 'admin_unidade') &&
				page.data.usuario?.cargo === 'DPC')
	);

	// diasEscalaLocal para FormAdicionarServidores (non-FDS pages — sem ModalEditarDias)
	const diasEscalaLocal = $derived.by(() => {
		if (!escala) return [];
		const days: string[] = [];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const current = new Date(escala.data_inicio + 'T00:00:00');

		const last = new Date(escala.data_fim + 'T00:00:00');
		while (current <= last) {
			days.push(new Date(current).toISOString().split('T')[0]);
			current.setDate(current.getDate() + 1);
		}
		return days;
	});

	function solicitarRemocao(itemId: number | number[], nome: string) {
		confirmDialog.openDialog({ itemId, nome });
	}

	function handleRemover() {
		const itemNome = confirmDialog.currentItem?.nome;
		const itemId = confirmDialog.currentItem?.itemId;
		const backup = [...policiaisEscalaLocal];
		if (Array.isArray(itemId)) {
			policiaisEscalaLocal = policiaisEscalaLocal.filter((p) => !itemId.includes(p.id));
		} else {
			policiaisEscalaLocal = policiaisEscalaLocal.filter((p) => p.id !== itemId);
		}
		confirmDialog.closeDialog();
		return async ({ result }: { result: ActionResult }) => {
			if (result.type === 'success') {
				policiaisEscalaLocal = result.data?.policiais;
				toaster.create({ title: `${itemNome} removido da escala`, type: 'success' });
			} else {
				policiaisEscalaLocal = backup;
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao remover'), type: 'error' });
			}
		};
	}

	let confirmFinalizarEdicaoOpen = $state(false);
	let enviandoSolicitacao = $state(false);

	async function confirmarFinalizarEdicao() {
		if (enviandoSolicitacao) return;
		enviandoSolicitacao = true;
		try {
			await apiFetch(`/api/escalas/${data.escalaId}/solicitar-assinatura`, {
				method: 'POST',
				body: JSON.stringify({ tipo: 'unidade' })
			});
			toaster.create({ title: 'Edição finalizada e solicitação enviada!', type: 'success' });
			solicitacaoAtual = { tipo: 'unidade' };
			modoEdicao = false;
			confirmFinalizarEdicaoOpen = false;
			await invalidateAll();
		} catch (e: unknown) {
			toaster.create({
				title: e instanceof Error ? e.message : 'Erro ao solicitar assinatura',
				type: 'error'
			});
		} finally {
			enviandoSolicitacao = false;
		}
	}

	function handleConfirmarFinalizacao() {
		if (page.data.usuario?.cargo === 'DPC') {
			modoEdicao = false;
			confirmFinalizarEdicaoOpen = false;
		} else {
			confirmarFinalizarEdicao();
		}
	}

	let modoSelecao = $state(false);
	// eslint-disable-next-line svelte/no-unnecessary-state-wrap
	let selecionados = $state(new SvelteSet<number>());
	let pendingRemoverTodos = $state(false);
	let pendingRemoverSelecionados = $state(false);
	let confirmRemoverTodosOpen = $state(false);
	let confirmRemoverSelecionadosOpen = $state(false);

	const selecionadosJson = $derived(JSON.stringify(Array.from(selecionados)));
	const totalSelecionados = $derived(selecionados.size);

	function toggleSelecionar(id: number) {
		if (selecionados.has(id)) selecionados.delete(id);
		else selecionados.add(id);
	}

	function cancelarSelecao() {
		modoSelecao = false;
		selecionados.clear();
	}

	function handleRemoverTodos() {
		pendingRemoverTodos = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingRemoverTodos = false;
			confirmRemoverTodosOpen = false;
			if (result.type === 'success') {
				policiaisEscalaLocal = [];
				toaster.create({ title: 'Todos os servidores removidos da escala', type: 'success' });
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao remover'), type: 'error' });
			}
		};
	}

	function handleRemoverSelecionados() {
		pendingRemoverSelecionados = true;
		return async ({ result }: { result: ActionResult }) => {
			pendingRemoverSelecionados = false;
			confirmRemoverSelecionadosOpen = false;
			if (result.type === 'success') {
				policiaisEscalaLocal = result.data?.policiais;
				selecionados.clear();
				modoSelecao = false;
				const removidos = result.data?.removidos ?? 0;
				toaster.create({
					title: `${removidos} servidor(es) removido(s) da escala`,
					type: 'success'
				});
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao remover'), type: 'error' });
			}
		};
	}
</script>

{#if !escala}
	<div class="text-center py-12 text-surface-500"><p>Escala não encontrada.</p></div>
{:else}
	<EscalaCabecalho
		{escala}
		{isFDS}
		{isExpediente}
		{podeEditar}
		documentoAssinadoExiste={documentoAssinadoInfo?.existe ?? false}
		{finalizadaEm}
		{solicitacaoAtual}
		bind:modoEdicao
		onFinalizarEdicao={() => (confirmFinalizarEdicaoOpen = true)}
	/>

	<PainelAssinaturaEscala
		escalaId={String(data.escalaId)}
		{isFDS}
		policiaisCount={policiaisEscalaLocal.length}
		usuario={page.data.usuario}
		bind:documentoAssinadoInfo
		bind:finalizadaEm
		{emailEnvioInicial}
		podeOIPSolicitar={data.podeOIPSolicitar}
		{solicitacaoAtual}
		onSolicitacaoEnviada={() => {
			solicitacaoAtual = { tipo: 'unidade' };
			modoEdicao = false;
		}}
	/>

	<ModalConfirmar bind:open={confirmDialog.isOpen} title="Remover Policial?">
		{#snippet description()}
			Tem certeza que deseja remover o policial "{confirmDialog.currentItem?.nome}" desta escala?
		{/snippet}
		{#snippet actions()}
			{#if Array.isArray(confirmDialog.currentItem?.itemId)}
				<form
					method="POST"
					action="?/removerSelecionados"
					use:enhance={handleRemover}
					class="contents"
				>
					<input
						type="hidden"
						name="ids"
						value={JSON.stringify(confirmDialog.currentItem?.itemId)}
					/>
					<button type="submit" class="btn preset-filled-error-500 transition-all">
						Remover
					</button>
				</form>
			{:else}
				<form method="POST" action="?/remover" use:enhance={handleRemover} class="contents">
					<input type="hidden" name="item_id" value={confirmDialog.currentItem?.itemId} />
					<button type="submit" class="btn preset-filled-error-500 transition-all">
						Remover
					</button>
				</form>
			{/if}
		{/snippet}
	</ModalConfirmar>

	<ModalConfirmar bind:open={confirmRemoverTodosOpen} title="Remover Todos?">
		{#snippet description()}
			Tem certeza que deseja remover <strong
				>todos os {policiaisEscalaLocal.length} servidores</strong
			>
			desta escala? Esta ação não pode ser desfeita.
		{/snippet}
		{#snippet actions()}
			<form method="POST" action="?/removerTodos" use:enhance={handleRemoverTodos} class="contents">
				<button
					type="submit"
					class="btn preset-filled-error-500 transition-all"
					disabled={pendingRemoverTodos}
				>
					{pendingRemoverTodos ? 'Removendo...' : 'Remover Todos'}
				</button>
			</form>
		{/snippet}
	</ModalConfirmar>

	<ModalConfirmar bind:open={confirmRemoverSelecionadosOpen} title="Remover Selecionados?">
		{#snippet description()}
			Tem certeza que deseja remover os <strong
				>{totalSelecionados} servidor(es) selecionado(s)</strong
			>
			desta escala?
		{/snippet}
		{#snippet actions()}
			<form
				method="POST"
				action="?/removerSelecionados"
				use:enhance={handleRemoverSelecionados}
				class="contents"
			>
				<input type="hidden" name="ids" value={selecionadosJson} />
				<button
					type="submit"
					class="btn preset-filled-error-500 transition-all"
					disabled={pendingRemoverSelecionados}
				>
					{pendingRemoverSelecionados ? 'Removendo...' : `Remover (${totalSelecionados})`}
				</button>
			</form>
		{/snippet}
	</ModalConfirmar>

	<ModalConfirmar bind:open={confirmFinalizarEdicaoOpen} title="Finalizar Edição?">
		{#snippet description()}
			{#if page.data.usuario?.cargo === 'DPC'}
				Tem certeza que deseja finalizar a edição desta escala?
			{:else}
				Tem certeza que deseja finalizar a edição desta escala? A assinatura do delegado seccional
				(DPC) será solicitada automaticamente.
			{/if}
		{/snippet}
		{#snippet actions()}
			<button
				type="button"
				class="btn preset-filled-primary-500 transition-all"
				onclick={handleConfirmarFinalizacao}
				disabled={enviandoSolicitacao}
			>
				{enviandoSolicitacao ? 'Enviando...' : 'Confirmar'}
			</button>
		{/snippet}
	</ModalConfirmar>

	<FormAdicionarServidores
		{escala}
		{isFDS}
		{isExpediente}
		{diasEscalaLocal}
		{modoEdicao}
		documentoAssinadoExiste={documentoAssinadoInfo?.existe ?? false}
		{finalizadaEm}
		{solicitacaoAtual}
		{policiaisEscalaLocal}
		onPoliciaisAtualizados={(p) => (policiaisEscalaLocal = p)}
	/>

	<div class="flex items-center gap-3 my-6">
		<hr class="flex-1 border-surface-200 dark:border-white/10" />
		<span
			class="text-xs font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider"
			>Servidores na Escala</span
		>
		<hr class="flex-1 border-surface-200 dark:border-white/10" />
	</div>

	{#if policiaisEscalaLocal.length > 0 && !documentoAssinadoInfo?.existe && !finalizadaEm}
		<ToolbarSelecao
			totalPoliciais={policiaisEscalaLocal.length}
			{totalSelecionados}
			{modoSelecao}
			{pendingRemoverSelecionados}
			onSelecionarTodos={() => {
				selecionados.clear();
				for (const p of policiaisEscalaLocal) selecionados.add(p.id);
			}}
			onRemoverSelecionados={() => (confirmRemoverSelecionadosOpen = true)}
			onRemoverTodos={() => (confirmRemoverTodosOpen = true)}
			onIniciarSelecao={() => (modoSelecao = true)}
			onCancelarSelecao={cancelarSelecao}
		/>
	{/if}

	{#if isFDS}
		<ListaFds
			bind:policiaisEscalaLocal
			{modoEdicao}
			documentoAssinadoExiste={documentoAssinadoInfo?.existe ?? false}
			{finalizadaEm}
			{solicitacaoAtual}
			{modoSelecao}
			bind:selecionados
			{escala}
			{horas}
			{minutos}
			onToggleSelecionar={toggleSelecionar}
			onSolicitarRemocao={solicitarRemocao}
		/>
	{:else if policiaisEscalaLocal.length === 0}
		<div class="text-center py-12 text-surface-500">
			<p>Nenhum policial nesta escala ainda.</p>
		</div>
	{:else if !isExpediente && !isFDS}
		<TabelaPlantao
			bind:policiaisEscalaLocal
			documentoAssinadoExiste={documentoAssinadoInfo?.existe ?? false}
			{finalizadaEm}
			{modoSelecao}
			bind:selecionados
			{escala}
			{horas}
			{minutos}
			onSolicitarRemocao={solicitarRemocao}
			onToggleSelecionar={toggleSelecionar}
		/>
	{:else}
		<TabelaServidores
			bind:policiaisEscalaLocal
			{isExpediente}
			{isFDS}
			documentoAssinadoExiste={documentoAssinadoInfo?.existe ?? false}
			{finalizadaEm}
			{modoSelecao}
			bind:selecionados
			{escala}
			{horas}
			{minutos}
			onSolicitarRemocao={solicitarRemocao}
			onToggleSelecionar={toggleSelecionar}
		/>
	{/if}
{/if}
