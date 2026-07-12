<script lang="ts">
	import { formatarData } from '$lib/utils';
	import { toaster } from '$lib/toast';
	import Spinner from '$lib/components/Spinner.svelte';
	import type { PageProps } from './$types';

	interface DocumentoComAuditoria {
		assinante_nome: string;
		assinante_cpf?: string; // já mascarado pelo servidor (LGPD)
		created_at: string;
		tipo: string;
	}

	const { data }: PageProps = $props();
	const documento = $derived(data.documento as DocumentoComAuditoria);

	function formatarDataHora(dateStr: string | null) {
		if (!dateStr) return 'Não informada';
		// SQLite datetime('now') retorna "YYYY-MM-DD HH:MM:SS" sem indicador de fuso.
		// Adicionamos " UTC" para forçar a interpretação como UTC antes de converter.
		const d = new Date(dateStr.includes('T') ? dateStr : dateStr + ' UTC');
		return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
	}

	let baixando = $state(false);

	async function handleDownload() {
		if (baixando) return;
		baixando = true;
		if (import.meta.env.DEV) {
			console.debug('[Download] requisição', `/api/validar/${data.hash}/download`);
		}

		try {
			const res = await fetch(`/api/validar/${data.hash}/download`);
			if (import.meta.env.DEV) {
				console.debug('[Download] resposta', {
					status: res.status,
					statusText: res.statusText,
					headers: Object.fromEntries(res.headers.entries())
				});
			}

			if (!res.ok) {
				const errorText = await res.text();
				if (import.meta.env.DEV) {
					console.error('[Download] corpo de erro', errorText);
				}
				toaster.create({
					title: 'Erro ao carregar o arquivo',
					description: `Status ${res.status}. Tente novamente em instantes.`,
					type: 'error'
				});
				baixando = false;
				return;
			}

			const contentType = res.headers.get('content-type');
			if (contentType && contentType.includes('application/json')) {
				const errJson = await res.json();
				if (import.meta.env.DEV) {
					console.error('[Download] JSON de erro', errJson);
				}
				toaster.create({
					title: 'Erro do servidor',
					description: errJson.error || 'Erro desconhecido',
					type: 'error'
				});
				baixando = false;
				return;
			}

			const blob = await res.blob();
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `relatorio_${data.hash}.pdf`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			window.URL.revokeObjectURL(url);
		} catch (err) {
			if (import.meta.env.DEV) {
				console.error('[Download] exceção', err);
			}
			toaster.create({
				title: 'Falha de comunicação',
				description: 'Não foi possível contatar o servidor. Verifique sua conexão.',
				type: 'error'
			});
		} finally {
			baixando = false;
		}
	}
</script>

<svelte:head>
	<title>Validação de Documento - Escalas PC-CE</title>
</svelte:head>

<div
	class="min-h-screen bg-surface-50 dark:bg-surface-900 flex flex-col items-center justify-center p-3 sm:p-4"
>
	<div
		class="card w-full max-w-2xl bg-white dark:bg-surface-800 shadow-xl border rounded-2xl sm:rounded-3xl overflow-hidden p-4 sm:p-8
		{data.encontrado ? 'border-primary-500/20' : 'border-error-500/20'}"
	>
		{#if data.encontrado}
			{@const v = data.verificacao}
			{@const tipoAss = data.documento.tipo_assinatura}
			{@const ehQualificada =
				tipoAss === 'webpki' || tipoAss === 'serpro' || (tipoAss === null && v !== null)}
			<!-- ✅ DOCUMENTO VÁLIDO -->
			<div class="flex flex-col items-center mb-6 sm:mb-10">
				<img
					src="/api/validar/logo"
					alt="Brasão do Estado do Ceará"
					class="w-14 sm:w-20 mb-3 sm:mb-4 drop-shadow-md"
				/>
				<div
					class="w-12 h-12 sm:w-16 sm:h-16 rounded-full preset-tonal-success flex items-center justify-center mb-3 sm:mb-4"
				>
					<svg
						class="w-7 h-7 sm:w-9 sm:h-9 text-success-600"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2.5"
							d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
						/>
					</svg>
				</div>
				<h1
					class="text-xl sm:text-2xl font-black text-success-600 dark:text-success-400 uppercase tracking-tighter text-center"
				>
					Autenticidade Confirmada
				</h1>
				<p class="text-surface-500 font-medium text-center text-sm sm:text-base mt-1">
					Este documento é autêntico e foi assinado digitalmente
				</p>
			</div>

			<div class="space-y-4 sm:space-y-6">
				<!-- Status criptográfico (CAdES-LT) -->
				<section
					class="p-4 sm:p-6 bg-surface-100 dark:bg-surface-700/50 rounded-xl sm:rounded-2xl border border-surface-200 dark:border-white/5"
				>
					<div class="flex items-center justify-between mb-3 sm:mb-4 flex-wrap gap-2">
						<h2 class="text-3xs font-bold text-surface-500 uppercase tracking-widest">
							Status Criptográfico
						</h2>
						<div class="flex gap-2 flex-wrap">
							{#if ehQualificada}
								<span
									class="text-3xs font-black uppercase px-2 py-0.5 rounded-full preset-tonal-primary tracking-wider"
									>ICP-Brasil</span
								>
							{:else}
								<span
									class="text-3xs font-black uppercase px-2 py-0.5 rounded-full preset-tonal-warning tracking-wider"
									>Avançada (Lei 14.063/2020)</span
								>
							{/if}
							{#if v?.padesLt?.presente}
								<span
									class="text-3xs font-black uppercase px-2 py-0.5 rounded-full preset-tonal-success tracking-wider"
									title="DSS Dictionary embarcado: certificados e OCSP dentro do próprio PDF (ETSI EN 319 142-1)"
									>PAdES-LT</span
								>
							{/if}
						</div>
					</div>
					<div class="space-y-2 text-xs sm:text-sm">
						<!-- Integridade do arquivo -->
						<div class="flex items-start gap-2">
							{#if data.hashConfere === true}
								<span class="text-success-600 font-black shrink-0">✓</span>
								<span class="text-surface-700 dark:text-surface-300"
									><strong>Integridade do arquivo:</strong> hash do PDF confere com o registro original.</span
								>
							{:else if data.hashConfere === false}
								<span class="text-error-600 font-black shrink-0">✕</span>
								<span class="text-error-700 dark:text-error-400 font-bold"
									>O arquivo armazenado foi alterado após a assinatura.</span
								>
							{:else}
								<span class="text-surface-400 font-black shrink-0">?</span>
								<span class="text-surface-500 italic"
									>Verificação de integridade indisponível (registro antigo).</span
								>
							{/if}
						</div>

						{#if v}
							<!-- Cadeia ICP-Brasil -->
							<div class="flex items-start gap-2">
								{#if v.checks.cadeiaIcpBrasil === true}
									<span class="text-success-600 font-black shrink-0">✓</span>
									<span class="text-surface-700 dark:text-surface-300"
										><strong>Cadeia ICP-Brasil:</strong> certificado encadeia até uma AC Raiz reconhecida.</span
									>
								{:else if v.checks.cadeiaIcpBrasil === 'indisponivel'}
									<span class="text-warning-600 font-black shrink-0">⚠</span>
									<span class="text-surface-500 italic"
										>Cadeia ICP-Brasil não validada (trust store ainda não populado).</span
									>
								{:else}
									<span class="text-error-600 font-black shrink-0">✕</span>
									<span class="text-error-700 dark:text-error-400 font-bold"
										>Cadeia ICP-Brasil inválida.</span
									>
								{/if}
							</div>
							<!-- Assinatura RSA -->
							<div class="flex items-start gap-2">
								{#if v.checks.assinaturaRsa}
									<span class="text-success-600 font-black shrink-0">✓</span>
									<span class="text-surface-700 dark:text-surface-300"
										><strong>Assinatura RSA:</strong> SignedAttributes íntegros e assinados pela chave
										do certificado.</span
									>
								{:else}
									<span class="text-error-600 font-black shrink-0">✕</span>
									<span class="text-error-700 dark:text-error-400 font-bold"
										>Assinatura RSA inválida.</span
									>
								{/if}
							</div>
							<!-- Carimbo de tempo -->
							<div class="flex items-start gap-2">
								{#if v.checks.timestampQualificado}
									<span class="text-success-600 font-black shrink-0">✓</span>
									<span class="text-surface-700 dark:text-surface-300"
										><strong>Carimbo de tempo qualificado:</strong> ACT/ICP-Brasil (RFC 3161){#if v.timestamp},
											em {formatarDataHora(v.timestamp.momento)}{/if}.</span
									>
								{:else if v.timestamp?.tipo === 'tsa_externa'}
									<span class="text-warning-600 font-black shrink-0">⚠</span>
									<span class="text-surface-700 dark:text-surface-300"
										><strong>Carimbo de tempo:</strong> TSA externa não-ICP (RFC 3161){#if v.timestamp},
											em {formatarDataHora(v.timestamp.momento)}{/if}. Assinatura do carimbo
										verificada, mas sem a presunção ICP-Brasil.</span
									>
								{:else}
									<span class="text-warning-600 font-black shrink-0">⚠</span>
									<span class="text-surface-500"
										><strong>Carimbo de tempo:</strong> apenas hora do servidor (sem ACT/ICP).</span
									>
								{/if}
							</div>
							<!-- Política de assinatura -->
							{#if v.politica}
								<div class="flex items-start gap-2">
									{#if v.politica.conforme}
										<span class="text-success-600 font-black shrink-0">✓</span>
										<span class="text-surface-700 dark:text-surface-300"
											><strong>Política de assinatura:</strong>
											{v.politica.nome} (ICP-Brasil).</span
										>
									{:else if v.politica.presente}
										<span class="text-warning-600 font-black shrink-0">⚠</span>
										<span class="text-surface-500"
											><strong>Política de assinatura:</strong> declarada, mas o OID/hash não confere
											com a PA-AD-RB v2.3.</span
										>
									{:else}
										<span class="text-warning-600 font-black shrink-0">⚠</span>
										<span class="text-surface-500"
											><strong>Política de assinatura:</strong> não aplicada (sem id-aa-ets-sigPolicyId).</span
										>
									{/if}
								</div>
							{/if}
							<!-- Revogação -->
							<div class="flex items-start gap-2">
								{#if v.checks.revogacao === 'good'}
									<span class="text-success-600 font-black shrink-0">✓</span>
									<span class="text-surface-700 dark:text-surface-300"
										><strong>Revogação:</strong> certificado válido (snapshot OCSP{#if data.documento.ocsp_consultado_em}
											de {formatarDataHora(data.documento.ocsp_consultado_em)}{/if}).</span
									>
								{:else if v.checks.revogacao === 'revoked'}
									<span class="text-error-600 font-black shrink-0">✕</span>
									<span class="text-error-700 dark:text-error-400 font-bold"
										>Certificado REVOGADO pela Autoridade Certificadora.</span
									>
								{:else}
									<span class="text-surface-400 font-black shrink-0">?</span>
									<span class="text-surface-500 italic"
										>Verificação OCSP indisponível para este documento (assinado antes da migração
										de auditoria).</span
									>
								{/if}
							</div>
							{#if v.certificado}
								<div
									class="pt-2 mt-2 border-t border-surface-200 dark:border-white/5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-2xs text-surface-500"
								>
									<div><strong>Emissor:</strong> {v.certificado.issuer || '—'}</div>
									<div>
										<strong>Série:</strong>
										{v.certificado.serial.slice(0, 16)}{v.certificado.serial.length > 16 ? '…' : ''}
									</div>
									<div><strong>Válido de:</strong> {formatarDataHora(v.certificado.validoDe)}</div>
									<div>
										<strong>Válido até:</strong>
										{formatarDataHora(v.certificado.validoAte)}
									</div>
								</div>
							{/if}
							{#if v.assinaturasAdicionais && v.assinaturasAdicionais.length > 0}
								<div class="pt-2 mt-2 border-t border-surface-200 dark:border-white/5">
									<p class="text-2xs font-bold text-surface-500 uppercase tracking-wider mb-1">
										Assinaturas anteriores ({v.assinaturasAdicionais.length})
									</p>
									<ul class="space-y-0.5">
										{#each v.assinaturasAdicionais as ass (ass.ordem)}
											<li class="flex items-center gap-2 text-2xs">
												<span
													class="font-black {ass.integridade && ass.assinaturaRsa
														? 'text-success-600'
														: 'text-error-600'}"
												>
													{ass.integridade && ass.assinaturaRsa ? '✓' : '✕'}
												</span>
												<span class="text-surface-700 dark:text-surface-300 truncate">
													#{ass.ordem + 1}
													{ass.signerCN || '(signatário desconhecido)'}
												</span>
											</li>
										{/each}
									</ul>
								</div>
							{/if}
							{#if !v.valid && v.erros.length > 0}
								<div
									class="mt-2 p-2 bg-error-50 dark:bg-error-900/20 border border-error-200 dark:border-error-700/30 rounded text-2xs text-error-700 dark:text-error-300"
								>
									<strong>Falhas detectadas:</strong>
									<ul class="list-disc pl-4 mt-1">
										{#each v.erros as e (e)}
											<li>{e}</li>
										{/each}
									</ul>
								</div>
							{/if}
						{:else if !ehQualificada}
							{#if data.selo?.presente}
								<!-- Selo institucional (CMS autoassinado, não-ICP) -->
								<div class="flex items-start gap-2">
									{#if data.selo.integro}
										<span class="text-success-600 font-black shrink-0">✓</span>
										<span class="text-surface-700 dark:text-surface-300"
											><strong>Selo institucional:</strong> documento íntegro e à prova de
											adulteração{#if data.selo.autentico}, certificado confere com o selo oficial{/if}.</span
										>
									{:else}
										<span class="text-error-600 font-black shrink-0">✕</span>
										<span class="text-error-700 dark:text-error-400 font-bold"
											>Selo institucional inválido — documento adulterado após a assinatura.</span
										>
									{/if}
								</div>
								{#if data.selo.tipoCarimboTempo && data.selo.tipoCarimboTempo !== 'servidor'}
									<div class="flex items-start gap-2">
										<span class="text-success-600 font-black shrink-0">✓</span>
										<span class="text-surface-700 dark:text-surface-300"
											><strong>Carimbo de tempo:</strong> RFC 3161 (TSA externa, não-ICP){#if data.selo.momento},
												em {formatarDataHora(data.selo.momento)}{/if}.</span
										>
									</div>
								{/if}
								<p class="text-2xs text-surface-500 italic pt-1">
									Avançada (Lei 14.063/2020 art. 4º, II) com selo criptográfico da instituição. Não
									é ICP-Brasil — sem a presunção do art. 10 §1º da MP 2.200-2/2001.
								</p>
							{:else}
								<p class="text-2xs text-surface-500 italic pt-1">
									Assinatura avançada (rubrica + selfie + GPS + IP). Validade jurídica conforme Lei
									14.063/2020 art. 4º, II.
								</p>
							{/if}
						{/if}
					</div>
				</section>

				<!-- Informações do Documento -->
				<section
					class="p-4 sm:p-6 bg-surface-100 dark:bg-surface-700/50 rounded-xl sm:rounded-2xl border border-surface-200 dark:border-white/5"
				>
					<h2 class="text-3xs font-bold text-surface-500 uppercase tracking-widest mb-3 sm:mb-4">
						Informações do Documento
					</h2>
					<div class="grid grid-cols-1 gap-3 sm:gap-6">
						<div>
							<span
								class="block text-3xs uppercase font-bold text-surface-500 dark:text-surface-400"
								>Título / Tipo</span
							>
							<span
								class="text-base sm:text-lg font-bold text-surface-800 dark:text-white leading-tight"
								>{data.escala.titulo}</span
							>
						</div>
						<div>
							<span
								class="block text-3xs uppercase font-bold text-surface-500 dark:text-surface-400"
								>Unidade / Cidade</span
							>
							<span
								class="text-base sm:text-lg font-bold text-surface-800 dark:text-white leading-tight"
								>{data.escala.lotacao} — {data.escala.cidade}</span
							>
						</div>
						<div>
							<span
								class="block text-3xs uppercase font-bold text-surface-500 dark:text-surface-400"
								>Período</span
							>
							<span class="text-base sm:text-lg font-bold text-surface-800 dark:text-white">
								{formatarData(data.escala.data_inicio)} a {formatarData(data.escala.data_fim ?? '')}
							</span>
						</div>
					</div>
				</section>

				<!-- Informações da Assinatura (Supervisor) -->
				<section
					class="p-4 sm:p-6 border-l-4 border-primary-500 bg-primary-50/30 dark:bg-primary-500/10 rounded-r-xl sm:rounded-r-2xl"
				>
					<h2
						class="text-3xs font-bold text-primary-600 dark:text-primary-400 uppercase tracking-widest mb-3 sm:mb-4"
					>
						Assinatura Certificadora (Supervisor)
					</h2>
					<div class="space-y-3 sm:space-y-4">
						<div class="flex items-start gap-3 sm:gap-4">
							<div
								class="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-500 shrink-0"
							>
								<svg
									class="w-5 h-5 sm:w-6 sm:h-6"
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
							</div>
							<div class="min-w-0">
								<span
									class="block text-3xs uppercase font-bold text-surface-500 dark:text-surface-400"
									>Assinado Digitalmente por</span
								>
								<span
									class="text-lg sm:text-xl font-black text-surface-900 dark:text-white uppercase leading-none break-words"
									>{documento.assinante_nome}</span
								>
								{#if documento.assinante_cpf}
									<span class="block text-xs text-surface-500 mt-1"
										>CPF: {documento.assinante_cpf}</span
									>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
							<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
								/>
							</svg>
							<span>Data e Hora: <strong>{formatarDataHora(documento.created_at)}</strong></span>
						</div>
					</div>
				</section>

				<!-- Confirmações de Presença (Equipe) — agregado (LGPD: sem roster nominal) -->
				{#if data.equipeResumo && data.equipeResumo.total > 0}
					<section class="space-y-3">
						<h2 class="text-3xs font-bold text-surface-500 uppercase tracking-widest px-1">
							Confirmações de Presença (Equipe)
						</h2>
						<div
							class="p-4 bg-surface-100 dark:bg-surface-700/50 rounded-xl sm:rounded-2xl border border-surface-200 dark:border-white/5"
						>
							<p class="text-sm text-surface-700 dark:text-surface-300">
								<strong class="text-surface-900 dark:text-white"
									>{data.equipeResumo.confirmados}</strong
								>
								de
								<strong class="text-surface-900 dark:text-white">{data.equipeResumo.total}</strong>
								integrantes confirmaram presença.
							</p>
							<p class="text-3xs text-surface-500 dark:text-surface-400 mt-1.5">
								Nomes e horários individuais são restritos e não exibidos na validação pública.
							</p>
						</div>
					</section>
				{/if}

				<!-- Download do Documento -->
				<section
					class="p-4 sm:p-6 preset-tonal-primary border border-primary-500/20 rounded-xl sm:rounded-2xl"
				>
					<h2
						class="text-3xs font-bold text-primary-700 dark:text-primary-400 uppercase tracking-widest mb-2 sm:mb-3"
					>
						Documento Original
					</h2>
					{#if data.autenticado}
						<p class="text-sm text-surface-700 dark:text-surface-300 mb-3 sm:mb-4">
							Faça o download do documento digital assinado e compare com o documento impresso que
							você possui. As informações devem ser idênticas.
						</p>
						<button
							type="button"
							onclick={handleDownload}
							disabled={baixando}
							class="btn preset-filled-primary-500 w-full sm:w-auto font-bold rounded-xl text-sm touch-manipulation flex items-center justify-center gap-2"
						>
							{#if baixando}
								<Spinner size="md" class="text-white" />
								<span>PROCESSANDO...</span>
							{:else}
								<svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
									/>
								</svg>
								<span>Baixar Documento Assinado (PDF)</span>
							{/if}
						</button>
					{:else}
						<p class="text-sm text-surface-700 dark:text-surface-300 mb-3 sm:mb-4">
							A autenticidade deste documento já está comprovada acima — assinante, data,
							certificado e hash. O <strong>documento assinado na íntegra</strong> contém dados restritos
							e está disponível apenas para usuários autenticados.
						</p>
						<a
							href="/login"
							class="btn preset-filled-primary-500 w-full sm:w-auto font-bold rounded-xl text-sm touch-manipulation inline-flex items-center justify-center gap-2"
						>
							<svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
								/>
							</svg>
							<span>Faça login para baixar o documento</span>
						</a>
					{/if}
				</section>

				<!-- Instrução de Comparação -->
				<div
					class="flex items-start gap-3 p-4 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-700/30 rounded-xl sm:rounded-2xl"
				>
					<svg
						class="w-5 h-5 text-warning-600 dark:text-warning-400 shrink-0 mt-0.5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					<p class="text-sm text-warning-800 dark:text-warning-300">
						<strong>Como verificar:</strong> Baixe o documento digital acima e compare seu conteúdo com
						o documento impresso. Verifique se os nomes, períodos, datas e demais informações são idênticos.
						Qualquer divergência deve ser comunicada à unidade responsável.
					</p>
				</div>

				<!-- Validador ITI: oferece conferência cruzada para assinaturas qualificadas. -->
				{#if ehQualificada}
					<div
						class="flex items-start gap-3 p-4 bg-primary-50/50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-700/30 rounded-xl sm:rounded-2xl"
					>
						<svg
							class="w-5 h-5 text-primary-600 dark:text-primary-400 shrink-0 mt-0.5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
							/>
						</svg>
						<div class="flex-1">
							<p class="text-sm text-primary-800 dark:text-primary-300 mb-2">
								<strong>Validação independente:</strong> esta assinatura pode ser conferida no validador
								oficial do Instituto Nacional de Tecnologia da Informação (ITI).
							</p>
							<a
								href="https://validar.iti.gov.br"
								target="_blank"
								rel="noopener noreferrer"
								class="inline-flex items-center gap-1.5 text-xs font-bold text-primary-700 dark:text-primary-300 hover:underline"
							>
								Abrir Validador ITI
								<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
									/>
								</svg>
							</a>
							<p class="text-3xs text-surface-500 mt-1">
								Faça upload do PDF baixado acima para conferir independentemente.
							</p>
						</div>
					</div>
				{/if}
			</div>

			<footer
				class="mt-6 sm:mt-10 pt-4 sm:pt-6 border-t border-surface-200 dark:border-white/5 text-center"
			>
				<p
					class="text-3xs text-surface-500 dark:text-surface-400 uppercase font-black tracking-widest"
				>
					Ponto de Preservação Digital - PC-CE
				</p>
				<p
					class="text-3xs text-surface-500 dark:text-surface-400 mt-2 max-w-md mx-auto leading-relaxed"
				>
					Esta conferência confirma que o arquivo digital carregado corresponde integralmente ao
					teor da escala gerenciada pelo sistema oficial em {formatarDataHora(
						data.documento.created_at
					)}.
				</p>
			</footer>
		{:else}
			<!-- ❌ DOCUMENTO NÃO ENCONTRADO / ERRO -->
			{@const erroInterno = data.motivo === 'erro_db' || data.motivo === 'erro_consulta'}

			<div class="flex flex-col items-center mb-6 sm:mb-10">
				<img
					src="/api/validar/logo"
					alt="Brasão do Estado do Ceará"
					class="w-14 sm:w-20 mb-3 sm:mb-4 drop-shadow-md"
				/>
				<div
					class="w-12 h-12 sm:w-16 sm:h-16 rounded-full {erroInterno
						? 'bg-warning-500/10'
						: 'bg-error-500/10'} flex items-center justify-center mb-3 sm:mb-4"
				>
					{#if erroInterno}
						<svg
							class="w-7 h-7 sm:w-9 sm:h-9 text-warning-600"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2.5"
								d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
					{:else}
						<svg
							class="w-7 h-7 sm:w-9 sm:h-9 text-error-600"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2.5"
								d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
							/>
						</svg>
					{/if}
				</div>
				<h1
					class="text-xl sm:text-2xl font-black {erroInterno
						? 'text-warning-600 dark:text-warning-400'
						: 'text-error-600 dark:text-error-400'} uppercase tracking-tighter text-center"
				>
					{erroInterno ? 'Erro ao Consultar' : 'Documento Não Encontrado'}
				</h1>
				<p class="text-surface-500 font-medium text-center mt-2 text-sm sm:text-base">
					{#if erroInterno}
						Ocorreu um erro interno ao consultar o sistema. Tente novamente em alguns instantes.
					{:else}
						O código de verificação informado não corresponde a nenhum documento registrado no
						sistema.
					{/if}
				</p>
			</div>

			<div
				class="p-4 sm:p-6 {erroInterno
					? 'bg-warning-50 dark:bg-warning-900/20 border-warning-200 dark:border-warning-700/30'
					: 'bg-error-50 dark:bg-error-900/20 border-error-200 dark:border-error-700/30'} border rounded-xl sm:rounded-2xl text-center space-y-3"
			>
				{#if erroInterno}
					<p class="text-sm text-warning-800 dark:text-warning-300">
						Não foi possível verificar a autenticidade neste momento. Por favor, tente novamente ou
						contate o suporte.
					</p>
				{:else}
					<p class="text-sm text-error-800 dark:text-error-300">
						Este documento pode ser <strong>falso ou adulterado</strong>. Não utilize este
						documento.
					</p>
					<p class="text-xs text-surface-500">
						Se você acredita que há um erro, entre em contato com a unidade que emitiu o documento.
					</p>
				{/if}
			</div>

			<footer
				class="mt-6 sm:mt-10 pt-4 sm:pt-6 border-t border-surface-200 dark:border-white/5 text-center"
			>
				<p
					class="text-3xs text-surface-500 dark:text-surface-400 uppercase font-black tracking-widest"
				>
					Ponto de Preservação Digital - PC-CE
				</p>
			</footer>
		{/if}
	</div>

	<p class="mt-6 text-xs text-surface-500/50">SISTEMA GERENCIADOR DE ESCALAS © 2026</p>
</div>
