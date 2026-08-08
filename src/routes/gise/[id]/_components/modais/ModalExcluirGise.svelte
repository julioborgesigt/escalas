<script lang="ts">
	/**
	 * Confirmação de exclusão de uma GISE — a operação mais destrutiva do
	 * sistema.
	 *
	 * Ela apaga DOCUMENTO ASSINADO, e isso não se recupera: as linhas de
	 * `gise_documentos`, `gise_assinaturas_relatorios` e `gise_presenca_termos`
	 * saem do D1, e os PDFs, cópias de conferência e selfies saem do R2. Depois
	 * disso o portal público `/validar` passa a responder "documento não
	 * encontrado" para qualquer papel que já tenha circulado.
	 *
	 * Por isso o diálogo BUSCA E EXIBE OS NÚMEROS (`/api/gise/[id]/impacto-exclusao`)
	 * em vez de confiar na palavra "irreversível", que todo mundo já leu mil vezes
	 * e ninguém mais lê. Ver "3 documentos assinados e 11 arquivos" é o que faz
	 * alguém parar.
	 *
	 * Enquanto a contagem carrega, o botão de confirmar fica desabilitado — a
	 * decisão não deve ser tomada antes de o número aparecer. Se a contagem
	 * falhar, o aviso degrada para o texto genérico e a exclusão segue possível:
	 * o servidor é quem valida, e travar o fluxo por causa do aviso seria pior.
	 */
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import { apiFetch } from '$lib/api-fetch';

	interface Props {
		open: boolean;
		giseId: number;
		pendingCrud: boolean;
		onClose: () => void;
		onSubmit: SubmitFunction;
	}

	interface Impacto {
		documentosAssinados: number;
		arquivosR2: number;
		detalhe: { documentoEscala: number; relatorios: number; termosPresenca: number };
	}

	const { open, giseId, pendingCrud, onClose, onSubmit }: Props = $props();

	let impacto = $state<Impacto | null>(null);
	let carregando = $state(false);
	let falhou = $state(false);

	// Recarrega a cada abertura: a GISE pode ter recebido assinatura desde a
	// última vez que o diálogo foi aberto nesta mesma página.
	$effect(() => {
		if (!open) return;
		impacto = null;
		falhou = false;
		carregando = true;
		apiFetch<Impacto>(`/api/gise/${giseId}/impacto-exclusao`)
			.then((r) => (impacto = r))
			.catch(() => (falhou = true))
			.finally(() => (carregando = false));
	});

	const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		if (!pendingCrud && !e.open) onClose();
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card-elevated rounded-2xl shadow-2xl w-full max-w-md max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-4 sm:p-6 space-y-4"
		>
			<Dialog.Title
				class="text-lg font-bold text-surface-900 dark:text-surface-50 flex items-center gap-2"
			>
				<AlertTriangle class="w-5 h-5 text-error-500 shrink-0" aria-hidden="true" />
				Excluir Escala GISE
			</Dialog.Title>

			<Dialog.Description class="text-sm text-surface-600 dark:text-surface-400">
				Esta ação é <strong>irreversível</strong> e remove a escala com equipes, membros e presenças.
			</Dialog.Description>

			<div
				class="rounded-xl border border-error-500/40 bg-error-500/10 p-3 space-y-2 text-sm text-error-800 dark:text-error-200"
			>
				<p class="font-bold">Documentos assinados serão destruídos</p>

				{#if carregando}
					<p class="text-xs opacity-80">Verificando o que será apagado...</p>
				{:else if impacto}
					<ul class="text-xs space-y-1 list-disc list-inside">
						<li>
							<strong
								>{plural(
									impacto.documentosAssinados,
									'documento assinado',
									'documentos assinados'
								)}</strong
							>
							{#if impacto.documentosAssinados > 0}
								no banco de dados (D1)
							{:else}
								— esta GISE ainda não tem nenhum
							{/if}
						</li>
						<li>
							<strong>{plural(impacto.arquivosR2, 'arquivo', 'arquivos')}</strong> no armazenamento (R2):
							PDFs assinados, cópias de conferência e selfies
						</li>
					</ul>
					{#if impacto.documentosAssinados > 0}
						<p class="text-xs">
							Detalhe: {impacto.detalhe.documentoEscala} da escala, {impacto.detalhe.relatorios} de relatórios
							de seccional, {impacto.detalhe.termosPresenca} de termos de presença.
						</p>
						<p class="text-xs font-semibold">
							Depois disso, o código de validação impresso nesses documentos deixa de ser
							reconhecido em <span class="font-mono">/validar</span>.
						</p>
					{/if}
				{:else if falhou}
					<p class="text-xs">
						Não foi possível contar os documentos. A exclusão apagará todos os documentos assinados
						desta GISE do banco (D1) e do armazenamento (R2).
					</p>
				{/if}
			</div>

			<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
				<button
					type="button"
					class="btn preset-outlined-surface-500 text-sm px-4 py-2 rounded-xl"
					onclick={onClose}
					disabled={pendingCrud}>Cancelar</button
				>
				<form method="POST" action="?/excluirGise" use:enhance={onSubmit} class="contents">
					<button
						type="submit"
						class="btn preset-filled-error-500 text-sm px-4 py-2 rounded-xl"
						disabled={pendingCrud || carregando}
					>
						{pendingCrud ? 'Excluindo...' : 'Confirmar Exclusão'}
					</button>
				</form>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
