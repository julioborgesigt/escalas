import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	getR2,
	hasR2,
	buscarEscala,
	listarPoliciaisEscala,
	buscarPolicial,
	buscarDocumentoEscala
} from '$lib/db';
import { prepararAssinaturaSchema } from '$lib/schemas';
import {
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	conflict,
	validateBody
} from '$lib/server/api';
import { gerarPdf, gerarPdfPlantao, gerarPdfExpediente } from '$lib/server/export';
import {
	prepararPdfParaAssinatura,
	adicionarPaginaAuditoria,
	adicionarRodapeUniversal,
	estamparRubricaLimpa
} from '$lib/server/assinatura/pdf-signing';
import { chaveConferencia } from '$lib/server/assinatura/copia-conferencia';
import { calcularHashBuffer } from '$lib/server/assinatura/document-utils';
import { logger } from '$lib/server/logger';
import { PDFDocument } from 'pdf-lib';
import { gerarCodigoValidacao } from '$lib/utils/formato';
import { verificarPermissaoEscala, podeAssinarEscala } from '$lib/server/escalas/permissao';
import { criarIntencaoAssinatura } from '$lib/server/assinatura/intencao';

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
	// `rubrica` do body é ignorada de propósito: a rubrica vem do cadastro do
	// perfil (server-side), não do cliente.
	const { signerName, signerCpf, latitude, longitude } = validated.data;
	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return notFound('Escala');

	// Leitura + quem pode assinar (FLW-AUT-001); documento existente bloqueia novo ciclo (FLW-AUT-004).
	const perm = await verificarPermissaoEscala(db, id, escala.lotacao, u);
	if (!perm.permitido) return forbidden(perm.motivo ?? 'Sem permissão para assinar esta escala');
	if (!podeAssinarEscala(u)) {
		return forbidden('Apenas Admin Geral ou DPC com papel administrativo pode assinar esta escala');
	}
	if (escala.tipo === 'fds') {
		return badRequest(
			'Escala de fim de semana não admite assinatura digital — use o fluxo por e-mail'
		);
	}
	const docExistente = await buscarDocumentoEscala(db, id);
	if (docExistente) {
		return conflict('Revogue a assinatura existente antes de preparar nova assinatura');
	}

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

	// Rubrica + matrícula do SIGNATÁRIO (o próprio usuário logado, cujo token
	// assina — o vínculo CPF token↔usuário é reforçado no finalizar). A rubrica
	// vai no campo de assinatura (estilo 'rubrica'); a matrícula, no rodapé de
	// identidade. Admin sem policial vinculado (ou policial sem rubrica) → campo
	// em branco, espelhando o documento impresso. `rubrica` do body é ignorada:
	// a fonte é o cadastro do perfil (server-side).
	const policialId = u.tipo === 'policial' ? u.id : (u.adminPolicialId ?? null);
	let rubricaAssinatura: string | undefined;
	let matriculaAssinatura = u.matricula;
	if (policialId != null) {
		const pol = await buscarPolicial(db, policialId);
		rubricaAssinatura = pol?.rubrica ?? undefined;
		matriculaAssinatura = matriculaAssinatura ?? pol?.matricula;
	}

	// 1. Hash SHA-256 do PDF original (antes de qualquer modificação visual)
	const documentHash = await calcularHashBuffer(pdfBytes);

	// 2. Rodapé universal em todas as páginas de conteúdo (+ bloco de identidade
	//    com QR na página do campo de assinatura).
	const origDoc = await PDFDocument.load(pdfBytes);
	const contentPageCount = origDoc.getPageCount();

	const pdfComRodape = await adicionarRodapeUniversal(pdfBytes, {
		documentHash,
		verificationUrl,
		verificationHash,
		contentPageCount,
		signerName: finalSignerName,
		signerMatricula: matriculaAssinatura,
		signedAtISO: new Date().toISOString()
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
		tipoCarimoTempo: (platform?.env as unknown as Record<string, string | undefined> | undefined)
			?.TSA_URL
			? 'tsa_externa'
			: 'servidor'
	});

	// contentPageIndex = índice da última página de conteúdo (para posicionar o carimbo PKI)
	const contentPageIndex = contentPageCount - 1;
	// Campo da rubrica logo ACIMA da linha de assinatura (que a escala desenha em
	// sigY). O campo fica à DIREITA e o rodapé de identidade à ESQUERDA, então não
	// há colisão horizontal — não é preciso o piso alto de antes. Piso baixo (40pt)
	// só evita o campo encostar no rodapé fino caso a assinatura fique no extremo pé.
	const boxY_pts = Math.max((pageHeightMm - sigY) * 2.8346 + 3, 40);

	const prepResult = await prepararPdfParaAssinatura(
		pdfWithAudit,
		finalSignerName,
		'right',
		verificationHash,
		verificationUrl,
		boxY_pts,
		rubricaAssinatura,
		undefined,
		undefined,
		contentPageIndex,
		'rubrica'
	);

	const { preparedPdf, signedAttrsHashHex, messageDigest, signingTimeISO, dataToSignBase64 } =
		prepResult;
	const preparedPdfBase64 = Buffer.from(preparedPdf).toString('base64');

	// 4. Cópia de conferência IDÊNTICA, gerada no MESMO momento a partir dos MESMOS
	//    bytes do documento assinado: `pdfComRodape` (base + rodapé universal) +
	//    `estamparRubricaLimpa` (mesma rubrica/geometria do campo assinado), SEM
	//    manifesto forense e SEM placeholder de assinatura. Gravada no R2 sob a chave
	//    plana `conferencia/<hash>.pdf`, que os downloads leem só com o verificationHash.
	//    Best-effort: falha aqui nunca aborta a assinatura.
	if (hasR2(platform)) {
		try {
			const conferenciaPdf = await estamparRubricaLimpa(pdfComRodape, {
				alignment: 'right',
				customBoxY: boxY_pts,
				rubricBase64: rubricaAssinatura,
				targetPageIndex: contentPageIndex
			});
			await getR2(platform).put(chaveConferencia(verificationHash), conferenciaPdf, {
				httpMetadata: { contentType: 'application/pdf' }
			});
		} catch (err) {
			logger.warn('[escalas/preparar-assinatura] Falha ao gerar/gravar cópia de conferência', {
				escala_id: id,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	// Amarra ESTE pdf a ESTA escala, a ESTE usuário e a um único uso: o
	// finalizar não aceita mais um `preparedPdf` qualquer (FLW-DOC-001).
	const intencao = await criarIntencaoAssinatura(
		db,
		{ recurso: 'escala', recursoId: id },
		{ id: u.id, tipo: u.tipo },
		preparedPdf,
		verificationHash
	);

	return json({
		intencao,
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
