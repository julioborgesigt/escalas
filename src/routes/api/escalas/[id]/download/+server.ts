import { error, json } from '@sveltejs/kit';
import { getDB, buscarEscala, listarPoliciaisEscala } from '$lib/db';
import { gerarDocx, gerarXlsx, gerarPdf, gerarOds } from '$lib/export';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, params, url, locals }) => {
	const db = getDB(platform);
	const format = url.searchParams.get('format') || 'docx';
	const escala = await buscarEscala(db, Number(params.id));

	if (!escala) throw error(404, 'Escala não encontrada');

	// Policial só pode baixar escalas da sua lotação
	if (locals.usuario?.tipo === 'policial' && escala.lotacao !== locals.usuario.lotacao) {
		throw error(403, 'Sem permissão');
	}

	const policiais = await listarPoliciaisEscala(db, escala.id);

	if (policiais.length === 0) {
		throw error(400, 'Escala sem policiais cadastrados');
	}

	const filename = `escala_${escala.cidade.toLowerCase().replace(/\s+/g, '_')}_${escala.data_inicio}`;

	let data: Uint8Array;
	let contentType: string;
	let ext: string;

	try {
		switch (format) {
			case 'docx':
				data = await gerarDocx(escala, policiais);
				contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
				ext = 'docx';
				break;
			case 'odt':
				data = await gerarDocx(escala, policiais);
				contentType = 'application/vnd.oasis.opendocument.text';
				ext = 'odt';
				break;
			case 'xlsx':
				data = gerarXlsx(escala, policiais);
				contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
				ext = 'xlsx';
				break;
			case 'ods':
				data = gerarOds(escala, policiais);
				contentType = 'application/vnd.oasis.opendocument.spreadsheet';
				ext = 'ods';
				break;
			case 'pdf':
				data = gerarPdf(escala, policiais);
				contentType = 'application/pdf';
				ext = 'pdf';
				break;
			default:
				throw error(400, 'Formato inválido. Use: docx, odt, xlsx, ods, pdf');
		}
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : 'Erro desconhecido';
		return json({ error: `Erro ao gerar ${format}: ${msg}` }, { status: 500 });
	}

	return new Response(data, {
		headers: {
			'Content-Type': contentType,
			'Content-Disposition': `attachment; filename="${filename}.${ext}"`
		}
	});
};
