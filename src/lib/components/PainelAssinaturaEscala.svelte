<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import PainelAssinaturaToken from './PainelAssinaturaToken.svelte';
	import SignaturePad from './SignaturePad.svelte';
	import type { UsuarioLogado } from '$lib/auth';
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';
	import { csrfHeaders } from '$lib/csrf';
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
		documentoAssinadoInfo = $bindable()
	}: {
		escalaId: string;
		isFDS: boolean;
		policiaisCount: number;
		usuario: UsuarioLogado | null;
		documentoAssinadoInfo: DocumentoAssinadoInfo | null;
	} = $props();

	const mobileState = useMobile();
	const isMobile = $derived(mobileState.isMobile);

	const assinatura = useAssinaturaEscala({
		getParams: () => ({ escalaId, isFDS, policiaisCount, usuario }),
		onDocumentoAssinado: (info) => {
			documentoAssinadoInfo = info;
		}
	});

	// Aliases para compatibilidade com template
	let assinando = $derived(assinatura.assinando);
	let etapaAssinatura = $derived(assinatura.etapaAssinatura);
	let assinandoSimples = $derived(assinatura.assinandoSimples);
	let dialogSignOpen = $derived(assinatura.dialogSignOpen);
	let certSelecionado = $state('');
	function setCertSelecionado(v: string) {
		certSelecionado = v;
		assinatura.onCertSelecionado(v);
	}
	let certificados = $derived(assinatura.certificados);
	let lendoCertificados = $derived(assinatura.lendoCertificados);
	let tentouLerCertificados = $derived(assinatura.tentouLerCertificados);
	let serproSignerName = $derived(assinatura.serproSignerName);
	let serproSignerCpf = $derived(assinatura.serproSignerCpf);

	async function revogarAssinatura() {
		if (
			!confirm(
				'Você tem certeza que deseja revogar a assinatura digital? Isso excluirá o PDF oficial e permitirá editar a escala novamente.'
			)
		)
			return;
		assinatura.dialogSignOpen = false;
		// Keep local revoke logic since hook doesn't cover it yet
		try {
			const res = await fetch(`/api/escalas/${escalaId}/documento-assinado`, {
				method: 'DELETE',
				headers: csrfHeaders()
			});
			if (res.ok) {
				documentoAssinadoInfo = null;
				toaster.create({
					title: 'Assinatura revogada',
					description: 'Você agora pode editar os dados da escala.',
					type: 'info'
				});
			} else {
				throw new Error('Falha ao revogar');
			}
		} catch {
			toaster.create({ title: 'Erro ao revogar assinatura', type: 'error' });
		}
	}

	function abrirModalAssinatura() {
		if (policiaisCount === 0) {
			toaster.create({ title: 'Adicione ao menos um policial antes de confirmar', type: 'error' });
			return;
		}
		assinatura.dialogSignOpen = true;
	}

	async function assinarSimples(
		rubricBase64: string,
		gpsLat?: number,
		gpsLng?: number,
		selfieBase64?: string | null,
		codigoValidação?: string,
		desafioId?: string
	) {
		assinatura.dialogSignOpen = false;
		await assinatura.assinarSimples(rubricBase64, gpsLat, gpsLng, selfieBase64, codigoValidação, desafioId);
	}

	// WebPKI helpers (still needed in component for template bindings)
	async function carregarCertificadosLocais() {
		await assinatura.loadCertificados();
	}

	async function assinarComSerpro() {
		await assinatura.assinarComSerpro();
	}
</script>

<!-- Banner: escala assinada -->
{#if documentoAssinadoInfo?.existe}
	<div
		class="mb-6 p-5 bg-success-500/10 border border-success-500/30 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm"
	>
		<div class="flex items-center gap-4">
			<div class="bg-success-500/20 p-3 rounded-xl">
				<svg class="w-6 h-6 text-success-600 dark:text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
			</div>
			<div>
				<h3 class="font-bold text-success-800 dark:text-success-400 text-lg">
					Escala Oficialmente Assinada
				</h3>
				<p class="text-sm text-success-700 dark:text-success-300 mt-0.5">
					Assinado por <strong>{documentoAssinadoInfo.assinante_nome || ''}</strong> em {documentoAssinadoInfo.data ? new Date(documentoAssinadoInfo.data).toLocaleDateString('pt-BR') : '—'}.
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
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
				</svg>
				Download PDF
			</a>
			<button
				class="btn preset-outlined-error-500 font-bold px-5 py-2.5 rounded-xl transition-all flex-1 sm:flex-none justify-center"
				onclick={revogarAssinatura}
				disabled={assinando}
			>
				Revogar
			</button>
		</div>
	</div>
{/if}

<!-- SEÇÃO DE ASSINATURA UNIFICADA (Idêntica à GISE) -->
{#if !documentoAssinadoInfo?.existe && policiaisCount > 0}
	<div class="space-y-6">
		<h3 class="flex items-center gap-2 text-lg font-bold uppercase tracking-widest text-primary-500">
			<svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
			</svg>
			Assinar Escala GISE
		</h3>

		<div class="space-y-4">
			<!-- CARD 1: ASSINATURA NA TELA (MANUAL) -->
			<div class="card p-6 bg-surface-100/50 dark:bg-surface-800/40 border border-surface-200 dark:border-white/5 rounded-3xl shadow-sm space-y-4 transition-all">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<svg class="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
						</svg>
						<h4 class="font-bold text-sm text-surface-700 dark:text-surface-200">Assinar na Tela (Manual)</h4>
					</div>
					{#if !isMobile}
						<span class="text-[0.6rem] font-black uppercase px-2 py-0.5 rounded bg-surface-200 dark:bg-surface-700 text-surface-500 tracking-tighter">INDISPONÍVEL NO PC</span>
					{/if}
				</div>
				
				<p class="text-xs text-surface-500 leading-relaxed italic">
					Gera o PDF com sua rubrica manual desenhada diretamente na tela do seu dispositivo. <strong>Ideal para tablets e smartphones.</strong>
				</p>

				{#if isMobile}
					<button
						class="btn preset-filled-primary-500 font-bold px-6 py-2.5 rounded-xl shadow-md transition-all active:scale-95"
						disabled={assinandoSimples}
						onclick={abrirModalAssinatura}
					>
						{#if assinandoSimples}<Spinner size="xs" class="mr-2" />{/if}
						Abrir Painel de Rubrica
					</button>
				{:else}
					<div class="p-3 py-4 rounded-xl bg-error-500/5 border border-error-500/10 flex items-center justify-center">
						<p class="text-[0.6rem] text-error-600 font-bold uppercase tracking-tight text-center">
							A ASSINATURA EM TELA É RESTRITA A DISPOSITIVOS MÓVEIS. UTILIZE O TOKEN A3 NO COMPUTADOR.
						</p>
					</div>
				{/if}
			</div>

			<!-- CARD 2: ASSINATURA DIGITAL (TOKEN A3) -->
			<div class="card p-6 bg-success-500/5 dark:bg-success-900/5 border border-success-500/30 rounded-3xl shadow-sm space-y-4">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<svg class="w-5 h-5 text-success-600 dark:text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
						</svg>
						<h4 class="font-bold text-sm text-surface-700 dark:text-surface-200 tracking-tight">Assinatura Digital (Token A3)</h4>
					</div>
					{#if !isMobile}
						<span class="text-[0.6rem] font-black uppercase px-2 py-0.5 rounded bg-success-500 text-white tracking-tighter">RECOMENDADO</span>
					{/if}
				</div>

				<p class="text-xs text-surface-500 leading-relaxed italic">
					Assinatura com validade <strong>Qualificada (ICP-Brasil)</strong> usando seu certificado digital físico. Requer o Assinador Desktop instalado no computador.
				</p>

				{#if !isMobile}
					<PainelAssinaturaToken
						signerName={usuario?.nome}
						signerCpf={usuario?.cpf}
						prepararUrl="/api/escalas/{escalaId}/preparar-assinatura"
						finalizarUrl="/api/escalas/{escalaId}/finalizar-assinatura"
						nomeArquivo="escala_assinada.pdf"
						disabled={assinando}
						onSuccess={async () => {
							await invalidateAll();
						}}
					/>
				{:else}
					<div class="p-3 py-4 rounded-xl bg-surface-500/10 border border-surface-500/20 flex items-center justify-center">
						<p class="text-[0.6rem] text-surface-500 font-bold uppercase tracking-tight text-center">
							RECURSO DE TOKEN A3 DISPONÍVEL APENAS EM NAVEGADORES DESKTOP.
						</p>
					</div>
				{/if}
			</div>
		</div>

		<!-- Exportações auxiliares -->
		<div class="py-4 border-t border-surface-200 dark:border-white/5">
			<span class="text-[0.6rem] font-bold text-surface-400 uppercase tracking-widest mb-3 block">OUTROS FORMATOS (CONFERÊNCIA)</span>
			<div class="flex gap-2 flex-wrap">
				{#each ['DOCX', 'XLSX', 'PDF'] as format}
					<a
						class="btn btn-sm bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 border border-surface-200 dark:border-white/5 text-[0.65rem] font-bold uppercase px-3 py-1.5 no-underline transition-all rounded-lg"
						href={`/api/escalas/${escalaId}/download?format=${format.toLowerCase()}`}
						target="_blank">{format}</a>
				{/each}
			</div>
		</div>
	</div>
{/if}

<Dialog open={dialogSignOpen} onOpenChange={(e) => (dialogSignOpen = e.open)}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
	>
		<div
			class="card p-6 max-w-lg w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-2">Assinatura Digital em Tela</Dialog.Title>
			<Dialog.Description class="text-xs text-surface-600 dark:text-surface-400 mb-4">
				Desenhe sua rubrica no quadro abaixo para assinar este documento da escala com validade
				jurídica (nos moldes da assinatura eletrônica).
			</Dialog.Description>

			<SignaturePad
				message="Rubrica do Organizador"
				onConfirm={assinarSimples}
				onCancel={() => (dialogSignOpen = false)}
				exigirFoto={page.data.exigirFotoAssinatura ?? true}
				exigirGps={page.data.exigirGpsAssinatura ?? true}
				exigirCodigoEmail={page.data.exigirCodigoEmailAssinatura ?? false}
			/>
		</div>
	</Dialog.Content>
</Dialog>
