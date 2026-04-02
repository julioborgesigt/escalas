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
	import {
		initWebPKI,
		listarCertificados,
		assinarHash,
		lerCertificado,
		type WebPKICertificate
	} from '$lib/webpki';
	import { conectarSerpro, type SerproSignerClient } from '$lib/serpro';

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

	// WebPKI
	let certificados = $state<WebPKICertificate[]>([]);
	let certSelecionado = $state('');
	let lendoCertificados = $state(false);
	let tentouLer = $state(false);
	let pkInstance = $state<any>(null);

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

	// ---- WebPKI: lista certificados ----

	export async function carregarCertificados() {
		lendoCertificados = true;
		tentouLer = false;
		try {
			const pki = pkInstance || (await initWebPKI());
			pkInstance = pki;
			certificados = await listarCertificados(pki);
			if (certificados.length === 1) {
				certSelecionado = certificados[0].thumbprint;
				signerName = certificados[0].subjectName;
				signerCpf = certificados[0].cpf || '';
			}
		} catch (err) {
			toaster.error({
				title: err instanceof Error ? err.message : 'Erro ao inicializar Web PKI'
			});
		} finally {
			lendoCertificados = false;
			tentouLer = true;
		}
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
				headers: { 'Content-Type': 'application/json' },
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
				headers: { 'Content-Type': 'application/json' },
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

	// ---- Ação: assinar com Web PKI ----

	export async function assinarComWebPKI() {
		if (!certSelecionado) {
			toaster.error({ title: 'Selecione um certificado primeiro' });
			return;
		}
		const pki = pkInstance || (await initWebPKI().catch(() => null));
		if (!pki) return;
		const cert = certificados.find((c) => c.thumbprint === certSelecionado);

		// CORREÇÃO: atualiza nome/CPF DO CERTIFICADO antes de preparar o PDF,
		// garantindo que o carimbo visual reflita o dono do token, não o usuário logado.
		if (cert) {
			signerName = cert.subjectName;
			signerCpf = cert.cpf || signerCpf;
		}

		await executarAssinatura(async (signedAttrsHashHex) => {
			etapa = 'Aguardando PIN do token (Web PKI)...';
			const certificateBase64 = await lerCertificado(pki, certSelecionado);
			const rawSignature = await assinarHash(pki, certSelecionado, signedAttrsHashHex);
			return { rawSignature, certificateBase64 };
		});
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
				// Atualiza nome/CPF com dados do certificado do SERPRO
				const certName = result.signerAlias?.replace(/:[\d]+$/, '').trim();
				const certCpfMatch = result.signerAlias?.match(/:(\d{11})$/);
				if (certName) signerName = certName;
				if (certCpfMatch?.[1]) signerCpf = certCpfMatch[1];
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

<!-- Leitor de Tokens (Web PKI) -->
<div class="mb-4 p-4 bg-surface-100/50 dark:bg-surface-800/50 rounded-xl border border-surface-200 dark:border-white/10">
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
		<h4 class="font-semibold text-sm flex items-center gap-2">
			<svg class="w-4 h-4 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
					d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
			</svg>
			Leitura de Tokens (Recomendado)
		</h4>
		<button
			class="btn btn-sm preset-outlined-primary-500"
			onclick={carregarCertificados}
			disabled={lendoCertificados || disabled}
		>
			{#if lendoCertificados}
				<span class="inline-block w-3 h-3 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mr-2"></span>
				Lendo tokens...
			{:else}
				Ler Tokens Plugados
			{/if}
		</button>
	</div>

	{#if certificados.length > 0}
		<label class="label mt-3">
			<span class="label-text text-xs">Selecione o certificado:</span>
			<select
				class="select text-sm bg-white dark:bg-surface-900"
				bind:value={certSelecionado}
				onchange={(e) => {
					const c = certificados.find((x) => x.thumbprint === e.currentTarget.value);
					if (c) { signerName = c.subjectName; signerCpf = c.cpf || ''; }
				}}
			>
				<option value="">Selecione...</option>
				{#each certificados as cert (cert.thumbprint)}
					<option value={cert.thumbprint}>
						{cert.subjectName}{cert.cpf ? ` (CPF: ${cert.cpf})` : ''} — Emissor: {cert.issuerName}
					</option>
				{/each}
			</select>
		</label>
	{:else if tentouLer}
		<p class="text-xs text-error-500 mt-2 bg-error-500/10 p-2 rounded">
			Nenhum certificado encontrado. Verifique se o token está conectado e a extensão
			<strong>Lacuna Web PKI</strong> está instalada.
		</p>
	{:else}
		<p class="text-xs text-surface-500 mt-1">
			Clique no botão ao lado para listar e preencher automaticamente os dados do seu certificado.
		</p>
	{/if}
</div>

<!-- Botões de assinatura + indicador de progresso -->
<div class="flex gap-2 items-center flex-wrap">
	<!-- Web PKI (Botão oculto, mas lógica mantida para leitura de tokens) -->
	<button
		class="btn btn-sm preset-filled-success-500 hidden"
		onclick={assinarComWebPKI}
		disabled={assinando || !certSelecionado || disabled}
		title="Requer usar o Leitor de Tokens primeiro"
	>
		{#if assinando && !serproClient}
			<span class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
			{etapa || 'Assinando...'}
		{:else}
			Assinar com Web PKI
		{/if}
	</button>

	<!-- SERPRO -->
	<button
		class="btn btn-sm preset-filled-tertiary-500"
		onclick={assinarComSerpro}
		disabled={assinando || !certSelecionado || disabled}
		title="Requer o Assinador Desktop SERPRO instalado"
	>
		{#if assinando && !!serproClient}
			<span class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
			{etapa || 'Assinando...'}
		{:else}
			Assinar com SERPRO
		{/if}
	</button>

	{#if certificados.length > 0 && !assinando}
		<button
			class="btn btn-sm preset-outlined-surface"
			onclick={() => { certificados = []; certSelecionado = ''; tentouLer = false; }}
		>
			Limpar lista
		</button>
	{/if}
</div>

<!-- Indicador de etapa (quando assinando) -->
{#if assinando && etapa}
	<p class="text-xs text-surface-500 mt-2 animate-pulse">{etapa}</p>
{/if}

<p class="text-xs text-surface-400 dark:text-surface-500 mt-2">
	<strong>Web PKI:</strong> requer extensão
	<a href="https://get.webpkiplugin.com/" target="_blank" rel="noopener" class="underline">Lacuna Web PKI</a>.
	<strong>SERPRO:</strong> requer
	<a href="https://www.serpro.gov.br/menu/noticias/noticias-2015/assinador-serpro" target="_blank" rel="noopener" class="underline">Assinador Desktop SERPRO</a>.
</p>
