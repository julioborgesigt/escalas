import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarEscala, listarPoliciaisEscala } from '$lib/db';
import * as exportLib from '$lib/export';
import { contentDisposition } from '$lib/server/api';

export const GET: RequestHandler = async ({ params, platform, url, locals }) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autenticado' }, { status: 401 });

	const id = Number(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return json({ error: 'Escala não encontrada' }, { status: 404 });

	// Verificar permissão básica (admin ou mesma lotação)
	if (u.tipo !== 'admin' && u.lotacao !== escala.lotacao) {
		return json({ error: 'Sem permissão para baixar esta escala' }, { status: 403 });
	}

	const policiais = await listarPoliciaisEscala(db, id);
	const format = url.searchParams.get('format')?.toLowerCase() || 'pdf';

	let buffer: Uint8Array;
	let contentType: string;
	let extension: string;

	try {
		if (format === 'docx' || format === 'doc') {
			if (escala.tipo === 'plantao') buffer = await exportLib.gerarDocxPlantao(escala, policiais);
			else if (escala.tipo === 'expediente') buffer = await exportLib.gerarDocxExpediente(escala, policiais);
			else buffer = await exportLib.gerarDocx(escala, policiais);
			contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
			extension = 'docx';
		} else if (format === 'xlsx' || format === 'excel' || format === 'xls') {
			if (escala.tipo === 'plantao') buffer = await exportLib.gerarXlsxPlantao(escala, policiais);
			else if (escala.tipo === 'expediente') buffer = await exportLib.gerarXlsxExpediente(escala, policiais);
			else buffer = await exportLib.gerarXlsx(escala, policiais);
			contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
			extension = 'xlsx';
		} else {
			// Default PDF
			let result;
			if (escala.tipo === 'plantao') result = exportLib.gerarPdfPlantao(escala, policiais);
			else if (escala.tipo === 'expediente') result = exportLib.gerarPdfExpediente(escala, policiais);
			else result = exportLib.gerarPdf(escala, policiais);
			buffer = result.pdf;
			contentType = 'application/pdf';
			extension = 'pdf';
		}

		const filename = `${escala.titulo.replace(/[/\\?%*:|"<>]/g, '-')}.${extension}`;

		return new Response(buffer as BodyInit, {
			headers: {
				'Content-Type': contentType,
				'Content-Disposition': contentDisposition(filename),
				'Cache-Control': 'no-cache'
			}
		});
	} catch (err) {
		console.error('[API/download] Erro ao gerar arquivo:', err);
		return json({ error: 'Erro ao gerar o arquivo para download.' }, { status: 500 });
	}
};
