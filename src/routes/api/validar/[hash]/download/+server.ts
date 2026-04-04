import { json } from '@sveltejs/kit';
import { getDB, buscarDocumentoPorHash } from '$lib/db';
import { getR2 } from '$lib/server/platform';
import type { RequestEvent } from '@sveltejs/kit';

export const GET = async ({ platform, params, url }: RequestEvent) => {
	const db = getDB(platform);
	const hash = params.hash;

	if (!hash) {
		return json({ error: 'Código de verificação ausente' }, { status: 400 });
	}

	console.log(`[DOWNLOAD] Iniciando para hash: ${hash}`);

	const documento = await buscarDocumentoPorHash(db, hash);
	if (!documento) {
		console.error(`[DOWNLOAD] Documento não encontrado para hash: ${hash}`);
		return json({ error: 'Documento não encontrado' }, { status: 404 });
	}

	console.log(`[DOWNLOAD] Documento tipo: ${documento.tipo_doc}, R2 Key: ${documento.r2_key || 'N/A'}`);

	// Tentar buscar do R2 primeiro se houver r2_key (preferível para integridade digital)
	if (documento.r2_key) {
		const r2 = getR2(platform);
		if (r2) {
			try {
				const obj = await r2.get(documento.r2_key);
				if (obj) {
					console.log(`[DOWNLOAD] Sucesso ao recuperar do R2: ${documento.r2_key}`);
					const arrayBuffer = await obj.arrayBuffer();
					const resHeaders = new Headers();
					resHeaders.set('Content-Type', 'application/pdf');
					resHeaders.set('X-Debug-Source', 'R2');
					resHeaders.set('X-Debug-Key', documento.r2_key);
					
					const filename = documento.tipo_doc === 'gise_relatorio' 
						? `relatorio_${documento.rel_tipo}_${hash}.pdf`
						: `documento_assinado_${hash}.pdf`;
						
					resHeaders.set('Content-Disposition', `attachment; filename="${filename}"`);
					return new Response(arrayBuffer, { 
						headers: resHeaders,
						status: 200
					});
				} else {
					console.warn(`[DOWNLOAD] R2 Key existe mas arquivo não foi encontrado: ${documento.r2_key}`);
				}
			} catch (r2Err: any) {
				console.error(`[DOWNLOAD] Erro ao acessar R2 (${documento.r2_key}):`, r2Err);
			}
		} else {
			console.warn('[DOWNLOAD] R2 Bucket não configurado no platform.env');
		}
	}

	// Se for gise_relatorio e não encontramos no R2 (legado ou erro de sync), geramos na hora
	if (documento.tipo_doc === 'gise_relatorio') {
		console.log(`[DOWNLOAD] Tentando re-geração dinâmica para relatório GISE: ${hash}`);
		try {
			const { buscarGiseDetalhado, buscarPresencasGise, buscarRespostasProdutividadeSeccional, buscarAssinaturaRelatorioGise } = await import('$lib/db');
			const { gerarRelatorioExtraordinarioPdf, gerarRelatorioProdutividadeGisePdf } = await import('$lib/export');
			const { adicionarRodapeSimples } = await import('$lib/server/pdf-signing');

			const gise = await buscarGiseDetalhado(db, documento.escala_id);
			if (!gise) {
				console.error(`[DOWNLOAD] GISE ${documento.escala_id} não encontrada para re-geração.`);
				return json({ error: 'GISE não encontrada' }, { status: 404 });
			}

			const seccionalId = documento.seccional_id;
			const relTipo = documento.rel_tipo;

			// Buscar a assinatura original para garantir que as rubricas/certificação apareçam
			const reportSignature = await buscarAssinaturaRelatorioGise(db, documento.escala_id, seccionalId, relTipo);

			let finalPdf: Uint8Array;

			if (relTipo === 'extraordinario') {
				const presencas = await buscarPresencasGise(db, documento.escala_id);
				const result = await gerarRelatorioExtraordinarioPdf(gise, presencas, seccionalId, url.origin, reportSignature);
				finalPdf = result.pdf;
			} else {
				const seccional = gise.seccionais.find((s: any) => s.id === seccionalId || s.seccional_id === seccionalId);
				if (!seccional) {
					console.error(`[DOWNLOAD] Seccional ${seccionalId} não encontrada na GISE.`);
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

			console.log(`[DOWNLOAD] Sucesso na re-geração dinâmica do relatório: ${hash}`);
			const filename = `relatorio_${relTipo}_${hash}.pdf`;
			return new Response(finalPdf as any, {
				headers: {
					'Content-Type': 'application/pdf',
					'Content-Disposition': `attachment; filename="${filename}"`,
					'Cache-Control': 'no-cache',
					'X-Debug-Source': 'Regeneration',
					'X-Debug-Timestamp': new Date().toISOString()
				}
			});
		} catch (err: any) {
			console.error('[DOWNLOAD] FALHA CRÍTICA NA GERAÇÃO DINÂMICA:', err);
			return new Response(JSON.stringify({ 
				error: 'Erro ao processar PDF: ' + err.message,
				hash: hash,
				timestamp: new Date().toISOString()
			}), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}

	console.error(`[DOWNLOAD] Caso final atingido: Documento sem PDF disponível no Storage ou geração falhou. Hash: ${hash}`);
	return json({ error: 'Arquivo PDF não disponível para este documento' }, { status: 404 });
};
