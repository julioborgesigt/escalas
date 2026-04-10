<script lang="ts">
	/**
	 * PainelAssinaturaToken.svelte
	 *
	 * Componente genérico de assinatura digital com TOKEN A3 (WebPKI e SERPRO).
	 * Encapsula toda a lógica de: carregar certificados, assinar hash (WebPKI)
	 * ou delegar ao SERPRO, chamar o endpoint de preparação, finalizar e baixar PDF.
	 *
	 * Props:
	 *   - prepararUrl: URL do endpoint POST preparar-assinatura
	 *   - finalizarUrl: URL do endpoint POST finalizar-assinatura
	 *   - nomeArquivo: nome padrão do PDF baixado (ex: "gise_2025-04-01_assinada.pdf")
	 *   - signerName: nome pré-preenchido do assinante (geralmente data.usuario.nome)
	 *   - signerCpf: CPF pré-preenchido (opcional)
	 *   - extraPayload: objeto com campos extras a enviar nos payloads de preparar/finalizar
	 *   - disabled: desabilita os botões (ex: enquanto alguma outra tarefa está em andamento)
	 *   - onSuccess: callback chamado após assinatura bem-sucedida (ex: invalidateAll)
	 */

	import { toaster } from '$lib/toast';
	import { conectarSerpro, type SerproSignerClient } from '$lib/serpro';
	import { csrfHeaders } from '$lib/csrf';
	import Spinner from './Spinner.svelte';

	let {
		prepararUrl,
		finalizarUrl,
		nomeArquivo = 'documento_assinado.pdf',
		signerName = $bindable(''),
		signerCpf = $bindable(''),
		extraPayload = {} as Record<string, unknown>,
		disabled = false,
		onSuccess = async () => {}
	}: {
		prepararUrl: string;
		finalizarUrl: string;
		nomeArquivo?: string;
		signerName?: string;
		signerCpf?: string;
		extraPayload?: Record<string, unknown>;
		disabled?: boolean;
		onSuccess?: () => Promise<void>;
	} = $props();

	// ---- Estado interno ----
	let assinando = $state(false);
	let etapa = $state('');

	// SERPRO
	let serproClient = $state<SerproSignerClient | null>(null);

	// ---- Helpers ----

	async function getCoords(): Promise<{ lat: number; lng: number } | null> {
		if (typeof window === 'undefined' || !('geolocation' in navigator)) return null;
		try {
			return await new Promise((resolve, reject) =>
				navigator.geolocation.getCurrentPosition(
					(p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
					reject,
					{ enableHighAccuracy: true, timeout: 5000 }
				)
			);
		} catch {
			return null;
		}
	}

	function hexToBase64(hex: string): string {
		return btoa(
			hex
				.match(/.{2}/g)!
				.map((h) => String.fromCharCode(parseInt(h, 16)))
				.join('')
		);
	}

	function baixarBlob(blob: Blob, nome: string) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = nome;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	// ---- Fluxo principal: preparar → assinar → finalizar ----

	async function executarAssinatura(
		getSignature: (signedAttrsHashHex: string, messageDigestHex: string) => Promise<{
			rawSignature?: string;
			certificateBase64?: string;
			serproCms?: string;
		}>
	) {
		assinando = true;
		etapa = 'Gerando PDF e preparando assinatura...';
		const coords = await getCoords();

		try {
			// 1. Preparar
			const prepResp = await fetch(prepararUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
				body: JSON.stringify({
					signerName,
					signerCpf,
					latitude: coords?.lat,
					longitude: coords?.lng,
					...extraPayload
				})
			});
			if (!prepResp.ok) {
				const err = await prepResp.json().catch(() => ({}));
				throw new Error(err.error || 'Erro ao preparar assinatura');
			}
			const {
				preparedPdf,
				signedAttrsHashHex,
				messageDigest,
				signingTimeISO,
				verificationHash
			} = await prepResp.json();

			// 2. Assinar (WebPKI ou SERPRO)
			etapa = 'Aguardando assinatura no token...';
			const sigResult = await getSignature(signedAttrsHashHex, messageDigest);

			// 3. Finalizar
			etapa = 'Finalizando PDF assinado...';
			const finResp = await fetch(finalizarUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
				body: JSON.stringify({
					preparedPdf,
					...sigResult,
					messageDigest,
					signingTimeISO,
					signerName,
					signerCpf,
					verificationHash,
					latitude: coords?.lat,
					longitude: coords?.lng,
					...extraPayload
				})
			});
			if (!finResp.ok) {
				const err = await finResp.json().catch(() => ({}));
				throw new Error(err.error || 'Erro ao finalizar assinatura');
			}

			// 4. Baixar
			etapa = 'Baixando PDF assinado...';
			const blob = await finResp.blob();
			// Tenta pegar o nome do Content-Disposition, fallback para prop nomeArquivo
			const cd = finResp.headers.get('Content-Disposition');
			const nome = cd?.match(/filename="(.+)"/)?.[1] || nomeArquivo;
			baixarBlob(blob, nome);

			toaster.success({ title: 'PDF assinado com sucesso!' });
			await onSuccess();
		} catch (err: any) {
			toaster.error({
				title: 'Erro na assinatura',
				description: err.message
			});
		} finally {
			assinando = false;
			etapa = '';
		}
	}

	// ---- Ação: assinar com SERPRO ----

	export async function assinarComSerpro() {
		assinando = true;
		etapa = 'Conectando ao Assinador SERPRO...';
		try {
			const client = serproClient ?? (await conectarSerpro());
			serproClient = client;

			await executarAssinatura(async (_signedAttrsHashHex, messageDigestHex) => {
				etapa = 'Selecione o certificado e assine no SERPRO...';
				const messageDigestBase64 = hexToBase64(messageDigestHex);
				const result = await client.sign(messageDigestBase64);
				const serproCms = result.rawSignature;
				return { serproCms };
			});
		} catch (err: any) {
			toaster.error({ title: 'Erro no Assinador SERPRO', description: err.message });
			serproClient?.disconnect();
			serproClient = null;
			assinando = false;
			etapa = '';
		} finally {
			serproClient?.disconnect();
			serproClient = null;
		}
	}
</script>

<!-- ─── UI ─────────────────────────────────────────────────────────────────── -->

<!-- Dados do Assinante (Dashboard Style) -->
<div class="mb-4 p-4 bg-surface-100/50 dark:bg-surface-800/40 rounded-xl border border-surface-200 dark:border-white/5 flex gap-4 items-center shadow-sm">
	<div class="bg-primary-500/10 p-3 rounded-lg flex-shrink-0">
		<svg class="w-6 h-6 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
		</svg>
	</div>
	
	<div class="flex-1">
		<div class="flex flex-col mb-2">
			<h4 class="font-bold text-sm text-surface-900 dark:text-white flex items-center gap-2">
				Dados do Assinante
			</h4>
			<p class="text-[0.6rem] text-surface-500 uppercase tracking-wider font-semibold">CONFORME CADASTRO NO SISTEMA</p>
		</div>

		<div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
			<div class="flex flex-col">
				<span class="text-[0.6rem] font-bold text-surface-400 uppercase tracking-tighter">NOME</span>
				<span class="font-bold text-sm text-surface-700 dark:text-surface-200 uppercase truncate">{signerName || 'Não informado'}</span>
			</div>
			<div class="flex flex-col">
				<span class="text-[0.6rem] font-bold text-surface-400 uppercase tracking-tighter">CPF</span>
				<span class="font-bold text-sm text-surface-700 dark:text-surface-200 letter-spacing-1">
					{signerCpf ? signerCpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : 'Não cadastrado'}
				</span>
			</div>
		</div>

		{#if !signerCpf}
			<p class="text-[0.6rem] text-error-500 mt-2 flex items-center gap-1 font-bold animate-pulse">
				<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
				CPF NÃO CADASTRADO. A ASSINATURA PODE FALHAR.
			</p>
		{/if}
	</div>
</div>

<!-- Botão de assinatura -->
<div class="flex gap-2 items-center flex-wrap">
	<button
		class="btn btn-sm preset-filled-primary-500 font-bold px-4 py-2 rounded-lg shadow-sm hover:scale-[1.02] transition-transform"
		onclick={assinarComSerpro}
		disabled={assinando || disabled}
	>
		{#if assinando}
			<Spinner size="xs" class="mr-2" />
			{etapa || 'Assinando...'}
		{:else}
			<svg class="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
			</svg>
			Assinar com Token A3 (SERPRO)
		{/if}
	</button>
</div>

<p class="text-[0.65rem] text-surface-400 dark:text-surface-500 mt-3 italic leading-tight">
	Este fluxo utiliza o <a href="https://www.serpro.gov.br/menu/noticias/noticias-2015/assinador-serpro" target="_blank" rel="noopener" class="underline">Assinador Desktop SERPRO</a>.
	Certifique-se de que o aplicativo está aberto e o token conectado.
</p>
