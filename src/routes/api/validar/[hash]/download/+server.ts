import { json } from '@sveltejs/kit';
import { getDB, buscarDocumentoPorHash } from '$lib/db';
import type { RequestEvent } from '@sveltejs/kit';

export const GET = async ({ platform, params, url }: RequestEvent) => {
	const db = getDB(platform);
	const hash = params.hash;

	if (!hash) {
		return json({ error: 'Código de verificação ausente' }, { status: 400 });
	}

	const documento = await buscarDocumentoPorHash(db, hash) as any;
	if (!documento) {
		return json({ error: 'Documento não encontrado' }, { status: 404 });
	}

	// Se for um relatório GISE (Extra ou Produtividade), geramos na hora pois não são salvos como arquivo fixo no R2
	if (documento.tipo_doc === 'gise_relatorio') {
		try {
			const { buscarGiseDetalhado, buscarPresencasGise, buscarRespostasProdutividadeSeccional, buscarAssinaturaRelatorioGise } = await import('$lib/db');
			const { gerarRelatorioExtraordinarioPdf, gerarRelatorioProdutividadeGisePdf } = await import('$lib/export');
			const { adicionarRodapeSimples } = await import('$lib/server/pdf-signing');

			const gise = await buscarGiseDetalhado(db, documento.escala_id);
			if (!gise) return json({ error: 'GISE não encontrada' }, { status: 404 });

			const seccionalId = documento.seccional_id;
			const relTipo = documento.rel_tipo;

			// Buscar a assinatura original para garantir que as rubricas apareçam
			const reportSignature = await buscarAssinaturaRelatorioGise(db, documento.escala_id, seccionalId, relTipo);

			let finalPdf: Uint8Array;

			if (relTipo === 'extraordinario') {
				const presencas = await buscarPresencasGise(db, documento.escala_id);
				const result = await gerarRelatorioExtraordinarioPdf(gise, presencas, seccionalId, url.origin, reportSignature);
				finalPdf = result.pdf;
			} else {
				const seccional = gise.seccionais.find((s: any) => s.id === seccionalId || s.seccional_id === seccionalId);
				if (!seccional) return json({ error: 'Seccional não encontrada' }, { status: 404 });

				const respostas = await buscarRespostasProdutividadeSeccional(db, documento.escala_id, seccional.id);
				const result = gerarRelatorioProdutividadeGisePdf({ gise, seccional, respostas });
				finalPdf = result.pdf;
			}

			// Aplicar o rodapé de certificação estilo GISE
			if (reportSignature) {
				const qrUrl = `${url.origin}/validar/${hash}`;
				finalPdf = await adicionarRodapeSimples(
					finalPdf,
					reportSignature.assinante_nome,
					{
						verificationHash: hash,
						verificationUrl: qrUrl
					}
				);
			}

			const filename = `relatorio_${relTipo}_${hash}.pdf`;
			return new Response(finalPdf as any, {
				headers: {
					'Content-Type': 'application/pdf',
					'Content-Disposition': `attachment; filename="${filename}"`,
					'Cache-Control': 'no-cache'
				}
			});
		} catch (err: any) {
			console.error('[VALIDAR-DOWNLOAD-GISE]', err);
			return json({ error: 'Erro ao gerar o PDF do relatório: ' + err.message }, { status: 500 });
		}
	}

	const p = platform as any;
	if (!p?.env?.escalas_docs) {
		return json({ error: 'Storage não configurado' }, { status: 500 });
	}

	const object = await p.env.escalas_docs.get(documento.r2_key);
	if (!object) {
		return json({ error: 'Arquivo PDF não encontrado no Storage' }, { status: 404 });
	}

	const headers = new Headers();
	headers.set('Content-Type', 'application/pdf');
	headers.set('Content-Disposition', `attachment; filename="documento_assinado_${hash}.pdf"`);

	return new Response(object.body as unknown as BodyInit, { headers });
};
