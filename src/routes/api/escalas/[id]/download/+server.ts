import { error, json } from '@sveltejs/kit';
import { getDB, buscarEscala, listarPoliciaisEscala } from '$lib/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, params, url, locals }) => {
	const db = getDB(platform);
	const format = url.searchParams.get('format') || 'docx';
	const id = Number(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });
	const escala = await buscarEscala(db, id);

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

	const tipo = escala.tipo;

	try {
		switch (format) {
			case 'docx':
			case 'odt': {
				const { gerarDocx, gerarDocxExpediente, gerarDocxPlantao } = await import('$lib/export');
				data = tipo === 'expediente'
					? await gerarDocxExpediente(escala, policiais)
					: tipo === 'plantao'
						? await gerarDocxPlantao(escala, policiais)
						: await gerarDocx(escala, policiais);
				contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
				ext = 'docx';
				break;
			}
			case 'xlsx': {
				const { gerarXlsx, gerarXlsxExpediente, gerarXlsxPlantao } = await import('$lib/export');
				data = tipo === 'expediente'
					? gerarXlsxExpediente(escala, policiais)
					: tipo === 'plantao'
						? gerarXlsxPlantao(escala, policiais)
						: gerarXlsx(escala, policiais);
				contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
				ext = 'xlsx';
				break;
			}
			case 'ods': {
				const { gerarOds, gerarOdsExpediente, gerarOdsPlantao } = await import('$lib/export');
				data = tipo === 'expediente'
					? gerarOdsExpediente(escala, policiais)
					: tipo === 'plantao'
						? gerarOdsPlantao(escala, policiais)
						: gerarOds(escala, policiais);
				contentType = 'application/vnd.oasis.opendocument.spreadsheet';
				ext = 'ods';
				break;
			}
			case 'pdf': {
				const { gerarPdf, gerarPdfExpediente, gerarPdfPlantao } = await import('$lib/export');
				data = tipo === 'expediente'
					? gerarPdfExpediente(escala, policiais).pdf
					: tipo === 'plantao'
						? gerarPdfPlantao(escala, policiais).pdf
						: gerarPdf(escala, policiais).pdf;
				contentType = 'application/pdf';
				ext = 'pdf';
				break;
			}
			default:
				throw error(400, 'Formato inválido. Use: docx, odt, xlsx, ods, pdf');
		}
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : 'Erro desconhecido';
		return json({ error: `Erro ao gerar ${format}: ${msg}` }, { status: 500 });
	}

	return new Response(data as unknown as BodyInit, {
		headers: {
			'Content-Type': contentType,
			'Content-Disposition': `attachment; filename="${filename}.${ext}"`
		}
	});
};
