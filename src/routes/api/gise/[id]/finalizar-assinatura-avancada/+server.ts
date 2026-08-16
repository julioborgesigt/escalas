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
	buscarCredencialPorId,
	registrarUsoCredencial,
	registrarAuditComContexto,
	tryGetR2,
	passkeyMetaDeAssercao
} from '$lib/db';
import {
	apiError,
	ErrorCode,
	badRequest,
	notFound,
	forbidden,
	serverError,
	requireAuth,
	validateBody
} from '$lib/server/api';
import { finalizarPasskeyEscalaSchema } from '$lib/schemas';
import { persistirGiseAssinada } from '$lib/server/gise/assinatura-gise';
import {
	consumirIntencaoAssinatura,
	mensagemRecusaIntencao
} from '$lib/server/assinatura/intencao';
import {
	verificarAssercao,
	mensagemRecusaAssercao
} from '$lib/server/assinatura/webauthn/assercao';
import { descreverVinculoCredencial } from '$lib/server/assinatura/webauthn/authenticator-data';
import { credencialDoUsuario } from '$lib/server/auth/credencial';
import { resolverAppOrigin } from '$lib/server/app-origin';
import { bucketParaAssinatura } from '$lib/server/assinatura/blob-assinado';
import { calcularHashBuffer } from '$lib/server/assinatura/document-utils';
import { base64ToBytes, base64UrlToBytes } from '$lib/crypto/bin';
import { hexToBytes } from '$lib/crypto/hex';

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
	const { intencao, preparedPdf, assercao } = validated.data;
	const pdfBytes = base64ToBytes(preparedPdf);

	const consumo = await consumirIntencaoAssinatura(
		db,
		intencao,
		{ recurso: 'gise', recursoId: id },
		{ id: u.id, tipo: u.tipo },
		pdfBytes
	);
	if (!consumo.ok) return badRequest(mensagemRecusaIntencao());

	const credencial = await buscarCredencialPorId(db, assercao.credentialId);
	const dono = credencialDoUsuario(u);
	if (
		!credencial ||
		credencial.revogadaEm ||
		credencial.dono.tipo !== dono.tipo ||
		credencial.dono.id !== dono.id
	) {
		return apiError(
			'Chave de assinatura não reconhecida ou revogada. Registre-a novamente em Meu Perfil.',
			403,
			ErrorCode.FORBIDDEN
		);
	}

	const desafio = hexToBytes(await calcularHashBuffer(pdfBytes));
	if (!desafio) return serverError('[gise/finalizar-passkey] hash inválido', new Error('HASH'));

	const verificacao = await verificarAssercao({
		clientDataJSON: base64UrlToBytes(assercao.clientDataJSON),
		authenticatorData: base64UrlToBytes(assercao.authenticatorData),
		assinatura: base64UrlToBytes(assercao.assinatura),
		publicKeySpki: credencial.publicKeySpki,
		desafioEsperado: desafio,
		origemEsperada: resolverAppOrigin(url, platform),
		contadorArmazenado: credencial.contador
	});
	if (!verificacao.ok) {
		return apiError(mensagemRecusaAssercao(), 403, ErrorCode.FORBIDDEN);
	}

	try {
		const bucketOk = bucketParaAssinatura(tryGetR2(platform));
		if (!bucketOk.ok) return bucketOk.resposta;

		await registrarUsoCredencial(db, credencial.id, verificacao.dados.contador);

		const persistido = await persistirGiseAssinada({
			db,
			r2: bucketOk.r2,
			gise: { id, data_inicio: gise.data_inicio },
			assinante: { id: u.id, nome: u.nome },
			montado: { finalPdf: pdfBytes, verificationHash: consumo.verificacaoHash },
			selfieKey: consumo.contexto.selfieKey,
			ip: ip ?? undefined,
			userAgent: ua,
			latitude: consumo.contexto.latitude,
			longitude: consumo.contexto.longitude,
			env: platform?.env as unknown as Record<string, string | undefined> | undefined,
			passkeyMeta: passkeyMetaDeAssercao(assercao, verificacao.dados.backupAtivo)
		});
		if (!persistido.ok) return persistido.resposta;

		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'assinar_gise',
			entidade: 'gise',
			entidade_id: id,
			detalhes:
				`GISE ${id} assinada com passkey (avançada) por ${u.nome} — ` +
				`credencial ${descreverVinculoCredencial(verificacao.dados)}`
		});

		return json({ success: true });
	} catch (err) {
		return serverError(`[gise/finalizar-assinatura-avancada] Falha (giseId=${id})`, err);
	}
};
