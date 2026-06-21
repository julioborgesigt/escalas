import { getDB, buscarDocumentoPorHash } from '$lib/db';
import { validarSessao } from '$lib/auth';
import { getR2 } from '$lib/server/platform';
import {
	contentDisposition,
	badRequest,
	notFound,
	unauthorized,
	rateLimited,
	serverError
} from '$lib/server/api';
import { contarRecoveryAttempts, registrarRecoveryAttempt } from '$lib/server/recovery-rate-limit';
import { registrarAuditComContexto } from '$lib/db/audit';
import { podeBaixarForense, gerarCopiaConferencia } from '$lib/server/copia-conferencia';
import { carregarLogosGise } from '$lib/server/gise-logos';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

// Rate-limit do download por IP — defesa em profundidade contra enumeração do
// hash (~40 bits) por um usuário autenticado. Estado em D1 (serverless-safe).
const VALIDAR_DOWNLOAD_MAX = 60;
const VALIDAR_DOWNLOAD_WINDOW_MIN = 10;

/** Carrega um logo do R2 para a regeneração do rascunho (best-effort). */
async function carregarLogoConferencia(
	platform: App.Platform | undefined,
	key: string
): Promise<Uint8Array | undefined> {
	try {
		const r2 = getR2(platform);
		if (!r2) return undefined;
		const obj = await r2.get(key);
		if (!obj) return undefined;
		return new Uint8Array(await obj.arrayBuffer());
	} catch {
		return undefined;
	}
}

/** Response de cópia de conferência (sem cache em proxies compartilhados). */
function pdfConferencia(buffer: Uint8Array, filename: string): Response {
	return new Response(buffer as unknown as BodyInit, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': contentDisposition(filename),
			'Cache-Control': 'private, no-store'
		}
	});
}

export const GET: RequestHandler = async ({ platform, params, url, cookies, getClientAddress }) => {
	const db = getDB(platform);
	const hash = params.hash;

	if (!hash) return badRequest('Código de verificação ausente');

	// O PDF assinado ÍNTEGRO contém o manifesto forense (CPF, IP, GPS, selfie) e
	// fica RESTRITO a usuários autenticados. A página /validar continua pública e
	// prova a autenticidade (assinante, data, certificado, hash) sem expor o
	// forense. Validamos a sessão manualmente: a rota está no allowlist público do
	// hook (para manter a página e /api/validar/logo públicos), então
	// `locals.usuario` não é populado aqui.
	const usuario = await validarSessao(db, cookies.get('session_token'), platform).catch(() => null);
	if (!usuario) {
		return unauthorized('Faça login para baixar o documento assinado na íntegra.');
	}

	// Mesmo autenticado, limita varredura do hash por IP. Fail-open em erro.
	const ip = getClientAddress();
	try {
		const { blocked } = await contarRecoveryAttempts(
			db,
			ip,
			'validar_download',
			VALIDAR_DOWNLOAD_WINDOW_MIN,
			VALIDAR_DOWNLOAD_MAX
		);
		if (blocked) {
			logger.warn('[validar/download] Rate-limit excedido', { hash });
			return rateLimited('Muitas validações a partir deste IP. Tente novamente em alguns minutos.');
		}
		await registrarRecoveryAttempt(db, ip, 'validar_download');
	} catch (err) {
		logger.error('[validar/download] Falha no rate-limit (fail-open)', {
			hash,
			error: err instanceof Error ? err.message : String(err)
		});
	}

	logger.info('[validar/download] Iniciando', { hash });

	const documento = await buscarDocumentoPorHash(db, hash);
	if (!documento) {
		logger.warn('[validar/download] Documento não encontrado', { hash });
		return notFound('Documento');
	}

	logger.info('[validar/download] Documento localizado', {
		hash,
		tipo: documento.tipo_doc,
		r2_key: documento.r2_key || null
	});

	const privilegiado = podeBaixarForense(usuario);

	// Usuários NÃO privilegiados nunca recebem o blob forense (manifesto com
	// CPF/IP/GPS/selfie). Recebem a cópia de conferência regenerada (sem manifesto)
	// + rodapé/QR para /validar. (gise_relatorio já cai no caminho de regeneração
	// manifest-free mais abaixo, então só tratamos escala/gise aqui.)
	if (!privilegiado) {
		const verificationUrl = `${url.origin}/validar/${hash}`;
		if (documento.tipo_doc === 'escala') {
			const { buscarEscala, listarPoliciaisEscala } = await import('$lib/db');
			const exportLib = await import('$lib/server/export');
			const escala = await buscarEscala(db, documento.escala_id);
			if (!escala) return notFound('Escala');
			const policiais = await listarPoliciaisEscala(db, documento.escala_id);
			let rascunho: Uint8Array;
			if (escala.tipo === 'expediente') {
				const [logoPolicia, logoCeara] = await Promise.all([
					carregarLogoConferencia(platform, 'assets/logogise.jpg'),
					carregarLogoConferencia(platform, 'assets/logo_ceara.jpg')
				]);
				rascunho = (await exportLib.gerarPdfExpediente(escala, policiais, logoPolicia, logoCeara))
					.pdf;
			} else if (escala.tipo === 'plantao') {
				rascunho = exportLib.gerarPdfPlantao(escala, policiais).pdf;
			} else {
				rascunho = exportLib.gerarPdf(escala, policiais).pdf;
			}
			const buffer = await gerarCopiaConferencia({
				pdfRascunho: rascunho,
				assinanteNome: documento.assinante_nome,
				verificationHash: hash,
				verificationUrl
			});
			return pdfConferencia(buffer, `conferencia_escala_${hash}.pdf`);
		}
		if (documento.tipo_doc === 'gise') {
			const { buscarGiseDetalhado } = await import('$lib/db');
			const { gerarRascunhoGisePdf } = await import('$lib/server/conferencia-pdf');
			const gise = await buscarGiseDetalhado(db, documento.escala_id);
			if (!gise) return notFound('GISE');
			const rascunho = await gerarRascunhoGisePdf(db, gise, platform);
			const buffer = await gerarCopiaConferencia({
				pdfRascunho: rascunho,
				assinanteNome: documento.assinante_nome,
				verificationHash: hash,
				verificationUrl
			});
			return pdfConferencia(buffer, `conferencia_gise_${hash}.pdf`);
		}
		// gise_relatorio: segue para a regeneração manifest-free abaixo.
	}

	// Blob forense do R2 — somente privilegiado chega aqui com r2_key.
	if (privilegiado && documento.r2_key) {
		const r2 = getR2(platform);
		if (r2) {
			try {
				const obj = await r2.get(documento.r2_key);
				if (obj) {
					// Acesso forense (PII: CPF/IP/GPS/selfie) pelo Super Admin — auditar.
					await registrarAuditComContexto(db, {
						usuario,
						acao: 'download_validar_forense',
						entidade: documento.tipo_doc,
						entidade_id: documento.escala_id,
						detalhes: `hash=${hash}`,
						ip
					});
					logger.info('[validar/download] PDF recuperado do R2', {
						hash,
						r2_key: documento.r2_key
					});
					const arrayBuffer = await obj.arrayBuffer();
					const resHeaders = new Headers();
					resHeaders.set('Content-Type', 'application/pdf');

					const filename =
						documento.tipo_doc === 'gise_relatorio'
							? `relatorio_${documento.rel_tipo}_${hash}.pdf`
							: `documento_assinado_${hash}.pdf`;

					resHeaders.set('Content-Disposition', contentDisposition(filename));
					// PII sensível (nome/CPF/IP/GPS no manifesto): NUNCA cachear em
					// CDN/edge nem em proxies compartilhados — isso espalharia o PDF a
					// qualquer um E contornaria o rate-limit (hits servidos do cache não
					// chegam à origem, logo não contam). `private, no-store` mantém o
					// controle no servidor; o custo é reler do R2, aceitável no baixo
					// volume de validação.
					resHeaders.set('Cache-Control', 'private, no-store');
					return new Response(arrayBuffer, {
						headers: resHeaders,
						status: 200
					});
				} else {
					logger.warn('[validar/download] R2 key existe mas arquivo ausente', {
						hash,
						r2_key: documento.r2_key
					});
				}
			} catch (r2Err) {
				logger.error('[validar/download] Erro ao acessar R2', {
					hash,
					r2_key: documento.r2_key,
					error: r2Err instanceof Error ? r2Err.message : String(r2Err)
				});
			}
		} else {
			logger.warn('[validar/download] R2 binding ausente no platform.env', { hash });
		}
	}

	// Se for gise_relatorio e não encontramos no R2 (legado ou erro de sync), geramos na hora
	if (documento.tipo_doc === 'gise_relatorio') {
		logger.info('[validar/download] Re-geração dinâmica de relatório GISE', { hash });
		try {
			const {
				buscarGiseDetalhado,
				buscarPresencasGise,
				buscarRespostasProdutividadeSeccional,
				buscarAssinaturaRelatorioGise
			} = await import('$lib/db');
			const {
				gerarRelatorioExtraordinarioPdf,
				gerarRelatorioExtraordinarioSupervisaoPdf,
				gerarRelatorioProdutividadeGisePdf,
				toGisePdfData
			} = await import('$lib/server/export');
			const { getBreveRelatorioEnvMergido } = await import('$lib/server/breve-relatorio-env');
			const { secIdEhSupervisaoExtra } = await import('$lib/server/gise-supervisao-extra');
			const { adicionarRodapeSimples } = await import('$lib/server/pdf-signing');
			const brEnv = await getBreveRelatorioEnvMergido(db);

			const gise = await buscarGiseDetalhado(db, documento.escala_id);
			if (!gise) {
				logger.error('[validar/download] GISE ausente para re-geração', {
					hash,
					escala_id: documento.escala_id
				});
				return notFound('GISE');
			}

			const seccionalId = documento.seccional_id;
			const relTipo = documento.rel_tipo;

			// Buscar a assinatura original para garantir que as rubricas/certificação apareçam
			const reportSignature = await buscarAssinaturaRelatorioGise(
				db,
				documento.escala_id,
				seccionalId,
				relTipo
			);

			let finalPdf: Uint8Array;

			if (relTipo === 'extraordinario') {
				const presencas = await buscarPresencasGise(db, documento.escala_id, platform?.env);
				const isSupExtra = await secIdEhSupervisaoExtra(db, seccionalId);
				const { esq: logoEsq, dir: logoDir } = await carregarLogosGise(platform);
				const result = isSupExtra
					? await gerarRelatorioExtraordinarioSupervisaoPdf(
							gise,
							presencas,
							url.origin,
							reportSignature,
							undefined,
							false,
							brEnv,
							logoEsq,
							logoDir
						)
					: await gerarRelatorioExtraordinarioPdf(
							toGisePdfData(gise, brEnv),
							presencas,
							seccionalId,
							url.origin,
							reportSignature,
							undefined,
							false,
							logoEsq,
							logoDir
						);
				finalPdf = result.pdf;
			} else {
				const seccional = gise.seccionais.find(
					(s) => s.id === seccionalId || s.seccional_id === seccionalId
				);
				if (!seccional) {
					logger.error('[validar/download] Seccional ausente na GISE', {
						hash,
						seccional_id: seccionalId
					});
					return notFound('Seccional');
				}

				const respostas = await buscarRespostasProdutividadeSeccional(
					db,
					documento.escala_id,
					seccional.id
				);
				const result = gerarRelatorioProdutividadeGisePdf({ gise, seccional, respostas });
				finalPdf = result.pdf;
			}

			// Aplicar o rodapé de certificação estilo GISE (QR Code e Hash)
			if (reportSignature) {
				const qrUrl = `${url.origin}/validar/${hash}`;
				finalPdf = await adicionarRodapeSimples(finalPdf, reportSignature.assinante_nome, {
					verificationHash: hash,
					verificationUrl: qrUrl,
					rubricBase64: reportSignature.rubrica ?? undefined
				});
			}

			logger.info('[validar/download] Re-geração dinâmica concluída', { hash });
			const filename = `relatorio_${relTipo}_${hash}.pdf`;
			return new Response(finalPdf as unknown as BodyInit, {
				headers: {
					'Content-Type': 'application/pdf',
					'Content-Disposition': contentDisposition(filename),
					// PII no relatório: não cachear em CDN/proxies compartilhados.
					'Cache-Control': 'private, no-store'
				}
			});
		} catch (err) {
			return serverError(
				`[validar/download] Falha crítica na geração dinâmica (hash=${hash})`,
				err
			);
		}
	}

	logger.error('[validar/download] PDF indisponível em todas as fontes', { hash });
	return notFound('Arquivo PDF para este documento');
};
