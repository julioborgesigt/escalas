import { json } from '@sveltejs/kit';
import { getDB, buscarDocumentoPorHash } from '$lib/db';
import { getR2 } from '$lib/server/platform';
import { contentDisposition } from '$lib/server/api';
import { logger } from '$lib/server/logger';
import type { RequestEvent } from '@sveltejs/kit';

export const GET = async ({ platform, params, url }: RequestEvent) => {
	const db = getDB(platform);
	const hash = params.hash;

	if (!hash) {
		return json({ error: 'Código de verificação ausente' }, { status: 400 });
	}

	logger.info('[validar/download] Iniciando', { hash });

	const documento = await buscarDocumentoPorHash(db, hash);
	if (!documento) {
		logger.warn('[validar/download] Documento não encontrado', { hash });
		return json({ error: 'Documento não encontrado' }, { status: 404 });
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

					const filename = documento.tipo_doc === 'gise_relatorio'
						? `relatorio_${documento.rel_tipo}_${hash}.pdf`
						: `documento_assinado_${hash}.pdf`;

					resHeaders.set('Content-Disposition', contentDisposition(filename));
					// Documento é imutável por hash — pode ser cacheado agressivamente
					// pelo edge/CDN e pelo navegador. Reduz leituras no R2 em hits
					// repetidos (validação pública da mesma URL).
					resHeaders.set('Cache-Control', 'public, max-age=86400, immutable');
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
			const { buscarGiseDetalhado, buscarPresencasGise, buscarRespostasProdutividadeSeccional, buscarAssinaturaRelatorioGise } = await import('$lib/db');
			const { gerarRelatorioExtraordinarioPdf, gerarRelatorioExtraordinarioSupervisaoPdf, gerarRelatorioProdutividadeGisePdf, toGisePdfData } = await import('$lib/export');
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
				return json({ error: 'GISE não encontrada' }, { status: 404 });
			}

			const seccionalId = documento.seccional_id;
			const relTipo = documento.rel_tipo;

			// Buscar a assinatura original para garantir que as rubricas/certificação apareçam
			const reportSignature = await buscarAssinaturaRelatorioGise(db, documento.escala_id, seccionalId, relTipo);

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
				const seccional = gise.seccionais.find((s: any) => s.id === seccionalId || s.seccional_id === seccionalId);
				if (!seccional) {
					logger.error('[validar/download] Seccional ausente na GISE', {
						hash,
						seccional_id: seccionalId
					});
					return json({ error: 'Seccional não encontrada' }, { status: 404 });
				}

				const respostas = await buscarRespostasProdutividadeSeccional(db, documento.escala_id, seccional.id);
				const result = gerarRelatorioProdutividadeGisePdf({ gise, seccional, respostas });
				finalPdf = result.pdf;
			}

			// Aplicar o rodapé de certificação estilo GISE (QR Code e Hash)
			if (reportSignature) {
				const qrUrl = `${url.origin}/validar/${hash}`;
				finalPdf = await adicionarRodapeSimples(
					finalPdf,
					reportSignature.assinante_nome,
					{
						verificationHash: hash,
						verificationUrl: qrUrl,
						rubricBase64: reportSignature.rubrica ?? undefined
					}
				);
			}

			logger.info('[validar/download] Re-geração dinâmica concluída', { hash });
			const filename = `relatorio_${relTipo}_${hash}.pdf`;
			return new Response(finalPdf as any, {
				headers: {
					'Content-Type': 'application/pdf',
					'Content-Disposition': contentDisposition(filename),
					'Cache-Control': 'no-cache'
				}
			});
		} catch (err) {
			logger.error('[validar/download] Falha crítica na geração dinâmica', {
				hash,
				error: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack : undefined
			});
			return new Response(JSON.stringify({
				error: 'Erro ao processar documento. Tente novamente.'
			}), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}

	logger.error('[validar/download] PDF indisponível em todas as fontes', { hash });
	return json({ error: 'Arquivo PDF não disponível para este documento' }, { status: 404 });
};
