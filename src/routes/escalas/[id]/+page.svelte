<script lang="ts">
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { toaster } from '$lib/toast';
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

	const { data } = $props();

	const horas = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
	const minutos = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

	const confirmDialog = useConfirmationDialog<{ itemId: number; nome: string }>();

	const escala = $derived(data.escala);
	let finalizadaEm = $state<string | null>(untrack(() => data.escala?.finalizada_em ?? null));
	$effect(() => {
		finalizadaEm = data.escala?.finalizada_em ?? null;
	});
	const emailEnvioInicial = $derived(data.escala?.email_envio ?? null);
	let solicitacaoAtual = $state<{ tipo: string; destinatario_id?: number } | null>(
		untrack(() => data.solicitacaoAtual ?? null)
	);
	$effect(() => {
		solicitacaoAtual = data.solicitacaoAtual ?? null;
	});
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

	let policiaisEscalaLocal = $state<EscalaPolicialComDados[]>(
		untrack(() => data.policiaisEscala as EscalaPolicialComDados[])
	);
	$effect(() => {
		policiaisEscalaLocal = data.policiaisEscala as EscalaPolicialComDados[];
	});

	const isFDS = $derived(escala?.tipo === 'fds');
	const isExpediente = $derived(escala?.tipo === 'expediente');

	let modoEdicao = $state(false);
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
		const current = new Date(escala.data_inicio + 'T00:00:00');
		const last = new Date(escala.data_fim + 'T00:00:00');
		while (current <= last) {
			days.push(new Date(current).toISOString().split('T')[0]);
			current.setDate(current.getDate() + 1);
		}
		return days;
	});

	function solicitarRemocao(itemId: number, nome: string) {
		confirmDialog.openDialog({ itemId, nome });
	}

	function handleRemover() {
		const itemNome = confirmDialog.currentItem?.nome;
		const itemId = confirmDialog.currentItem?.itemId;
		const backup = [...policiaisEscalaLocal];
		policiaisEscalaLocal = policiaisEscalaLocal.filter((p) => p.id !== itemId);
		confirmDialog.closeDialog();
		return async ({ result }: { result: ActionResult }) => {
			if (result.type === 'success') {
				policiaisEscalaLocal = result.data?.policiais;
				toaster.create({ title: `${itemNome} removido da escala`, type: 'success' });
			} else {
				policiaisEscalaLocal = backup;
				const d = result.type === 'failure' ? result.data as Record<string, unknown> | undefined : undefined;
				toaster.create({ title: String(d?.error || 'Erro ao remover'), type: 'error' });
			}
		};
	}

	let modoSelecao = $state(false);
	let selecionados = $state(new Set<number>());
	let pendingRemoverTodos = $state(false);
	let pendingRemoverSelecionados = $state(false);
	let confirmRemoverTodosOpen = $state(false);
	let confirmRemoverSelecionadosOpen = $state(false);

	const selecionadosJson = $derived(JSON.stringify(Array.from(selecionados)));
	const totalSelecionados = $derived(selecionados.size);

	function toggleSelecionar(id: number) {
		const novo = new Set(selecionados);
		if (novo.has(id)) novo.delete(id);
		else novo.add(id);
		selecionados = novo;
	}

	function cancelarSelecao() {
		modoSelecao = false;
		selecionados = new Set();
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
				const d = result.type === 'failure' ? result.data as Record<string, unknown> | undefined : undefined;
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
				selecionados = new Set();
				modoSelecao = false;
				const removidos = result.data?.removidos ?? 0;
				toaster.create({
					title: `${removidos} servidor(es) removido(s) da escala`,
					type: 'success'
				});
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d = result.type === 'failure' ? result.data as Record<string, unknown> | undefined : undefined;
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
			<form method="POST" action="?/remover" use:enhance={handleRemover} class="contents">
				<input type="hidden" name="item_id" value={confirmDialog.currentItem?.itemId} />
				<button type="submit" class="btn preset-filled-error-500 active:scale-95 transition-all">
					Remover
				</button>
			</form>
		{/snippet}
	</ModalConfirmar>

	<ModalConfirmar bind:open={confirmRemoverTodosOpen} title="Remover Todos?">
		{#snippet description()}
			Tem certeza que deseja remover <strong>todos os {policiaisEscalaLocal.length} servidores</strong>
			desta escala? Esta ação não pode ser desfeita.
		{/snippet}
		{#snippet actions()}
			<form method="POST" action="?/removerTodos" use:enhance={handleRemoverTodos} class="contents">
				<button
					type="submit"
					class="btn preset-filled-error-500 active:scale-95 transition-all"
					disabled={pendingRemoverTodos}
				>
					{pendingRemoverTodos ? 'Removendo...' : 'Remover Todos'}
				</button>
			</form>
		{/snippet}
	</ModalConfirmar>

	<ModalConfirmar bind:open={confirmRemoverSelecionadosOpen} title="Remover Selecionados?">
		{#snippet description()}
			Tem certeza que deseja remover os <strong>{totalSelecionados} servidor(es) selecionado(s)</strong>
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
					class="btn preset-filled-error-500 active:scale-95 transition-all"
					disabled={pendingRemoverSelecionados}
				>
					{pendingRemoverSelecionados ? 'Removendo...' : `Remover (${totalSelecionados})`}
				</button>
			</form>
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
				selecionados = new Set(policiaisEscalaLocal.map((p) => p.id));
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
