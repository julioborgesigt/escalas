<script lang="ts">
	import { toaster } from '$lib/toast';
	import { csrfHeaders } from '$lib/csrf';
	import { loading } from '$lib/loading.svelte';
	import { conectarSerpro, SerproSignerClient } from '$lib/serpro';

	let {
		prepararUrl,
		finalizarUrl,
		nomeArquivo = 'documento_assinado.pdf',
		signerName = $bindable(''),
		signerCpf = $bindable(''),
		signerEmail = '',
		extraPayload = {} as Record<string, unknown>,
		disabled = false,
		onSuccess = async () => {},
		// eslint-disable-next-line no-useless-assignment
		control = $bindable<{ assinarComSerpro: () => Promise<void> } | null>()
	}: {
		prepararUrl: string;
		finalizarUrl: string;
		nomeArquivo?: string;
		signerName?: string;
		signerCpf?: string;
		signerEmail?: string;
		extraPayload?: Record<string, unknown>;
		disabled?: boolean;
		onSuccess?: () => Promise<void>;
		control?: { assinarComSerpro: () => Promise<void> } | null;
	} = $props();

	// ---- Estado interno ----

	// GPS (Captura silenciosa, não-bloqueante)
	let coords = $state<{ lat: number; lng: number } | null>(null);

	$effect(() => {
		if (typeof window !== 'undefined' && 'geolocation' in navigator) {
			navigator.geolocation.getCurrentPosition(
				(p) => (coords = { lat: p.coords.latitude, lng: p.coords.longitude }),
				() => {}, // falha silenciosa
				{ enableHighAccuracy: true, timeout: 5000 }
			);
		}
	});

	// SERPRO
	let serproClient = $state<SerproSignerClient | null>(null);
	// Guard LOCAL de reentrância (duplo-clique). NÃO usar o loading GLOBAL no guard:
	// um overlay preso em qualquer parte do app bloquearia o token silenciosamente.
	let assinando = $state(false);

	// ---- Fluxo SERPRO ----

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

	async function executarAssinatura(
		getSignature: (
			signedAttrsHashHex: string,
			messageDigestHex: string
		) => Promise<{
			rawSignature?: string;
			certificateBase64?: string;
			serproCms?: string;
		}>
	) {
		loading.show('Gerando PDF e preparando assinatura...');

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
				verificationHash,
				documentHash,
				assinanteEmail
			} = await prepResp.json();

			// 2. Assinar
			loading.show('Aguardando assinatura no token...');
			const sigResult = await getSignature(signedAttrsHashHex, messageDigest);

			// 3. Finalizar
			loading.show('Finalizando PDF assinado...');
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
					documentHash,
					assinanteEmail,
					...extraPayload
				})
			});
			if (!finResp.ok) {
				const err = await finResp.json().catch(() => ({}));
				throw new Error(err.error || 'Erro ao finalizar assinatura');
			}

			// 4. Baixar
			loading.show('Baixando PDF assinado...');
			const blob = await finResp.blob();
			const cd = finResp.headers.get('Content-Disposition');
			const nome = cd?.match(/filename="(.+)"/)?.[1] || nomeArquivo;
			baixarBlob(blob, nome);

			toaster.success({ title: 'PDF assinado com sucesso!' });
			await onSuccess();
		} catch (err: unknown) {
			toaster.error({
				title: 'Erro na assinatura',
				description: err instanceof Error ? err.message : 'Erro desconhecido'
			});
		} finally {
			loading.hide();
		}
	}

	async function assinarComSerpro() {
		// Reentrância (duplo-clique): silencioso, OK.
		if (assinando) return;
		// Se o pai desabilitou (operação em andamento), dá FEEDBACK em vez de
		// retornar mudo — assim o usuário vê o motivo em vez de "nada acontece".
		if (disabled) {
			toaster.error({
				title: 'Assinatura indisponível no momento',
				description: 'Aguarde a operação anterior concluir e tente novamente.'
			});
			return;
		}
		assinando = true;
		try {
			const client = serproClient ?? (await conectarSerpro());
			loading.show('Conectando ao Assinador SERPRO...');
			serproClient = client;

			await executarAssinatura(async (_signedAttrsHashHex, messageDigestHex) => {
				loading.show('Selecione o certificado e assine no SERPRO...');
				const messageDigestBase64 = hexToBase64(messageDigestHex);
				const result = await client.sign(messageDigestBase64);
				return { serproCms: result.rawSignature, serproResponse: result };
			});
		} catch (err: unknown) {
			toaster.error({
				title: 'Erro no Assinador SERPRO',
				description: err instanceof Error ? err.message : 'Erro desconhecido'
			});
			serproClient?.disconnect();
			serproClient = null;
			loading.hide();
		} finally {
			assinando = false;
			serproClient?.disconnect();
			serproClient = null;
		}
	}

	$effect(() => {
		control = { assinarComSerpro };
	});
</script>

<div class="space-y-4">
	<!-- Dados do Assinante -->
	<div
		class="p-4 bg-surface-100/50 dark:bg-surface-800/40 rounded-xl border border-surface-200 dark:border-white/5 flex gap-4 items-center shadow-sm"
	>
		<div class="bg-primary-500/10 p-3 rounded-lg flex-shrink-0">
			<svg class="w-6 h-6 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
				/>
			</svg>
		</div>

		<div class="flex-1">
			<div class="flex flex-col mb-2">
				<h4 class="font-bold text-sm text-surface-900 dark:text-white flex items-center gap-2">
					Dados do Assinante
				</h4>
				<p class="text-[0.6rem] text-surface-500 uppercase tracking-wider font-semibold">
					CONFORME CADASTRO NO SISTEMA
				</p>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
				<div class="flex flex-col">
					<span class="text-[0.6rem] font-bold text-surface-400 uppercase tracking-tighter"
						>NOME</span
					>
					<span class="font-bold text-sm text-surface-700 dark:text-surface-200 uppercase truncate"
						>{signerName || 'Não informado'}</span
					>
				</div>
				<div class="flex flex-col">
					<span class="text-[0.6rem] font-bold text-surface-400 uppercase tracking-tighter"
						>CPF</span
					>
					<span class="font-bold text-sm text-surface-700 dark:text-surface-200">
						{signerCpf
							? signerCpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
							: 'Não cadastrado'}
					</span>
				</div>
				{#if signerEmail}
					<div class="flex flex-col sm:col-span-2 mt-1">
						<span class="text-[0.6rem] font-bold text-surface-400 uppercase tracking-tighter"
							>E-MAIL INSTITUCIONAL</span
						>
						<span class="font-bold text-xs text-surface-600 dark:text-surface-400"
							>{signerEmail}</span
						>
					</div>
				{/if}
			</div>

			{#if !signerCpf}
				<p
					class="text-[0.6rem] text-error-500 mt-2 flex items-center gap-1 font-bold animate-pulse"
				>
					<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
						/></svg
					>
					CPF NÃO CADASTRADO. A ASSINATURA PODE FALHAR.
				</p>
			{/if}
		</div>
	</div>

	<!-- Aviso jurídico (Lei 14.063/2020 art. 4º §1º) -->
	<p class="text-[11px] text-surface-500 dark:text-surface-400 italic leading-snug">
		Ao clicar em <strong>Assinar</strong>, você confirma que leu o documento e que esta assinatura
		tem valor jurídico equivalente à manuscrita, conforme o
		<a href="/termo/1.0" target="_blank" rel="noopener" class="underline hover:text-primary-600"
			>Termo de Uso</a
		>
		aceito.
	</p>

	<!-- Botão de Assinatura -->
	<div class="flex gap-2 items-center flex-wrap">
		<button
			type="button"
			class="btn btn-sm preset-filled-primary-500 font-bold px-4 py-2 rounded-lg shadow-sm hover:scale-[1.02] transition-transform w-full sm:w-auto flex items-center justify-center gap-2"
			onclick={assinarComSerpro}
			disabled={loading.active || disabled}
		>
			{#if loading.active}
				Assinando...
			{:else}
				<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
					/></svg
				>
				Assinar com Certificado Digital (SERPRO)
			{/if}
		</button>
	</div>

	<p class="text-[0.65rem] text-surface-400 dark:text-surface-500 mt-3 italic leading-tight">
		Este fluxo utiliza o <a
			href="https://www.serpro.gov.br/links-fixos-superiores/assinador-digital/assinador-serpro"
			target="_blank"
			rel="noopener"
			class="underline">Assinador Desktop SERPRO</a
		>. Certifique-se de que o aplicativo está aberto e o token conectado.
	</p>

	<div class="p-3 bg-primary-500/5 border border-dashed border-primary-500/20 rounded-xl mt-2">
		<p class="text-[0.55rem] font-medium text-surface-500 leading-tight text-center">
			Ao assinar, declaro a veracidade destas informações e autorizo o registro da minha
			<strong>localização geográfica</strong> e <strong>metadados técnicos</strong> para fins de validade
			jurídica desta assinatura (Lei 14.063/20).
		</p>
	</div>
</div>
