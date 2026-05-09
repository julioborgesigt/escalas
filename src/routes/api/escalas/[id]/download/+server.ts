import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarEscala, listarPoliciaisEscala, buscarDocumentoEscala } from '$lib/db';
import * as exportLib from '$lib/server/export';
import { contentDisposition } from '$lib/server/api';
import { getR2 } from '$lib/server/platform';
import { logger } from '$lib/server/logger';

async function carregarLogoR2(platform: App.Platform | undefined, key: string): Promise<Uint8Array | undefined> {
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

export const GET: RequestHandler = async ({ params, platform, url, locals }) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autenticado' }, { status: 401 });

	const id = Number(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return json({ error: 'Escala não encontrada' }, { status: 404 });

	if (u.tipo !== 'admin' && u.lotacao !== escala.lotacao) {
		return json({ error: 'Sem permissão para baixar esta escala' }, { status: 403 });
	}

	const format = url.searchParams.get('format')?.toLowerCase() || 'pdf';
	const filename = `${escala.titulo.replace(/[/\\?%*:|"<>]/g, '-')}.${format === 'docx' || format === 'doc' ? 'docx' : format === 'xlsx' || format === 'excel' || format === 'xls' ? 'xlsx' : 'pdf'}`;

	try {
		// ── PDF: servir documento assinado do R2 se existir ──────────────────
		if ((format === 'pdf' || format === 'pdf') && (escala.tipo === 'expediente' || escala.tipo === 'plantao')) {
			const doc = await buscarDocumentoEscala(db, id);
			if (doc?.r2_key) {
				const r2 = getR2(platform);
				if (r2) {
					try {
						const r2Obj = await r2.get(doc.r2_key);
						if (r2Obj) {
							return new Response(await r2Obj.arrayBuffer(), {
								headers: {
									'Content-Type': 'application/pdf',
									'Content-Disposition': contentDisposition(filename),
									'Cache-Control': 'no-cache'
								}
							});
						}
					} catch (e) {
						logger.warn('[escalas/download] Falha ao buscar PDF assinado do R2', { escala_id: id, error: String(e) });
					}
				}
			}
		}

		const policiais = await listarPoliciaisEscala(db, id);

		let buffer: Uint8Array;
		let contentType: string;

		if (format === 'docx' || format === 'doc') {
			if (escala.tipo === 'plantao') buffer = await exportLib.gerarDocxPlantao(escala, policiais);
			else if (escala.tipo === 'expediente') buffer = await exportLib.gerarDocxExpediente(escala, policiais);
			else buffer = await exportLib.gerarDocx(escala, policiais);
			contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
		} else if (format === 'xlsx' || format === 'excel' || format === 'xls') {
			if (escala.tipo === 'plantao') buffer = await exportLib.gerarXlsxPlantao(escala, policiais);
			else if (escala.tipo === 'expediente') buffer = await exportLib.gerarXlsxExpediente(escala, policiais);
			else buffer = await exportLib.gerarXlsx(escala, policiais);
			contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
		} else {
			// PDF draft: carregar logos do R2 em paralelo
			let result: exportLib.PdfExportResult;
			if (escala.tipo === 'expediente') {
				const [logoPolicia, logoCeara] = await Promise.all([
					carregarLogoR2(platform, 'assets/logogise.jpg'),   // PC Civil (já em uso no GISE)
					carregarLogoR2(platform, 'assets/logo_ceara.jpg')  // Ceará Gov (fazer upload em R2)
				]);
				result = await exportLib.gerarPdfExpediente(escala, policiais, logoPolicia, logoCeara);
			} else if (escala.tipo === 'plantao') {
				result = exportLib.gerarPdfPlantao(escala, policiais);
			} else {
				result = exportLib.gerarPdf(escala, policiais);
			}
			buffer = result.pdf;
			contentType = 'application/pdf';
		}

		return new Response(buffer as BodyInit, {
			headers: {
				'Content-Type': contentType,
				'Content-Disposition': contentDisposition(filename),
				'Cache-Control': 'no-cache'
			}
		});
	} catch (err) {
		logger.error('[escalas/download] Erro ao gerar arquivo', {
			escala_id: id,
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined
		});
		return json({ error: 'Erro ao gerar o arquivo para download.' }, { status: 500 });
	}
};
