import { json, error } from '@sveltejs/kit';
import { getDB, buscarEscala, listarPoliciaisEscala } from '$lib/db';
import { gerarPdf, gerarPdfPlantao, gerarPdfExpediente } from '$lib/export';
import { prepararPdfParaAssinatura } from '$lib/server/pdf-signing';
import { gerarCodigoValidacao } from '$lib/utils';
import type { RequestEvent } from '@sveltejs/kit';

export const POST = async ({ platform, params, request, locals, url }: RequestEvent) => {
	const db = getDB(platform);
	const escalaId = Number(params.id);
	if (isNaN(escalaId)) return json({ error: 'ID inválido' }, { status: 400 });
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
	const result = escala.tipo === 'expediente'
		? gerarPdfExpediente(escala, policiais)
		: escala.tipo === 'plantao'
			? gerarPdfPlantao(escala, policiais)
			: gerarPdf(escala, policiais);

	const pdfBytes = result.pdf;
	const finalYmm = result.finalY;

	// Alinhamento conforme o PDF (Plantão = right (centro da direita), outros = center)
	const isPlantao = escala.tipo === 'plantao';

	// Gerar código de verificação para impressão
	const verificationHash = gerarCodigoValidacao();
	const verificationUrl = `${url.origin}/validar/${verificationHash}`;

	// Converter Y de mm (jspdf) para points (pdf-lib) e compensar a altura do carimbo
	// A4 = 210mm = 595.28 points. 1mm = 2.8346 points.
	// O Y do jspdf é do topo. O Y do pdf-lib é da base.
	// Queremos o carimbo um pouco acima da linha de assinatura (finalYmm).
	const boxY = (210 - finalYmm) * 2.8346 + 1.5;

	// Preparar o PDF com placeholder de assinatura e calcular hash dos SignedAttributes
	const { preparedPdf, signedAttrsHashHex, messageDigest, signingTimeISO, dataToSignBase64 } =
		await prepararPdfParaAssinatura(pdfBytes, signerName, signerCpf, 'right', verificationHash, verificationUrl, boxY);



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
