<script lang="ts">
	import { slide } from 'svelte/transition';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import PainelAssinaturaToken from './PainelAssinaturaToken.svelte';
	import SignaturePad from './SignaturePad.svelte';
	import DialogSolicitarAssinatura from './DialogSolicitarAssinatura.svelte';
	import type { SignaturePadConfirmPayload } from './SignaturePadTypes';
	import type { UsuarioLogado } from '$lib/auth';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { toaster } from '$lib/toast';
	import { apiFetch } from '$lib/api-fetch';
	import { loading } from '$lib/loading.svelte';
	import { useAssinaturaEscala, useMobile } from '$lib/composables';

	interface DocumentoAssinadoInfo {
		existe: boolean;
		assinante_nome?: string;
		assinante_cpf?: string;
		data?: string;
	}

	let {
		escalaId,
		isFDS,
		policiaisCount,
		usuario,
		documentoAssinadoInfo = $bindable(),
		podeOIPSolicitar = false,
		solicitacaoAtual = null,
		onSolicitacaoEnviada
	}: {
		escalaId: string;
		isFDS: boolean;
		policiaisCount: number;
		usuario: UsuarioLogado | null;
		documentoAssinadoInfo: DocumentoAssinadoInfo | null;
		podeOIPSolicitar?: boolean;
		solicitacaoAtual?: { tipo: string; destinatario_id?: number } | null;
		onSolicitacaoEnviada?: () => void;
	} = $props();

	// --- Solicitar Assinatura (OIP) ---
	// Derivado gravável: espelha a prop, mas admite o reset local pós-cancelamento.
	let solicitacaoLocal = $derived(solicitacaoAtual ?? null);
	let dialogSolicitarAberto = $state(false);

	async function cancelarSolicitacao() {
		try {
			await apiFetch(`/api/escalas/${escalaId}/solicitar-assinatura`, { method: 'DELETE' });
			solicitacaoLocal = null;
			toaster.create({ title: 'Solicitação cancelada', type: 'info' });
			invalidateAll();
		} catch (e: unknown) {
			toaster.create({
				title: e instanceof Error ? e.message : 'Erro ao cancelar solicitação',
				type: 'error'
			});
		}
	}

	const mobileState = useMobile();
	const isMobile = $derived(mobileState.isMobile);

	const assinatura = useAssinaturaEscala({
		getParams: () => ({ escalaId, isFDS, policiaisCount, usuario }),
		onDocumentoAssinado: (info) => {
			documentoAssinadoInfo = info as DocumentoAssinadoInfo | null;
		}
	});

	const assinando = $derived(assinatura.assinando);
	const dialogSignOpen = $derived(assinatura.dialogSignOpen);

	let dialogRevogacaoAberto = $state(false);
	let painelAberto = $state(false);

	function revogarAssinatura() {
		dialogRevogacaoAberto = true;
	}

	async function confirmarRevogacao() {
		dialogRevogacaoAberto = false;
		assinatura.dialogSignOpen = false;
		loading.show('Revogando assinatura...');
		// Keep local revoke logic since hook doesn't cover it yet
		try {
			await apiFetch(`/api/escalas/${escalaId}/documento-assinado`, { method: 'DELETE' });
			documentoAssinadoInfo = null;
			toaster.create({
				title: 'Assinatura revogada',
				description: 'Você agora pode editar os dados da escala.',
				type: 'info'
			});
		} catch (e: unknown) {
			toaster.create({
				title: 'Erro ao revogar assinatura',
				description: e instanceof Error ? e.message : undefined,
				type: 'error'
			});
		} finally {
			loading.hide();
		}
	}

	function abrirModalAssinatura() {
		if (policiaisCount === 0) {
			toaster.create({ title: 'Adicione ao menos um policial antes de confirmar', type: 'error' });
			return;
		}
		assinatura.dialogSignOpen = true;
	}

	async function assinarSimples(payload: SignaturePadConfirmPayload) {
		assinatura.dialogSignOpen = false;
		await assinatura.assinarSimples(
			payload.rubrica,
			payload.lat,
			payload.lng,
			payload.selfie,
			payload.codigoEmail,
			payload.desafioId,
			payload.liveness
		);
	}

	let painelTokenControl = $state<{ assinarComSerpro: () => Promise<void> } | null>(null);

	const podeAssinar = $derived(
		usuario?.tipo === 'admin' ||
			((usuario?.papel === 'admin_seccional' || usuario?.papel === 'admin_unidade') &&
				usuario?.cargo === 'DPC')
	);

	let signatureStep = $state<'signature' | 'camera' | 'email_code'>('signature');
	$effect(() => {
		if (dialogSignOpen) {
			signatureStep = 'signature';
		}
	});

	const signatureTitulo = $derived(
		signatureStep === 'camera'
			? 'Prova de Vida'
			: signatureStep === 'email_code'
				? 'Confirmação de Identidade'
				: 'Assinatura Digital em Tela'
	);
	const signatureDescricao = $derived(
		signatureStep === 'camera'
			? 'Cumpra o desafio de presença na tela para provar que você está ativo.'
			: signatureStep === 'email_code'
				? 'Por razões de segurança, insira o código enviado para o seu e-mail funcional.'
				: 'Desenhe sua rubrica no quadro abaixo para assinar este documento da escala com validade jurídica (nos moldes da assinatura eletrônica).'
	);
</script>

<!-- Diálogo de confirmação de revogação de assinatura -->
<Dialog open={dialogRevogacaoAberto} onOpenChange={(e) => (dialogRevogacaoAberto = e.open)}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card p-4 sm:p-6 max-w-sm w-full max-h-[calc(100dvh-2rem)] overflow-y-auto card-elevated shadow-2xl rounded-2xl"
		>
			<Dialog.Title class="h3 font-bold mb-2">Revogar assinatura?</Dialog.Title>
			<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
				Isso excluirá o PDF oficial e permitirá editar a escala novamente. Esta ação não pode ser
				desfeita.
			</Dialog.Description>
			<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
				<button
					type="button"
					class="btn preset-outlined-surface-500"
					onclick={() => (dialogRevogacaoAberto = false)}
				>
					Cancelar
				</button>
				<button
					type="button"
					class="btn preset-filled-error-500 flex items-center gap-2"
					onclick={confirmarRevogacao}
					disabled={loading.active}
				>
					{loading.active ? 'Revogando...' : 'Revogar'}
				</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog>

<!-- Banner: escala assinada -->
{#if documentoAssinadoInfo?.existe}
	<div
		class="mb-6 p-4 sm:p-5 bg-success-500/10 border border-success-500/30 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm"
	>
		<div class="flex items-center gap-4">
			<div class="bg-success-500/20 p-3 rounded-xl">
				<svg
					class="w-6 h-6 text-success-600 dark:text-success-400"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
			</div>
			<div>
				<h3 class="font-bold text-success-800 dark:text-success-400 text-lg">
					Escala Oficialmente Assinada
				</h3>
				<p class="text-sm text-success-700 dark:text-success-300 mt-0.5">
					Assinado por <strong>{documentoAssinadoInfo.assinante_nome || ''}</strong> em {documentoAssinadoInfo.data
						? new Date(documentoAssinadoInfo.data).toLocaleDateString('pt-BR')
						: '—'}.
				</p>
			</div>
		</div>
		<div class="flex items-center gap-3 w-full sm:w-auto">
			<a
				href={`/api/escalas/${escalaId}/documento-assinado`}
				class="btn preset-filled-success-500 font-bold px-5 py-2.5 rounded-xl shadow-sm transition-all flex-1 sm:flex-none justify-center no-underline"
				target="_blank"
			>
				<svg class="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
					/>
				</svg>
				Download PDF
			</a>
			<button
				type="button"
				class="btn preset-outlined-error-500 font-bold px-5 py-2.5 rounded-xl transition-all flex-1 sm:flex-none justify-center"
				onclick={revogarAssinatura}
				disabled={assinando}
			>
				Revogar
			</button>
		</div>
	</div>
{/if}

<!-- SEÇÃO DE ASSINATURA -->
{#if podeAssinar && !documentoAssinadoInfo?.existe && policiaisCount > 0}
	<div class="mb-6">
		<!-- Botão toggle -->
		<button
			type="button"
			class="w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all duration-200 {painelAberto
				? 'bg-surface-200/80 dark:bg-surface-800/80 border-surface-300 dark:border-surface-600'
				: 'bg-surface-100/60 dark:bg-surface-900/60 border-surface-200 dark:border-white/5 hover:border-primary-400/40'}"
			onclick={() => (painelAberto = !painelAberto)}
		>
			<span
				class="flex items-center gap-2 text-sm font-semibold text-surface-700 dark:text-surface-200"
			>
				<svg class="w-4 h-4 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
					/>
				</svg>
				Opções de Assinatura
			</span>
			<svg
				class="w-4 h-4 text-surface-400 transition-transform duration-200 {painelAberto
					? 'rotate-180'
					: ''}"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
			</svg>
		</button>

		{#if painelAberto}
			<div transition:slide={{ duration: 220 }} class="mt-3 space-y-3">
				<p class="text-3xs text-surface-400 dark:text-surface-500 italic px-1">
					Ao confirmar, você atesta valor jurídico equivalente à assinatura manuscrita, conforme o
					<a href="/termo" target="_blank" rel="noopener" class="underline hover:text-primary-500"
						>Termo de Uso</a
					> aceito.
				</p>

				<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
					<!-- Card 1: Assinar na Tela -->
					<div
						class="flex items-center justify-between px-4 py-3 rounded-xl border bg-warning-500/5 border-warning-500/20"
					>
						<div class="flex items-center gap-2 min-w-0">
							<svg
								class="w-4 h-4 text-warning-500 shrink-0"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
								/>
							</svg>
							<div class="min-w-0">
								<p
									class="text-xs font-semibold text-surface-700 dark:text-surface-200 leading-none"
								>
									Rubrica na Tela
								</p>
								<p class="text-3xs text-surface-500 dark:text-surface-400 mt-0.5">
									Ideal para tablets e smartphones
								</p>
							</div>
						</div>
						{#if isMobile}
							<button
								type="button"
								class="btn btn-sm preset-filled-warning-500 font-bold text-xs px-3 shrink-0 transition-all"
								disabled={loading.active}
								onclick={abrirModalAssinatura}>Assinar</button
							>
						{:else}
							<span
								class="text-3xs font-bold uppercase text-surface-500 dark:text-surface-400 shrink-0"
								>Mobile only</span
							>
						{/if}
					</div>

					<!-- Card 2: Certificado Digital (A1/A3) -->
					<div
						class="flex items-center justify-between px-4 py-3 rounded-xl border bg-tertiary-500/5 border-tertiary-500/20"
					>
						<div class="flex items-center gap-2 min-w-0">
							<svg
								class="w-4 h-4 text-tertiary-500 shrink-0"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
								/>
							</svg>
							<div class="min-w-0">
								<p
									class="text-xs font-semibold text-surface-700 dark:text-surface-200 leading-none"
								>
									Certificado Digital <span class="text-3xs font-black text-tertiary-500 uppercase"
										>ICP-Brasil</span
									>
								</p>
								<p class="text-3xs text-surface-500 dark:text-surface-400 mt-0.5">
									Via Assinador SERPRO (desktop)
								</p>
							</div>
						</div>
						{#if !isMobile}
							<button
								type="button"
								class="btn btn-sm preset-filled-tertiary-500 font-bold text-xs px-3 shrink-0 transition-all"
								disabled={assinando}
								onclick={() => {
									if (painelTokenControl) painelTokenControl.assinarComSerpro();
									else
										toaster.error({
											title: 'Painel de assinatura não inicializado',
											description: 'Recarregue a página (F5) e tente novamente.'
										});
								}}>Assinar</button
							>
						{:else}
							<span
								class="text-3xs font-bold uppercase text-surface-500 dark:text-surface-400 shrink-0"
								>Desktop only</span
							>
						{/if}
					</div>
				</div>
			</div>
		{/if}

		<!-- PainelAssinaturaToken oculto -->
		<div class="sr-only" aria-hidden="true">
			<PainelAssinaturaToken
				bind:control={painelTokenControl}
				signerName={usuario?.nome ?? undefined}
				signerCpf={usuario?.cpf ?? undefined}
				prepararUrl="/api/escalas/{escalaId}/preparar-assinatura"
				finalizarUrl="/api/escalas/{escalaId}/finalizar-assinatura"
				nomeArquivo="escala_assinada.pdf"
				disabled={assinando}
				onSuccess={async () => {
					await invalidateAll();
				}}
			/>
		</div>
	</div>

	<!-- OIP: painel de solicitação de assinatura (oculto para DPC — eles assinam diretamente) -->
	{#if podeOIPSolicitar && !documentoAssinadoInfo?.existe && usuario?.cargo !== 'DPC'}
		{#if solicitacaoLocal}
			<div class="mb-6 p-3 bg-warning-500/10 border border-warning-500/25 rounded-2xl shadow-sm">
				<div class="flex items-center gap-3">
					<div
						class="w-9 h-9 rounded-xl bg-warning-500/20 flex items-center justify-center shrink-0"
					>
						<svg
							class="w-4 h-4 text-warning-600 dark:text-warning-400"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
					</div>
					<div class="flex-1 min-w-0">
						<p class="font-bold text-sm text-warning-800 dark:text-warning-300 leading-tight">
							Aguardando Assinatura
						</p>
						<p class="text-xs text-warning-600 dark:text-warning-400 mt-0.5 truncate">
							{solicitacaoLocal.tipo === 'respondencia'
								? 'Aguardando delegado em respondência'
								: 'Aguardando admin da unidade'}
						</p>
					</div>
					<button
						type="button"
						class="btn btn-sm preset-outlined-error-500 shrink-0 font-semibold text-xs px-3"
						onclick={cancelarSolicitacao}>Cancelar</button
					>
				</div>
			</div>
		{:else}
			<div
				class="mb-6 p-3 bg-surface-100/80 dark:bg-surface-800/60 border border-surface-200 dark:border-white/10 rounded-2xl shadow-sm"
			>
				<div class="flex items-center gap-3">
					<div
						class="w-9 h-9 rounded-xl bg-success-500/15 flex items-center justify-center shrink-0"
					>
						<svg
							class="w-4 h-4 text-success-600 dark:text-success-400"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
					</div>
					<div class="flex-1 min-w-0">
						<p class="font-bold text-sm text-surface-700 dark:text-surface-200 leading-tight">
							Solicitar Assinatura
						</p>
						<p class="text-xs text-surface-500 mt-0.5">Notifique o delegado para assinar.</p>
					</div>
					<button
						type="button"
						class="btn btn-sm preset-filled-success-500 font-bold shrink-0 text-xs px-3 transition-all"
						onclick={() => (dialogSolicitarAberto = true)}
					>
						Solicitar
					</button>
				</div>
			</div>
		{/if}
	{/if}

	<!-- Downloads auxiliares — sempre visíveis para escalas não-FDS -->
	<div class="py-3 border-t border-surface-200 dark:border-white/5 mb-4">
		<span
			class="text-3xs font-bold text-surface-500 dark:text-surface-400 uppercase tracking-widest mb-2 block"
			>Você pode conferir a escala antes de assinar ou solicitar uma assinatura</span
		>
		<div class="flex gap-2 flex-wrap">
			{#each ['DOCX', 'XLSX', 'PDF'] as format (format)}
				<a
					class="btn btn-sm bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 border border-surface-200 dark:border-white/5 text-3xs font-bold uppercase px-3 py-1.5 no-underline transition-all rounded-lg"
					href={`/api/escalas/${escalaId}/download?format=${format.toLowerCase()}`}
					target="_blank">{format}</a
				>
			{/each}
		</div>
	</div>
{/if}

<!-- Dialog Solicitar Assinatura (OIP) — componente compartilhado com a lista /escalas -->
<DialogSolicitarAssinatura
	bind:open={dialogSolicitarAberto}
	{escalaId}
	onConfirmado={(solicitacao) => {
		solicitacaoLocal = solicitacao;
		onSolicitacaoEnviada?.();
	}}
/>

<Dialog
	open={dialogSignOpen}
	onOpenChange={(e) => {
		if (!e.open) assinatura.dialogSignOpen = false;
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card p-4 sm:p-6 max-w-lg w-full max-h-[calc(100dvh-2rem)] overflow-y-auto card-elevated shadow-2xl rounded-2xl"
		>
			<Dialog.Title class="h3 font-bold mb-2">{signatureTitulo}</Dialog.Title>
			<Dialog.Description class="text-xs text-surface-600 dark:text-surface-400 mb-4">
				{signatureDescricao}
			</Dialog.Description>
			{#if dialogSignOpen}
				<SignaturePad
					message="Rubrica do Organizador"
					onConfirm={assinarSimples}
					onCancel={() => (assinatura.dialogSignOpen = false)}
					exigirFoto={page.data.exigirFotoAssinatura ?? true}
					exigirGps={page.data.exigirGpsAssinatura ?? true}
					exigirCodigoEmail={page.data.exigirCodigoEmailAssinatura ?? false}
					bind:step={signatureStep}
				/>
			{/if}
		</div>
	</Dialog.Content>
</Dialog>
