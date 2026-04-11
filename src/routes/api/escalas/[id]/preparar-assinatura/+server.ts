import { json } from '@sveltejs/kit';
import type { RequestEvent } from './$types';
import { getDB, buscarEscala, listarPoliciaisEscala } from '$lib/db';
import { gerarPdf, gerarPdfPlantao, gerarPdfExpediente } from '$lib/export';
import { prepararPdfParaAssinatura, adicionarPaginaAuditoria, adicionarRodapeUniversal } from '$lib/server/pdf-signing';
import { calcularHashBuffer } from '$lib/server/document-utils';
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
	const assinanteEmail = u.email ?? undefined;

	// 1. Hash SHA-256 do PDF original (antes de qualquer modificação visual)
	const documentHash = await calcularHashBuffer(pdfBytes);

	// 2. Rodapé universal em todas as páginas de conteúdo
	const origDoc = await PDFDocument.load(pdfBytes);
	const contentPageCount = origDoc.getPageCount();

	const pdfComRodape = await adicionarRodapeUniversal(pdfBytes, {
		documentHash,
		verificationUrl,
		verificationHash,
		contentPageCount
	});

	// 3. Folha de auditoria ANTES de assinar (preserva validade criptográfica)
	const pdfWithAudit = await adicionarPaginaAuditoria(pdfComRodape, {
		signerName: finalSignerName,
		signerCpf: finalSignerCpf || undefined,
		signerEmail: assinanteEmail,
		signingTime: new Date(),
		verificationHash,
		verificationUrl,
		documentHash,
		ip: ip ?? undefined,
		userAgent: ua || undefined,
		latitude: latitude ?? undefined,
		longitude: longitude ?? undefined,
		token: crypto.randomUUID(),
		documentName: `Escala de Serviço - ${escala.titulo}`,
		signatureLevel: 'qualificada',
		tipoCarimoTempo: 'servidor'
	});

	// contentPageIndex = índice da última página de conteúdo (para posicionar o carimbo PKI)
	const contentPageIndex = contentPageCount - 1;
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
		verificationHash,
		documentHash,
		assinanteEmail
	});
};
