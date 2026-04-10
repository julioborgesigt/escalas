import { json } from '@sveltejs/kit';
import type { RequestEvent } from './$types';
import { getDB, buscarEscala, listarPoliciaisEscala } from '$lib/db';
import { gerarPdf, gerarPdfPlantao, gerarPdfExpediente } from '$lib/export';
import { prepararPdfParaAssinatura, adicionarPaginaAuditoria } from '$lib/server/pdf-signing';
import { PDFDocument } from 'pdf-lib';
import { gerarCodigoValidacao } from '$lib/utils';

export const POST = async ({ platform, params, locals, url, request, getClientAddress }: RequestEvent) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const { signerName, signerCpf, rubrica, latitude, longitude } = await request.json();
	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return json({ error: 'Escala não encontrada' }, { status: 404 });

	// Somente admin ou o dono da lotação pode preparar assinatura
	if (u.tipo !== 'admin' && u.lotacao !== escala.lotacao) {
		return json({ error: 'Sem permissão para assinar esta escala' }, { status: 403 });
	}

	const policiais = await listarPoliciaisEscala(db, id);
	if (!policiais || policiais.length === 0) {
		return json({ error: 'A escala está vazia e não pode ser assinada' }, { status: 400 });
	}

	let result;
	if (escala.tipo === 'plantao') result = gerarPdfPlantao(escala, policiais);
	else if (escala.tipo === 'expediente') result = gerarPdfExpediente(escala, policiais);
	else result = gerarPdf(escala, policiais);

	const pdfBytes = result.pdf;
	const sigY = result.finalY;

	const verificationHash = gerarCodigoValidacao();
	const verificationUrl = `${url.origin}/validar/${verificationHash}`;

	const finalSignerName = signerName && signerName.trim() ? signerName : u.nome;
	const finalSignerCpf = signerCpf && signerCpf.trim() ? signerCpf : (u.cpf || '');

	// Conta páginas do PDF de conteúdo
	const origDoc = await PDFDocument.load(pdfBytes);
	const contentPageIndex = origDoc.getPageCount() - 1;

	// Adicionar folha de auditoria
	const pdfWithAudit = await adicionarPaginaAuditoria(pdfBytes, {
		signerName: finalSignerName,
		signerCpf: finalSignerCpf || undefined,
		signingTime: new Date(),
		verificationHash,
		verificationUrl,
		ip: ip ?? undefined,
		userAgent: ua || undefined,
		latitude: latitude ?? undefined,
		longitude: longitude ?? undefined,
		token: crypto.randomUUID(),
		documentName: `Escala de Serviço - ${escala.titulo}`,
		signatureLevel: 'qualificada'
	});

	const boxY_pts = (210 - sigY) * 2.8346 + 1.5;

	const prepResult = await prepararPdfParaAssinatura(
		pdfWithAudit,
		finalSignerName,
		finalSignerCpf,
		'right',
		verificationHash,
		verificationUrl,
		boxY_pts,
		rubrica || undefined,
		undefined,
		undefined,
		contentPageIndex
	);

	const { preparedPdf, signedAttrsHashHex, messageDigest, signingTimeISO, dataToSignBase64 } = prepResult;
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
