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
		isMobile =
			/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
				navigator.userAgent,
			) ||
			(window.innerWidth <= 800 && navigator.maxTouchPoints > 0);
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
		window.open(
			`/api/escalas/${escalaId}/download?format=${format}`,
			"_blank",
		);
	}

	async function getCoordinates(): Promise<{
		lat: number;
		lng: number;
	} | null> {
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
			toaster.create({
				title: "Erro ao revogar assinatura",
				type: "error",
			});
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

	async function assinarSimples(
		rubricBase64: string,
		gpsLat?: number,
		gpsLng?: number,
		selfieBase64?: string | null,
	) {
		dialogSignOpen = false;
		assinandoSimples = true;
		try {
			const coords =
				gpsLat && gpsLng
					? { lat: gpsLat, lng: gpsLng }
					: await getCoordinates();
			const res = await fetch(
				`/api/escalas/${escalaId}/assinar-simples`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						latitude: coords?.lat,
						longitude: coords?.lng,
						rubricBase64,
						selfieBase64,
					}),
				},
			);
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
			const msg =
				err instanceof Error ? err.message : "Erro ao confirmar";
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
			toaster.create({
				title: "Selecione um certificado",
				type: "error",
			});
			return;
		}
		assinando = true;
		try {
			const pki = await initWebPKI();
			await executarAssinaturaWebPKI(pki, certSelecionado);
		} catch (err) {
			const msg =
				err instanceof Error ? err.message : "Erro na assinatura";
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
			toaster.create({
				title: "PDF assinado com sucesso!",
				type: "success",
			});
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
				toaster.create({
					title: "PDF assinado com sucesso!",
					type: "success",
				});
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
				Assinado por <strong
					>{documentoAssinadoInfo.assinante_nome || ""}</strong
				>.
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

<!-- SEÇÃO DE ASSINATURA UNIFICADA -->
{#if !documentoAssinadoInfo && policiaisCount > 0}
	<div class="space-y-6">
		<h3
			class="flex items-center gap-2 text-lg font-bold uppercase tracking-widest text-primary-500"
		>
			<svg
				class="w-6 h-6"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
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
								class="w-5 h-5 {isMobile
									? 'text-primary-500'
									: 'text-surface-400'}"
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
					<div
						class="bg-error-500/10 p-3 rounded-xl border border-error-500/20"
					>
						<p
							class="text-[0.65rem] text-error-600 font-bold uppercase text-center leading-tight"
						>
							A assinatura em tela é restrita a dispositivos
							móveis. Utilize o Token A3 no computador.
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
								class="w-5 h-5 {!isMobile
									? 'text-tertiary-500'
									: 'text-surface-400'}"
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
						Assinatura com validade <strong
							>Qualificada (ICP-Brasil)</strong
						> usando seu certificado digital físico ou e-CPF. Requer
						o Assinador Desktop instalado.
					</p>

					<!-- Leitor de Certificados (Apenas Desktop) -->
					{#if !isMobile}
						<div class="mb-4 space-y-3">
							<div
								class="flex justify-between items-center bg-surface-200/50 dark:bg-surface-900/50 p-3 rounded-xl border border-surface-300/30"
							>
								<span
									class="text-[0.65rem] font-bold uppercase opacity-60"
									>Leitura de Token</span
								>
								<button
									class="btn btn-sm preset-outlined-tertiary-500 text-[0.6rem] px-3 py-1 font-black"
									onclick={carregarCertificadosLocais}
									disabled={lendoCertificados}
								>
									{lendoCertificados
										? "Lendo..."
										: "Ler Tokens"}
								</button>
							</div>

							{#if certificados.length > 0}
								<select
									class="select text-xs bg-white dark:bg-surface-900 rounded-lg p-2 w-full border border-surface-300/30"
									bind:value={certSelecionado}
								>
									<option value=""
										>Selecione seu certificado...</option
									>
									{#each certificados as cert}
										<option value={cert.thumbprint}
											>{cert.subjectName}</option
										>
									{/each}
								</select>
							{:else if tentouLerCertificados}
								<p
									class="text-[0.6rem] text-error-500 bg-error-500/5 p-2 rounded-lg italic"
								>
									Nenhum certificado detectado. Verifique o
									token ou use o SERPRO diretamente.
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
								{etapaAssinatura || "Finalizando..."}
							{:else}
								Assinar Documento Oficial
							{/if}
						</button>
						<p
							class="text-[0.55rem] text-surface-400 text-center uppercase tracking-tighter"
						>
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
							Certificados físicos (USB/Token/Cartão) só podem ser
							lidos em computadores.
						</p>
					</div>
				{/if}
			</div>
		</div>

		<!-- Exportações auxiliares -->
		<div class="pt-4 border-t border-surface-200 dark:border-white/5">
			<span
				class="text-[0.65rem] font-bold text-surface-500 uppercase tracking-widest mb-3 block"
				>Outros Formatos (Sem Assinatura)</span
			>
			<div class="flex gap-2 flex-wrap">
				{#each ["docx", "xlsx", "pdf"] as format}
					<button
						class="btn btn-sm preset-tonal-surface text-[0.65rem] font-bold uppercase px-3 py-1.5"
						onclick={() => download(format)}
						>{format.toUpperCase()}</button
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
			<Dialog.Title class="h3 font-bold mb-2"
				>Assinatura Digital em Tela</Dialog.Title
			>
			<Dialog.Description
				class="text-xs text-surface-600 dark:text-surface-400 mb-4"
			>
				Desenhe sua rubrica no quadro abaixo para assinar este documento
				da escala com validade jurídica (nos moldes da assinatura
				eletrônica).
			</Dialog.Description>

			<SignaturePad
				message="Rubrica do Organizador"
				onConfirm={assinarSimples}
				onCancel={() => (dialogSignOpen = false)}
			/>
		</div>
	</Dialog.Content>
</Dialog>
