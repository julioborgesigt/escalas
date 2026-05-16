import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarEscala, listarPoliciaisEscala, salvarDocumentoEscala, registrarAuditComContexto, getR2, hasR2 } from '$lib/db';
import { assinarSimplesEscalasSchema } from '$lib/schemas';
import {
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	serverError,
	validateBody
} from '$lib/server/api';
import { lerFlagsAssinatura } from '$lib/server/cfg-ass-cache';
import { gerarPdf, gerarPdfPlantao, gerarPdfExpediente } from '$lib/server/export';
import { prepararPdfParaAssinatura, adicionarPaginaAuditoria } from '$lib/server/pdf-signing';
import { gerarCodigoValidacao } from '$lib/utils';
import { PDFDocument } from 'pdf-lib';
import { verificarPermissaoEscala } from '$lib/server/escala-permissao';

export const POST: RequestHandler = async ({ platform, params, locals, url, request, getClientAddress }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const validated = await validateBody(request, assinarSimplesEscalasSchema);
	if (!validated.ok) return validated.response;
	const { rubrica, latitude, longitude } = validated.data;

	// CRÍTICO: revalidar flags de evidência no servidor — nunca confie no cliente.
	const flags = await lerFlagsAssinatura(platform);
	if (flags.exigirGpsAssinatura && (typeof latitude !== 'number' || typeof longitude !== 'number')) {
		return badRequest('Coordenadas GPS são obrigatórias para esta assinatura.');
	}
	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return notFound('Escala');

	// Somente admin, dono da lotação, ou DPC admin com solicitação direcionada pode assinar
	const perm = await verificarPermissaoEscala(db, id, escala.lotacao, u);
	if (!perm.permitido) return forbidden(perm.motivo ?? 'Sem permissão para assinar esta escala');

	const policiais = await listarPoliciaisEscala(db, id);
	if (!policiais || policiais.length === 0) {
		return badRequest('A escala está vazia e não pode ser assinada');
	}

	try {
		let result;
		if (escala.tipo === 'plantao') result = await Promise.resolve(gerarPdfPlantao(escala, policiais));
		else if (escala.tipo === 'expediente') result = await Promise.resolve(gerarPdfExpediente(escala, policiais));
		else result = await Promise.resolve(gerarPdf(escala, policiais));

		const pdfBytes = result.pdf;
		const sigY = result.finalY;

		const verificationHash = gerarCodigoValidacao();
		const verificationUrl = `${url.origin}/validar/${verificationHash}`;

		const finalSignerName = u.nome;
		const finalSignerCpf = u.cpf || '';

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

		// Diferente da digital, aqui já temos a rubrica, então embutimos tudo e salvamos
		const finalPdf = prepResult.preparedPdf;

		// Upload para R2
		if (!hasR2(platform)) {
			return serverError('[assinar-simples] R2 não configurado', new Error('R2_NOT_CONFIGURED'));
		}

		const bucket = getR2(platform);
		const r2Key = `escalas/${new Date().getFullYear()}/${id}_${verificationHash}.pdf`;
		await bucket.put(r2Key, finalPdf, {
			httpMetadata: { contentType: 'application/pdf' }
		});

		// Salvar no BD
		await salvarDocumentoEscala(
			db,
			id,
			r2Key,
			finalSignerName,
			finalSignerCpf || undefined,
			verificationHash,
			ip ?? undefined,
			ua || undefined,
			latitude ?? undefined,
			longitude ?? undefined
		);

		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'assinar_escala',
			entidade: 'escala',
			entidade_id: id,
			detalhes: `Escala ${id} assinada via rubrica por ${finalSignerName}`
		});

		return json({ success: true, message: 'Escala assinada manualmente com sucesso' });
	} catch (err) {
		return serverError(`[assinar-simples] Falha ao processar assinatura (escala_id=${id})`, err);
	}
};
