import { getDB, buscarDocumentoPorHash } from '$lib/db';
import { getR2 } from '$lib/server/platform';
import { contentDisposition, badRequest, notFound, rateLimited, serverError } from '$lib/server/api';
import { contarRecoveryAttempts, registrarRecoveryAttempt } from '$lib/server/recovery-rate-limit';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

// Throttle do download público por IP — anti-enumeração do hash de validação
// (~40 bits). Folgado para validadores legítimos (auditoria, juízo), fatal para
// varredura automatizada. Estado em D1 (serverless-safe, persiste entre isolates).
const VALIDAR_DOWNLOAD_MAX = 60;
const VALIDAR_DOWNLOAD_WINDOW_MIN = 10;

export const GET: RequestHandler = async ({ platform, params, url, getClientAddress }) => {
	const db = getDB(platform);
	const hash = params.hash;

	if (!hash) return badRequest('Código de verificação ausente');

	// Este endpoint é PÚBLICO e serve o PDF assinado ÍNTEGRO, que contém dados
	// pessoais (nome, e no manifesto de auditoria CPF/IP/GPS do assinante). Sem
	// teto por IP, um atacante varreria o espaço de hashes colhendo PDFs com PII.
	// Fail-open em erro do mecanismo: indisponibilidade do rate-limit não pode
	// derrubar a validação pública.
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

	// Tentar buscar do R2 primeiro se houver r2_key (preferível para integridade digital)
	if (documento.r2_key) {
		const r2 = getR2(platform);
		if (r2) {
			try {
				const obj = await r2.get(documento.r2_key);
				if (obj) {
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
				const presencas = await buscarPresencasGise(db, documento.escala_id);
				const isSupExtra = await secIdEhSupervisaoExtra(db, seccionalId);
				const result = isSupExtra
					? await gerarRelatorioExtraordinarioSupervisaoPdf(
							gise,
							presencas,
							url.origin,
							reportSignature,
							undefined,
							false,
							brEnv
						)
					: await gerarRelatorioExtraordinarioPdf(
							toGisePdfData(gise, brEnv),
							presencas,
							seccionalId,
							url.origin,
							reportSignature
						);
				finalPdf = result.pdf;
			} else {
				const seccional = gise.seccionais.find(
					(s: any) => s.id === seccionalId || s.seccional_id === seccionalId
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
			return new Response(finalPdf as any, {
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
