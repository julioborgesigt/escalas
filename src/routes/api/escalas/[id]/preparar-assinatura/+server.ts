import { json, error } from '@sveltejs/kit';
import { getDB, buscarEscala, listarPoliciaisEscala } from '$lib/db';
import { gerarPdf } from '$lib/export';
import { prepararPdfParaAssinatura } from '$lib/server/pdf-signing';
import type { RequestEvent } from '@sveltejs/kit';

export const POST = async ({ platform, params, request, locals }: RequestEvent) => {
	const db = getDB(platform);
	const escalaId = Number(params.id);
	const usuario = locals.usuario;

	if (!usuario) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const escala = await buscarEscala(db, escalaId);
	if (!escala) throw error(404, 'Escala não encontrada');

	// Policial só pode assinar escalas da sua lotação
	if (usuario.tipo === 'policial' && escala.lotacao !== usuario.lotacao) {
		throw error(403, 'Sem permissão');
	}

	const policiais = await listarPoliciaisEscala(db, escala.id);
	if (policiais.length === 0) {
		return json({ error: 'Escala sem policiais cadastrados' }, { status: 400 });
	}

	// Dados do certificado enviados pelo client
	const body = await request.json().catch(() => ({}));
	const signerName = (body as { signerName?: string }).signerName || usuario.nome;
	const signerCpf = (body as { signerCpf?: string }).signerCpf || '';

	// Gerar o PDF da escala
	const pdfBytes = gerarPdf(escala, policiais);

	// Preparar o PDF com placeholder de assinatura e calcular hash
	const { preparedPdf, hashHex } = await prepararPdfParaAssinatura(
		pdfBytes,
		signerName,
		signerCpf
	);

	// Retornar o PDF preparado (base64) e o hash para o client assinar
	const preparedPdfBase64 = Buffer.from(preparedPdf).toString('base64');

	return json({
		hashHex,
		preparedPdf: preparedPdfBase64
	});
};
