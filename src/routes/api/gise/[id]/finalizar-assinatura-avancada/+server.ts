/**
 * FASE 2 da assinatura avançada por passkey da escala GISE.
 *
 * A intenção não substitui a permissão: as mesmas recusas do `preparar` são
 * refeitas aqui. A asserção só é conferida depois de consumir a intenção —
 * senão o cliente escolheria o PDF.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarGiseEscala,
	registrarUsoCredencial,
	registrarAuditComContexto,
	tryGetR2
} from '$lib/db';
import {
	badRequest,
	notFound,
	forbidden,
	serverError,
	requireAuth,
	validateBody
} from '$lib/server/api';
import { finalizarPasskeyEscalaSchema } from '$lib/schemas';
import { persistirGiseAssinada } from '$lib/server/gise/assinatura-gise';
import { descreverVinculoCredencial } from '$lib/server/assinatura/webauthn/authenticator-data';
import {
	conferirFinalizacaoPasskey,
	evidenciasDaProva
} from '$lib/server/assinatura/webauthn/finalizar-avancada';
import { bucketParaAssinatura } from '$lib/server/assinatura/blob-assinado';

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

	const validated = await validateBody(request, finalizarPasskeyEscalaSchema);
	if (!validated.ok) return validated.response;

	const prova = await conferirFinalizacaoPasskey({
		db,
		alvo: { recurso: 'gise', recursoId: id },
		usuario: u,
		corpo: validated.data,
		url,
		platform,
		logTag: 'gise/finalizar-passkey'
	});
	if (!prova.ok) return prova.recusa;
	const { credencial, pdfBytes } = prova;

	try {
		const bucketOk = bucketParaAssinatura(tryGetR2(platform));
		if (!bucketOk.ok) return bucketOk.resposta;

		await registrarUsoCredencial(db, credencial.id, prova.dados.contador);

		const persistido = await persistirGiseAssinada({
			db,
			r2: bucketOk.r2,
			gise: { id, data_inicio: gise.data_inicio },
			assinante: { id: u.id, nome: u.nome },
			montado: { finalPdf: pdfBytes, verificationHash: prova.verificacaoHash },
			...evidenciasDaProva(prova, {
				ip,
				userAgent: ua,
				platform,
				assercao: validated.data.assercao
			})
		});
		if (!persistido.ok) return persistido.resposta;

		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'assinar_gise',
			entidade: 'gise',
			entidade_id: id,
			detalhes:
				`GISE ${id} assinada com passkey (avançada) por ${u.nome} — ` +
				`credencial ${descreverVinculoCredencial(prova.dados)}`
		});

		return json({ success: true });
	} catch (err) {
		return serverError(`[gise/finalizar-assinatura-avancada] Falha (giseId=${id})`, err);
	}
};
