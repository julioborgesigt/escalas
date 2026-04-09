<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
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

	const { isMobile } = useMobile();

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
{#if documentoAssinadoInfo}
	<div
		class="mb-6 p-4 sm:p-5 bg-success-500/10 border-2 border-success-500/30 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-md"
	>
		<div>
			<h3 class="font-bold text-success-700 dark:text-success-400 flex items-center gap-2 text-lg">
				<svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
				Escala Oficialmente Assinada
			</h3>
			<p class="text-sm text-surface-600 dark:text-surface-300 mt-1">
				Assinado por <strong>{documentoAssinadoInfo.assinante_nome || ''}</strong>.
				{isFDS
					? 'Confirmação administrativa gerada e guardada para download.'
					: 'Arquivo original ICP-Brasil guardado nos servidores para download.'}
			</p>
		</div>
		<div class="flex flex-col sm:flex-row gap-3">
			<a
				href={`/api/escalas/${escalaId}/documento-assinado`}
				class="btn preset-filled-success-500 shrink-0 font-bold px-6 py-3 shadow-lg shadow-success-500/30 hover:scale-105 transition-transform"
				target="_blank"
			>
				<svg class="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
					/>
				</svg>
				Baixar PDF
			</a>
			<button
				class="btn preset-outlined-error-500 shrink-0 font-bold px-6 py-3"
				onclick={revogarAssinatura}
				disabled={assinando}
			>
				<svg class="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
					/>
				</svg>
				Revogar para Editar
			</button>
		</div>
	</div>
{/if}

<!-- SEÇÃO DE ASSINATURA UNIFICADA -->
{#if !documentoAssinadoInfo && policiaisCount > 0}
	<div class="space-y-6">
		<h3
			class="flex items-center gap-2 text-lg font-bold uppercase tracking-widest text-primary-500"
		>
			<svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"
				><path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
				/></svg
			>
			Assinar Escala GISE
		</h3>

		<div class="grid grid-cols-1 gap-6">
			<!-- 1. ASSINATURA MANUAL (TELA/MOBILE) -->
			<div
				class="card p-5 bg-surface-100/50 dark:bg-surface-800/40 border-2 {isMobile
					? 'border-primary-500/30'
					: 'border-surface-200 dark:border-white/5 opacity-60'} rounded-3xl flex flex-col justify-between shadow-xl transition-all h-full"
			>
				<div>
					<div class="flex items-center justify-between mb-4">
						<h4 class="font-bold text-sm flex items-center gap-2">
							<svg
								class="w-5 h-5 {isMobile ? 'text-primary-500' : 'text-surface-400'}"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
								/></svg
							>
							Assinar na Tela
						</h4>
						{#if isMobile}
							<span
								class="badge preset-filled-primary-500 text-[0.6rem] uppercase font-black px-2 py-0.5"
								>Disponível</span
							>
						{:else}
							<span
								class="badge bg-surface-200 dark:bg-surface-700 text-surface-500 text-[0.6rem] uppercase font-black px-2 py-0.5"
								>Indisponível no PC</span
							>
						{/if}
					</div>
					<p class="text-xs text-surface-500 leading-relaxed mb-4">
						Gera o PDF com sua rubrica manual desenhada na tela. <strong
							>Ideal para tablets e smartphones.</strong
						> Possui plena validade jurídica conforme Lei 14.063/20.
					</p>
				</div>

				{#if isMobile}
					<button
						class="btn preset-filled-primary-500 w-full py-3 rounded-2xl font-bold uppercase text-xs shadow-lg shadow-primary-500/20 hover:scale-[1.02] active:scale-95 transition-all"
						disabled={assinandoSimples || policiaisCount === 0}
						onclick={abrirModalAssinatura}
					>
						{#if assinandoSimples}
							<span
								class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"
							></span>
							Gerando PDF...
						{:else}
							Abrir Painel de Rubrica
						{/if}
					</button>
				{:else}
					<div class="bg-error-500/10 p-3 rounded-xl border border-error-500/20">
						<p class="text-[0.65rem] text-error-600 font-bold uppercase text-center leading-tight">
							A assinatura em tela é restrita a dispositivos móveis. Utilize o Token A3 no
							computador.
						</p>
					</div>
				{/if}
			</div>

			<!-- 2. ASSINATURA DIGITAL (TOKEN A3) -->
			<div
				class="card p-5 bg-surface-100/50 dark:bg-surface-800/40 border-2 {!isMobile
					? 'border-tertiary-500/30'
					: 'border-surface-200 dark:border-white/5'} rounded-3xl flex flex-col justify-between shadow-xl transition-all h-full"
			>
				<div>
					<div class="flex items-center justify-between mb-4">
						<h4 class="font-bold text-sm flex items-center gap-2">
							<svg
								class="w-5 h-5 {!isMobile ? 'text-tertiary-500' : 'text-surface-400'}"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								><path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
								/></svg
							>
							Token / Certificado A3
						</h4>
						{#if !isMobile}
							<span
								class="badge preset-filled-tertiary-500 text-[0.6rem] uppercase font-black px-2 py-0.5"
								>Recomendado</span
							>
						{:else}
							<span
								class="badge bg-surface-200 dark:bg-surface-700 text-surface-500 text-[0.6rem] uppercase font-black px-2 py-0.5"
								>Apenas Desktop</span
							>
						{/if}
					</div>
					<p class="text-xs text-surface-500 leading-relaxed mb-4">
						Assinatura com validade <strong>Qualificada (ICP-Brasil)</strong> usando seu certificado digital
						físico ou e-CPF. Requer o Assinador Desktop instalado.
					</p>

					<!-- Leitor de Certificados (Apenas Desktop) -->
					{#if !isMobile}
						<div class="mb-4 space-y-3">
							<div
								class="flex justify-between items-center bg-surface-200/50 dark:bg-surface-900/50 p-3 rounded-xl border border-surface-300/30"
							>
								<span class="text-[0.65rem] font-bold uppercase opacity-60">Leitura de Token</span>
								<button
									class="btn btn-sm preset-outlined-tertiary-500 text-[0.6rem] px-3 py-1 font-black"
									onclick={carregarCertificadosLocais}
									disabled={lendoCertificados}
								>
									{lendoCertificados ? 'Lendo...' : 'Ler Tokens'}
								</button>
							</div>

							{#if certificados.length > 0}
								<select
									class="select text-xs bg-white dark:bg-surface-900 rounded-lg p-2 w-full border border-surface-300/30"
									bind:value={certSelecionado}
								>
									<option value="">Selecione seu certificado...</option>
									{#each certificados as cert}
										<option value={cert.thumbprint}>{cert.subjectName}</option>
									{/each}
								</select>
							{:else if tentouLerCertificados}
								<p class="text-[0.6rem] text-error-500 bg-error-500/5 p-2 rounded-lg italic">
									Nenhum certificado detectado. Verifique o token ou use o SERPRO diretamente.
								</p>
							{/if}
						</div>
					{/if}
				</div>

				{#if !isMobile}
					<div class="space-y-3">
						<button
							class="btn preset-filled-tertiary-500 w-full py-3 rounded-2xl font-bold uppercase text-xs shadow-lg shadow-tertiary-500/20 hover:scale-[1.02] active:scale-95 transition-all"
							onclick={assinarComSerpro}
							disabled={assinando}
						>
							{#if assinando}
								<span
									class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"
								></span>
								{etapaAssinatura || 'Finalizando...'}
							{:else}
								Assinar Documento Oficial
							{/if}
						</button>
						<p class="text-[0.55rem] text-surface-400 text-center uppercase tracking-tighter">
							Usa tecnologia WebPKI e <a
								href="https://www.serpro.gov.br/"
								target="_blank"
								class="underline">SERPRO</a
							> oficial.
						</p>
					</div>
				{:else}
					<div
						class="bg-surface-200 dark:bg-surface-700/30 p-3 rounded-xl border border-surface-300 dark:border-surface-600/30"
					>
						<p
							class="text-[0.65rem] text-surface-500 font-bold uppercase text-center leading-tight"
						>
							Certificados físicos (USB/Token/Cartão) só podem ser lidos em computadores.
						</p>
					</div>
				{/if}
			</div>
		</div>

		<!-- Exportações auxiliares -->
		<div class="pt-4 border-t border-surface-200 dark:border-white/5">
			<span class="text-[0.65rem] font-bold text-surface-500 uppercase tracking-widest mb-3 block"
				>Outros Formatos (Sem Assinatura)</span
			>
			<div class="flex gap-2 flex-wrap">
				{#each ['docx', 'xlsx', 'pdf'] as format}
					<a
						class="btn btn-sm preset-tonal-surface text-[0.65rem] font-bold uppercase px-3 py-1.5 no-underline"
						href={`/api/escalas/${escalaId}/download?format=${format}`}
						target="_blank">{format.toUpperCase()}</a
					>
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
