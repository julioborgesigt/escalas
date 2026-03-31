<script lang="ts">
	import { untrack } from "svelte";
	import { toaster } from "$lib/toast";
	import {
		initWebPKI,
		listarCertificados,
		assinarHash,
		lerCertificado,
		type WebPKICertificate,
	} from "$lib/webpki";
	import { conectarSerpro, type SerproSignerClient } from "$lib/serpro";
	import { Dialog } from "@skeletonlabs/skeleton-svelte";
	import SignaturePad from "./SignaturePad.svelte";
	import type { UsuarioLogado } from "$lib/auth";

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
	}: {
		escalaId: string;
		isFDS: boolean;
		policiaisCount: number;
		usuario: UsuarioLogado | null;
		documentoAssinadoInfo: DocumentoAssinadoInfo | null;
	} = $props();

	// === Estado de assinatura ===
	let assinando = $state(false);
	let etapaAssinatura = $state("");
	let assinandoSimples = $state(false);
	let dialogSignOpen = $state(false);

	let isMobile = $state(true);
	$effect(() => {
		isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (window.innerWidth <= 800 && navigator.maxTouchPoints > 0);
	});

	// Web PKI
	let certificados = $state<WebPKICertificate[]>([]);
	let certSelecionado = $state("");
	let lendoCertificados = $state(false);
	let tentouLerCertificados = $state(false);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let pkInstance = $state<any>(null);

	// SERPRO – nome/CPF pré-preenchidos com dados do usuário; sobrescritos pelo certificado selecionado
	let serproClient = $state<SerproSignerClient | null>(null);
	let serproSignerName = $state(untrack(() => usuario?.nome ?? ""));
	let serproSignerCpf = $state("");

	// === Funções utilitárias ===

	function download(format: string) {
		window.open(`/api/escalas/${escalaId}/download?format=${format}`, "_blank");
	}

	async function getCoordinates(): Promise<{ lat: number; lng: number } | null> {
		if (typeof window === "undefined" || !("geolocation" in navigator))
			return null;
		try {
			return await new Promise((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(
					(pos) =>
						resolve({
							lat: pos.coords.latitude,
							lng: pos.coords.longitude,
						}),
					(err) => reject(err),
					{ enableHighAccuracy: true, timeout: 5000 },
				);
			});
		} catch (e) {
			console.warn("Erro ao capturar GPS:", e);
			return null;
		}
	}

	// === Revogar assinatura ===

	async function revogarAssinatura() {
		if (
			!confirm(
				"Você tem certeza que deseja revogar a assinatura digital? Isso excluirá o PDF oficial e permitirá editar a escala novamente.",
			)
		)
			return;

		assinando = true;
		etapaAssinatura = "Revogando assinatura...";
		try {
			const res = await fetch(
				`/api/escalas/${escalaId}/documento-assinado`,
				{ method: "DELETE" },
			);
			if (res.ok) {
				documentoAssinadoInfo = null;
				toaster.create({
					title: "Assinatura revogada",
					description: "Você agora pode editar os dados da escala.",
					type: "info",
				});
			} else {
				throw new Error("Falha ao revogar");
			}
		} catch {
			toaster.create({ title: "Erro ao revogar assinatura", type: "error" });
		} finally {
			assinando = false;
			etapaAssinatura = "";
		}
	}

	// === Assinatura simples (FDS ou sem PKI) ===

	function abrirModalAssinatura() {
		if (policiaisCount === 0) {
			toaster.create({
				title: "Adicione ao menos um policial antes de confirmar",
				type: "error",
			});
			return;
		}
		dialogSignOpen = true;
	}

	async function assinarSimples(rubricBase64: string, gpsLat?: number, gpsLng?: number, selfieBase64?: string | null) {
		dialogSignOpen = false;
		assinandoSimples = true;
		try {
			const coords = (gpsLat && gpsLng) ? { lat: gpsLat, lng: gpsLng } : await getCoordinates();
			const res = await fetch(`/api/escalas/${escalaId}/assinar-simples`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					latitude: coords?.lat,
					longitude: coords?.lng,
					rubricBase64,
					selfieBase64
				}),
			});
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.error || "Erro ao confirmar escala");
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download =
				res.headers
					.get("Content-Disposition")
					?.match(/filename="(.+)"/)?.[1] || "escala_confirmada.pdf";
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
			documentoAssinadoInfo = {
				existe: true,
				assinante_nome: usuario?.nome || "Administrador",
				data: new Date().toISOString(),
			};
			toaster.create({
				title: "Escala confirmada e PDF gerado!",
				type: "success",
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Erro ao confirmar";
			toaster.create({ title: msg, type: "error" });
		} finally {
			assinandoSimples = false;
		}
	}

	// === Web PKI ===

	async function carregarCertificadosLocais() {
		lendoCertificados = true;
		tentouLerCertificados = false;
		try {
			const pki = pkInstance || (await initWebPKI());
			pkInstance = pki;
			certificados = await listarCertificados(pki);
			if (certificados.length === 1) {
				certSelecionado = certificados[0].thumbprint;
				serproSignerName = certificados[0].subjectName;
				serproSignerCpf = certificados[0].cpf || "";
			}
		} catch (err) {
			toaster.create({
				title:
					err instanceof Error
						? err.message
						: "Erro ao inicializar Web PKI",
				type: "error",
			});
		} finally {
			lendoCertificados = false;
			tentouLerCertificados = true;
		}
	}

	async function finalizarEBaixarPdf(
		signerName: string,
		signerCpf: string,
		getSignature: (
			signedAttrsHashHex: string,
		) => Promise<{ rawSignature: string; certificateBase64: string }>,
	) {
		const coords = await getCoordinates();
		etapaAssinatura = "Gerando PDF e preparando assinatura...";
		const prepRes = await fetch(
			`/api/escalas/${escalaId}/preparar-assinatura`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ signerName, signerCpf }),
			},
		);
		if (!prepRes.ok) {
			const err = await prepRes.json();
			throw new Error(err.error || "Erro ao preparar PDF");
		}
		const {
			signedAttrsHashHex,
			preparedPdf,
			messageDigest,
			signingTimeISO,
			verificationHash,
		} = await prepRes.json();

		const { rawSignature, certificateBase64 } =
			await getSignature(signedAttrsHashHex);

		etapaAssinatura = "Finalizando PDF assinado...";
		const finRes = await fetch(
			`/api/escalas/${escalaId}/finalizar-assinatura`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					preparedPdf,
					rawSignature,
					certificateBase64,
					messageDigest,
					signingTimeISO,
					signerName,
					signerCpf,
					verificationHash,
					latitude: coords?.lat,
					longitude: coords?.lng,
				}),
			},
		);
		if (!finRes.ok) {
			const err = await finRes.json();
			throw new Error(err.error || "Erro ao finalizar assinatura");
		}

		etapaAssinatura = "Baixando PDF assinado...";
		const blob = await finRes.blob();
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download =
			finRes.headers
				.get("Content-Disposition")
				?.match(/filename="(.+)"/)?.[1] || "escala_assinada.pdf";
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);

		documentoAssinadoInfo = {
			existe: true,
			assinante_nome: signerName,
			assinante_cpf: signerCpf,
			data: new Date().toISOString(),
		};
	}

	async function assinarComWebPKI() {
		if (certificados.length === 0) {
			assinando = true;
			etapaAssinatura = "Conectando ao Web PKI...";
			await carregarCertificadosLocais();
			assinando = false;
			etapaAssinatura = "";
			if (certificados.length === 0) return;
			if (certificados.length > 1) {
				toaster.create({
					title: "Selecione um dos certificados carregados",
					type: "warning",
				});
				return;
			}
		}
		if (!certSelecionado) {
			toaster.create({ title: "Selecione um certificado", type: "error" });
			return;
		}
		assinando = true;
		try {
			const pki = await initWebPKI();
			await executarAssinaturaWebPKI(pki, certSelecionado);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Erro na assinatura";
			toaster.create({ title: msg, type: "error" });
			assinando = false;
			etapaAssinatura = "";
		}
	}

	async function executarAssinaturaWebPKI(
		pki: Awaited<ReturnType<typeof initWebPKI>>,
		thumbprint: string,
	) {
		assinando = true;
		const cert = certificados.find((c) => c.thumbprint === thumbprint);
		etapaAssinatura = "Lendo certificado...";
		const certificateBase64 = await lerCertificado(pki, thumbprint);
		try {
			await finalizarEBaixarPdf(
				cert?.subjectName ?? "",
				cert?.cpf ?? "",
				async (signedAttrsHashHex) => {
					etapaAssinatura =
						"Aguardando assinatura no eToken (digite o PIN)...";
					const rawSignature = await assinarHash(
						pki,
						thumbprint,
						signedAttrsHashHex,
					);
					return { rawSignature, certificateBase64 };
				},
			);
			toaster.create({ title: "PDF assinado com sucesso!", type: "success" });
		} finally {
			assinando = false;
			etapaAssinatura = "";
		}
	}

	// === SERPRO ===

	async function assinarComSerpro() {
		assinando = true;
		etapaAssinatura = "Conectando ao Assinador SERPRO...";
		try {
			const client = serproClient ?? (await conectarSerpro());
			serproClient = client;
			await executarAssinaturaSerpro(client);
		} catch (err) {
			const msg =
				err instanceof Error ? err.message : "Erro no Assinador SERPRO";
			toaster.create({ title: msg, type: "error" });
			serproClient?.disconnect();
			serproClient = null;
			assinando = false;
			etapaAssinatura = "";
		}
	}

	async function executarAssinaturaSerpro(client: SerproSignerClient) {
		try {
			etapaAssinatura = "Gerando PDF e preparando assinatura...";
			const prepRes = await fetch(
				`/api/escalas/${escalaId}/preparar-assinatura`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						signerName: serproSignerName || undefined,
						signerCpf: serproSignerCpf || undefined,
					}),
				},
			);
			if (!prepRes.ok) {
				const err = await prepRes.json();
				throw new Error(err.error || "Erro ao preparar PDF");
			}
			const {
				preparedPdf,
				messageDigest: messageDigestHex,
				verificationHash: serproVerificationHash,
			} = await prepRes.json();

			const messageDigestBase64 = btoa(
				messageDigestHex
					.match(/.{2}/g)!
					.map((h: string) => String.fromCharCode(parseInt(h, 16)))
					.join(""),
			);

			etapaAssinatura =
				"Selecione o certificado e assine no Assinador SERPRO...";
			const result = await client.sign(messageDigestBase64);
			const serproCms = result.rawSignature;

			const certName = result.signerAlias?.replace(/:[\d]+$/, "").trim();
			const certCpfMatch = result.signerAlias?.match(/:([\d]{11})$/);
			const certCpf = certCpfMatch ? certCpfMatch[1] : "";

			const coords = await getCoordinates();

			etapaAssinatura = "Finalizando PDF assinado...";
			const finRes = await fetch(
				`/api/escalas/${escalaId}/finalizar-assinatura`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						preparedPdf,
						serproCms,
						signerName: certName || serproSignerName,
						signerCpf: certCpf || serproSignerCpf,
						verificationHash: serproVerificationHash,
						latitude: coords?.lat,
						longitude: coords?.lng,
					}),
				},
			);
			if (!finRes.ok) {
				const err = await finRes.json();
				throw new Error(err.error || "Erro ao finalizar assinatura");
			}

			etapaAssinatura = "Baixando PDF assinado...";
			const blob = await finRes.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download =
				finRes.headers
					.get("Content-Disposition")
					?.match(/filename="(.+)"/)?.[1] || "escala_assinada.pdf";
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);

			documentoAssinadoInfo = {
				existe: true,
				assinante_nome: certName || serproSignerName,
				assinante_cpf: certCpf || serproSignerCpf,
				data: new Date().toISOString(),
			};

			const changedName = certName && certName !== serproSignerName;
			const changedCpf = certCpf && certCpf !== serproSignerCpf;
			if (changedName || changedCpf) {
				serproSignerName = certName || serproSignerName;
				serproSignerCpf = certCpf || serproSignerCpf;
				toaster.create({
					title: "PDF assinado com sucesso!",
					description: `Certificado reconhecido: ${certName}. Se alguma informação no carimbo estiver diferente, você pode tentar assinar novamente, os campos Assinante e CPF foram atualizados com os dados do token.`,
					type: "success",
				});
			} else {
				toaster.create({ title: "PDF assinado com sucesso!", type: "success" });
			}
		} finally {
			assinando = false;
			etapaAssinatura = "";
			serproClient?.disconnect();
			serproClient = null;
		}
	}
</script>

<!-- Banner: escala assinada -->
{#if documentoAssinadoInfo}
	<div
		class="mb-6 p-4 sm:p-5 bg-success-500/10 border-2 border-success-500/30 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-md"
	>
		<div>
			<h3
				class="font-bold text-success-700 dark:text-success-400 flex items-center gap-2 text-lg"
			>
				<svg
					class="w-6 h-6"
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
				Escala Oficialmente Assinada
			</h3>
			<p class="text-sm text-surface-600 dark:text-surface-300 mt-1">
				Assinado por <strong>{documentoAssinadoInfo.assinante_nome || ""}</strong>.
				{isFDS
					? "Confirmação administrativa gerada e guardada para download."
					: "Arquivo original ICP-Brasil guardado nos servidores para download."}
			</p>
		</div>
		<div class="flex flex-col sm:flex-row gap-3">
			<a
				href={`/api/escalas/${escalaId}/documento-assinado`}
				class="btn preset-filled-success-500 shrink-0 font-bold px-6 py-3 shadow-lg shadow-success-500/30 hover:scale-105 transition-transform"
				target="_blank"
			>
				<svg
					class="w-5 h-5 mr-2"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
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
				<svg
					class="w-5 h-5 mr-2"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
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

<!-- Confirmação de escala de Final de Semana -->
{#if isFDS && !documentoAssinadoInfo}
	<div
		class="mb-6 p-4 sm:p-5 bg-primary-500/8 border border-primary-500/25 rounded-2xl"
	>
		<div
			class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
		>
			<div>
				<h3
					class="font-bold text-primary-700 dark:text-primary-400 flex items-center gap-2"
				>
					<span>📋</span> Confirmar Escala de Final de Semana
				</h3>
				<p class="text-sm text-surface-500 mt-1 max-w-md">
					Ao clicar em Confirmar Escala, ela será enviada ao administrador
					superior
				</p>
			</div>
			{#if isMobile}
				<button
					class="btn preset-filled-primary-500 shrink-0 font-bold px-5 py-2.5"
					disabled={assinandoSimples || policiaisCount === 0}
					onclick={abrirModalAssinatura}
				>
					{#if assinandoSimples}
						<svg
							class="w-4 h-4 mr-2 animate-spin"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
							/></svg
						>
						Gerando PDF...
					{:else}
						<svg
							class="w-4 h-4 mr-2"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M5 13l4 4L19 7"
							/></svg
						>
						Confirmar Escala
					{/if}
				</button>
			{:else}
				<div class="text-xs text-error-500 max-w-xs text-right italic font-semibold border-l-2 border-error-500 pl-2">
					A assinatura em tela é restrita a dispositivos móveis. Utilize o Token A3 (Aba abaixo) no computador.
				</div>
			{/if}
		</div>
		{#if policiaisCount === 0}
			<p class="text-xs text-warning-600 dark:text-warning-400 mt-2">
				⚠️ Adicione ao menos um policial para habilitar a confirmação.
			</p>
		{/if}
	</div>
{/if}

<!-- Exportar e assinatura digital -->
{#if policiaisCount > 0}
	<div
		class="p-4 mb-4 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20"
	>
		<h3 class="font-semibold text-sm mb-3">
			Exportar Escala Sem Assinatura Digital
		</h3>
		<div class="flex gap-2 flex-wrap">
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={() => download("docx")}>Word (.docx)</button
			>
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={() => download("odt")}>ODT (.odt)</button
			>
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={() => download("xlsx")}>Excel (.xlsx)</button
			>
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={() => download("ods")}>ODS (.ods)</button
			>
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={() => download("pdf")}>PDF (.pdf)</button
			>
		</div>

		{#if !documentoAssinadoInfo && !isFDS}
			<hr class="my-3 border-surface-200 dark:border-white/10" />

			<h3 class="font-semibold text-sm mb-3">
				Assinatura Digital (eToken / Certificado A3)
			</h3>

			<!-- Selecionador Unificado de Certificados (Web PKI) -->
			<div
				class="mb-4 p-4 bg-surface-100/50 dark:bg-surface-800/50 rounded-xl border border-surface-200 dark:border-white/10"
			>
				<div
					class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2"
				>
					<h4 class="font-semibold text-sm flex items-center gap-2">
						<svg
							class="w-4 h-4 text-primary-500"
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
						Leitura de Tokens (Recomendado)
					</h4>
					<button
						class="btn btn-sm preset-outlined-primary-500"
						onclick={carregarCertificadosLocais}
						disabled={lendoCertificados}
					>
						{#if lendoCertificados}
							<span
								class="inline-block w-3 h-3 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mr-2"
							></span>
							Lendo tokens...
						{:else}
							Ler Tokens Plugados
						{/if}
					</button>
				</div>

				{#if certificados.length > 0}
					<label class="label mt-3">
						<span class="label-text text-xs"
							>Selecione o certificado que deseja utilizar:</span
						>
						<select
							class="select text-sm bg-white dark:bg-surface-900"
							bind:value={certSelecionado}
							onchange={(e) => {
								const c = certificados.find(
									(x) => x.thumbprint === e.currentTarget.value,
								);
								if (c) {
									serproSignerName = c.subjectName;
									serproSignerCpf = c.cpf || "";
								}
							}}
						>
							<option value="">Selecione...</option>
							{#each certificados as cert (cert.thumbprint)}
								<option value={cert.thumbprint}>
									{cert.subjectName}{cert.cpf
										? ` (CPF: ${cert.cpf})`
										: ""} - Emissor: {cert.issuerName}
								</option>
							{/each}
						</select>
					</label>
				{:else if tentouLerCertificados}
					<p
						class="text-xs text-error-500 mt-2 bg-error-500/10 p-2 rounded"
					>
						Nenhum certificado encontrado. Verifique se o token está
						conectado e a extensão <strong>Lacuna Web PKI</strong> está
						instalada.
					</p>
				{:else}
					<p class="text-xs text-surface-500 mt-1">
						Clique no botão ao lado para listar e preencher
						automaticamente os dados do seu certificado.
					</p>
				{/if}
			</div>

			<div class="flex gap-2 items-center flex-wrap">
				<!-- Botão Web PKI -->
				<button
					class="btn btn-sm preset-filled-success-500"
					onclick={assinarComWebPKI}
					disabled={assinando || !certSelecionado}
					title="Requer usar o Leitor de Tokens primeiro"
				>
					{#if assinando && certificados.length > 0}
						<span
							class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"
						></span>
						{etapaAssinatura}
					{:else}
						Assinar com Web PKI
					{/if}
				</button>

				<!-- Botão SERPRO -->
				<button
					class="btn btn-sm preset-filled-tertiary-500"
					onclick={assinarComSerpro}
					disabled={assinando || !certSelecionado}
					title="Requer usar o Leitor de Tokens primeiro"
				>
					{#if assinando && serproClient}
						<span
							class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"
						></span>
						{etapaAssinatura}
					{:else}
						Assinar com SERPRO
					{/if}
				</button>

				{#if certificados.length > 0 && !assinando}
					<button
						class="btn btn-sm preset-outlined-surface"
						onclick={() => {
							certificados = [];
							certSelecionado = "";
							tentouLerCertificados = false;
						}}
					>
						Limpar lista
					</button>
				{/if}
			</div>

			<p class="text-xs text-surface-400 dark:text-surface-500 mt-2">
				<strong>Web PKI:</strong> requer extensão
				<a
					href="https://get.webpkiplugin.com/"
					target="_blank"
					rel="noopener"
					class="anchor">Lacuna Web PKI</a
				>. &nbsp;|&nbsp;
				<strong>SERPRO:</strong> requer o
				<a
					href="https://www.serpro.gov.br/links-fixos-superiores/assinador-digital/assinador-serpro"
					target="_blank"
					rel="noopener"
					class="anchor">Assinador SERPRO Desktop</a
				>
				instalado e em execução.
			</p>
		{/if}
	</div>
{/if}

<Dialog open={dialogSignOpen} onOpenChange={(e) => (dialogSignOpen = e.open)}>
	<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm">
		<div class="card p-6 max-w-lg w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10">
			<Dialog.Title class="h3 font-bold mb-2">Assinatura Digital em Tela</Dialog.Title>
			<Dialog.Description class="text-xs text-surface-600 dark:text-surface-400 mb-4">
				Desenhe sua rubrica no quadro abaixo para assinar este documento da escala com validade jurídica (nos moldes da assinatura eletrônica).
			</Dialog.Description>
			
			<SignaturePad 
				message="Rubrica do Organizador"
				onConfirm={assinarSimples} 
				onCancel={() => dialogSignOpen = false} 
			/>
		</div>
	</Dialog.Content>
</Dialog>
