import { json, error } from '@sveltejs/kit';
import { getDB, buscarEscala, listarPoliciaisEscala } from '$lib/db';
import { gerarPdf, gerarPdfPlantao, gerarPdfExpediente } from '$lib/export';
import { prepararPdfParaAssinatura } from '$lib/server/pdf-signing';
import { gerarCodigoValidacao } from '$lib/utils';
import type { RequestEvent } from '@sveltejs/kit';

export const POST = async ({ platform, params, request, locals, url }: RequestEvent) => {
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

	const body = await request.json().catch(() => ({}));
	const signerName = (body as { signerName?: string }).signerName || usuario.nome;
	const signerCpf = (body as { signerCpf?: string }).signerCpf || '';

	// Gerar o PDF da escala
	const pdfBytes = escala.tipo === 'expediente'
		? gerarPdfExpediente(escala, policiais)
		: escala.tipo === 'plantao'
			? gerarPdfPlantao(escala, policiais)
			: gerarPdf(escala, policiais);

	// Alinhamento conforme o PDF (Plantão = right (centro da direita), outros = center)
	const isPlantao = escala.tipo === 'plantao';
	
	// Gerar código de verificação para impressão
	const verificationHash = gerarCodigoValidacao();
	const verificationUrl = `${url.origin}/validar/${verificationHash}`;

	// Preparar o PDF com placeholder de assinatura e calcular hash dos SignedAttributes
	const { preparedPdf, signedAttrsHashHex, messageDigest, signingTimeISO, dataToSignBase64 } =
		await prepararPdfParaAssinatura(pdfBytes, signerName, signerCpf, isPlantao ? 'right' : 'center', verificationHash, verificationUrl);

	const preparedPdfBase64 = Buffer.from(preparedPdf).toString('base64');

	return json({
		signedAttrsHashHex,
		preparedPdf: preparedPdfBase64,
		messageDigest,
		signingTimeISO,
		dataToSignBase64,
		verificationHash
	});
};
