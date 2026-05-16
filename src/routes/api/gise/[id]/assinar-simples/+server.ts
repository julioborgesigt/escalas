/**
 * POST /api/gise/[id]/assinar-simples
 *
 * Assinatura simples (confirmação administrativa) da escala GISE diária.
 * Gera PDF, salva no R2 e muda status para 'assinada'.
 * Permissão: Supervisor designado (DPC) com escala em 'aguardando_assinatura'.
 */

import type { RequestHandler } from './$types';
import {
	contentDisposition,
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	serverError,
	validateBody
} from '$lib/server/api';
import { getDB, buscarGiseEscala, buscarGiseDetalhado, salvarGiseDocumento, atualizarGiseEscala } from '$lib/db';
import { assinarSimplesGiseSchema } from '$lib/schemas';
import { lerFlagsAssinatura } from '$lib/server/cfg-ass-cache';
import { verificarDesafio2FA } from '$lib/auth';
import { gerarPdfGise, toGisePdfData, giseDetalhadoComMatriculaSupervisorSessao } from '$lib/server/export';
import { getBreveRelatorioEnvMergido } from '$lib/server/breve-relatorio-env';
import { adicionarRodapeSimples, adicionarPaginaAuditoria } from '$lib/server/pdf-signing';
import { gerarCodigoValidacao, getNowBR } from '$lib/utils';
import { getR2 } from '$lib/server/platform';

export const POST: RequestHandler = async ({ platform, params, locals, url, request, getClientAddress }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const validated = await validateBody(request, assinarSimplesGiseSchema);
	if (!validated.ok) return validated.response;
	const { rubrica, latitude, longitude, selfieBase64, codigoValidação, desafioId } = validated.data;

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return notFound('Escala GISE');

	if (gise.status !== 'aguardando_assinatura' && gise.status !== 'em_andamento') {
		return badRequest('A escala não está pronta para assinatura');
	}

	if (u.tipo !== 'admin' && gise.supervisor_id !== u.id) {
		return forbidden('Apenas o supervisor designado ou administradores podem assinar');
	}

	try {
		const giseDetalhado = await buscarGiseDetalhado(db, id);
		if (!giseDetalhado) {
			return serverError('[gise/assinar-simples] buscarGiseDetalhado retornou null', new Error('GISE_DETALHADO_NULL'));
		}

		// CRÍTICO: revalidar TODAS as flags de evidência no servidor.
		// Não confie no cliente — o estado de cookies/UI pode ter sido manipulado.
		const flags = await lerFlagsAssinatura(platform);

		if (flags.exigirFotoAssinatura && (!selfieBase64 || typeof selfieBase64 !== 'string')) {
			return badRequest('Selfie é obrigatória para esta assinatura.');
		}
		if (flags.exigirGpsAssinatura && (typeof latitude !== 'number' || typeof longitude !== 'number')) {
			return badRequest('Coordenadas GPS são obrigatórias para esta assinatura.');
		}
		if (flags.exigirCodigoEmailAssinatura) {
			if (!codigoValidação || typeof codigoValidação !== 'string' || !desafioId || typeof desafioId !== 'string') {
				return badRequest('Código de verificação por e-mail é obrigatório para assinaturas em tela.');
			}
			const result2FA = await verificarDesafio2FA(db, desafioId, codigoValidação, ['assinatura']);
			if (result2FA === 'expirado') return badRequest('O código de verificação expirou.');
			if (result2FA === 'esgotado') return badRequest('Muitas tentativas. Solicite um novo código.');
			if (!result2FA) return badRequest('Código de verificação inválido.');
			if (result2FA.usuarioId !== u.id) return forbidden('Código não pertence ao usuário logado.');
		}

		const r2Logo = getR2(platform);
		let logoJpgBytes: Uint8Array | undefined;
		if (r2Logo) {
			try {
				const logoObj = await r2Logo.get('assets/logo_gise.jpg');
				if (logoObj) logoJpgBytes = new Uint8Array(await logoObj.arrayBuffer());
			} catch (e) { /* logo optional */ }
		}
		const gisePdf = giseDetalhadoComMatriculaSupervisorSessao(giseDetalhado, u);
		const brEnv = await getBreveRelatorioEnvMergido(db);
		const result = await gerarPdfGise(
			toGisePdfData(gisePdf, brEnv),
			logoJpgBytes
		);
		const pdfBytes = result.pdf;
		const sigY = result.finalY;

		const verificationHash = gerarCodigoValidacao();
		const verificationUrl = `${url.origin}/validar/${verificationHash}`;

		const rubW_pts = 130;
		const rx_pts = (222.75 * 2.8346) - (rubW_pts / 2);
		const ry_pts = (210 - sigY + 2) * 2.8346;

		const pdfComRodape = await adicionarRodapeSimples(
			pdfBytes,
			u.nome,
			{
				verificationHash,
				verificationUrl,
				rubricBase64: rubrica || undefined,
				customRubricX: rx_pts,
				customRubricY: ry_pts,
				ip,
				latitude,
				longitude
			}
		);

		// Calcular Hash do original (Integridade)
		const originalHashBuffer = await crypto.subtle.digest('SHA-256', pdfComRodape.slice());
		const documentHash = Array.from(new Uint8Array(originalHashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		// Adicionar folha de auditoria (Manifesto) profissional
		const pdfFinal = await adicionarPaginaAuditoria(pdfComRodape, {
			signerName: u.nome,
			signerCpf: u.cpf ?? undefined,
			signingTime: getNowBR(),
			verificationHash,
			verificationUrl: `${url.origin}/validar/${verificationHash}`,
			ip,
			userAgent: ua,
			latitude,
			longitude,
			selfieBase64: selfieBase64,
			rubricBase64: rubrica || undefined,
			documentHash,
			token: crypto.randomUUID(),
			documentName: `Escala de Serviço GISE - ${gise.data_inicio}`,
			signatureLevel: 'avancada'
		});

		const hashBuffer = await crypto.subtle.digest('SHA-256', pdfFinal.slice());
		const arquivo_hash = Array.from(new Uint8Array(hashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		const r2 = getR2(platform);
		const [yyyy, mm, dd] = gise.data_inicio.split('-');
		const mesAno = `${yyyy}-${mm}`;
		const folder = `gise/${mesAno}/${dd}/${id}/escala`;
		const prefixBase = `${folder}/gise_${id}_${verificationHash}`;

		const documentKey = `${prefixBase}_assinada.pdf`;
		let selfieKey: string | undefined = undefined;

		if (r2) {
			const r2Promises: Promise<any>[] = [r2.put(documentKey, pdfFinal, { contentType: 'application/pdf' })];

			if (selfieBase64) {
				const regex = /^data:image\/(jpeg|png|jpg);base64,/;
				const matches = selfieBase64.match(regex);
				if (matches) {
					const ext = matches[1] === 'png' ? 'png' : 'jpg';
					const dataBase64 = selfieBase64.replace(regex, '');
					const bytes = Buffer.from(dataBase64, 'base64');
					selfieKey = `${prefixBase}_selfie.${ext}`;
					r2Promises.push(r2.put(selfieKey, bytes, { httpMetadata: { contentType: `image/${ext}` } }));
				}
			}

			await Promise.all(r2Promises);
		}

		await Promise.all([
			salvarGiseDocumento(db, id, documentKey, u.id, u.nome, '', verificationHash, rubrica, ip, ua, latitude, longitude, selfieKey, arquivo_hash),
			atualizarGiseEscala(db, id, { status: 'em_andamento' })
		]);

		const filename = `gise_${gise.data_inicio}_confirmada.pdf`;
		return new Response(pdfFinal as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': contentDisposition(filename)
			}
		});
	} catch (e) {
		return serverError(`[gise/assinar-simples] Falha (giseId=${id})`, e);
	}
};
