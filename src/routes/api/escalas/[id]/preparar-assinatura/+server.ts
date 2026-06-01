import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarEscala, listarPoliciaisEscala } from '$lib/db';
import { prepararAssinaturaSchema } from '$lib/schemas';
import { requireAuth, badRequest, notFound, forbidden, validateBody } from '$lib/server/api';
import { gerarPdf, gerarPdfPlantao, gerarPdfExpediente } from '$lib/server/export';
import {
	prepararPdfParaAssinatura,
	adicionarPaginaAuditoria,
	adicionarRodapeUniversal
} from '$lib/server/pdf-signing';
import { calcularHashBuffer } from '$lib/server/document-utils';
import { PDFDocument } from 'pdf-lib';
import { gerarCodigoValidacao } from '$lib/utils';
import { verificarPermissaoEscala } from '$lib/server/escala-permissao';

export const POST: RequestHandler = async ({
	platform,
	params,
	locals,
	url,
	request,
	getClientAddress
}) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const validated = await validateBody(request, prepararAssinaturaSchema);
	if (!validated.ok) return validated.response;
	const { signerName, signerCpf, rubrica, latitude, longitude } = validated.data;
	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return notFound('Escala');

	// Somente admin, dono da lotação, ou DPC admin com solicitação direcionada pode preparar assinatura
	const perm = await verificarPermissaoEscala(db, id, escala.lotacao, u);
	if (!perm.permitido) return forbidden(perm.motivo ?? 'Sem permissão para assinar esta escala');

	const policiais = await listarPoliciaisEscala(db, id);
	if (!policiais || policiais.length === 0) {
		return badRequest('A escala está vazia e não pode ser assinada');
	}

	let result;
	if (escala.tipo === 'plantao') result = gerarPdfPlantao(escala, policiais);
	else if (escala.tipo === 'expediente') result = await gerarPdfExpediente(escala, policiais);
	else result = gerarPdf(escala, policiais);

	const pdfBytes = result.pdf;
	const sigY = result.finalY;
	const pageHeightMm = result.pageHeightMm ?? 210;

	const verificationHash = gerarCodigoValidacao();
	const verificationUrl = `${url.origin}/validar/${verificationHash}`;

	const finalSignerName = signerName && signerName.trim() ? signerName : u.nome;
	const finalSignerCpf = signerCpf && signerCpf.trim() ? signerCpf : u.cpf || '';
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
	const boxY_pts = (pageHeightMm - sigY) * 2.8346 + 1.5;

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

	const { preparedPdf, signedAttrsHashHex, messageDigest, signingTimeISO, dataToSignBase64 } =
		prepResult;
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
