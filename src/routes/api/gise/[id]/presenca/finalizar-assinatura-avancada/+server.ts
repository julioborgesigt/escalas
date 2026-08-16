/**
 * FASE 2 da presença avançada por passkey: confere a asserção, sela e grava o
 * termo em `gise_presenca_termos` (o GET do comprovante passa a servir o R2).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarGiseEscala,
	resolverParticipacaoGisePolicial,
	buscarCredencialPorId,
	registrarUsoCredencial,
	registrarAuditComContexto,
	tryGetR2,
	passkeyMetaDeAssercao,
	salvarTermoPresencaGise
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
import { gateDePresenca } from '$lib/server/gise/presenca-gate';
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
import { bucketParaAssinatura, guardarPdfAssinado } from '$lib/server/assinatura/blob-assinado';
import { selarPdfInstitucional } from '$lib/server/assinatura/server-seal';
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
	if (u.tipo !== 'policial') return forbidden('Apenas policiais confirmam presença.');

	const ua = request.headers.get('user-agent') || '';
	const ip = getClientAddress();
	const giseId = parseInt(params.id!);
	if (isNaN(giseId)) return badRequest('ID inválido');

	const tipoParam = url.searchParams.get('tipo');
	const tipo = tipoParam === 'saida' ? 'saida' : tipoParam === 'entrada' ? 'entrada' : null;
	if (!tipo) return badRequest('Informe ?tipo=entrada|saida');

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return notFound('Escala GISE');

	const part = await resolverParticipacaoGisePolicial(db, giseId, u.id);
	if (!part.participa) return forbidden('Você não participa desta escala GISE.');

	const gate = await gateDePresenca(db, { ...part, statusGise: gise.status }, giseId, u.id, tipo);
	if (!gate.ok) return gate.resposta;

	const validated = await validateBody(request, finalizarPasskeyEscalaSchema);
	if (!validated.ok) return validated.response;
	const { intencao, preparedPdf, assercao } = validated.data;
	const pdfBytes = base64ToBytes(preparedPdf);

	const consumo = await consumirIntencaoAssinatura(
		db,
		intencao,
		{ recurso: 'gise_presenca', recursoId: giseId, escopoId: tipo === 'entrada' ? 1 : 2 },
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
	if (!desafio) return serverError('[presenca/finalizar-passkey] hash inválido', new Error('HASH'));

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

		const env = platform?.env as unknown as Record<string, string | undefined> | undefined;
		const selado = await selarPdfInstitucional(pdfBytes, u.nome, { env });
		const pdfParaSalvar = selado.ok ? selado.pdf : pdfBytes;
		const arquivoHash = await calcularHashBuffer(pdfParaSalvar);

		const [yyyy, mm, dd] = gise.data_inicio.split('-');
		const folder = `gise/${yyyy}-${mm}/${dd}/${giseId}/presencas_termos`;
		const r2Key = `${folder}/termo_${tipo}_pol_${u.id}_${consumo.verificacaoHash}.pdf`;

		const guardado = await guardarPdfAssinado(bucketOk.r2, r2Key, pdfParaSalvar, 'gise-presenca');
		if (!guardado.ok) return guardado.resposta;

		await salvarTermoPresencaGise(
			db,
			{
				gise_id: giseId,
				policial_id: u.id,
				tipo,
				assinante_nome: u.nome,
				assinante_cpf: u.cpf,
				assinante_email: u.email,
				verification_hash: consumo.verificacaoHash,
				r2_key: r2Key,
				arquivo_hash: arquivoHash,
				ip_address: ip,
				user_agent: ua,
				latitude: consumo.contexto.latitude ?? undefined,
				longitude: consumo.contexto.longitude ?? undefined,
				passkeyMeta: passkeyMetaDeAssercao(assercao, verificacao.dados.backupAtivo)
			},
			platform?.env
		);

		await registrarAuditComContexto(db, {
			usuario: u,
			acao: tipo === 'entrada' ? 'presenca_gise_entrada' : 'presenca_gise_saida',
			entidade: 'gise',
			entidade_id: giseId,
			detalhes:
				`Presença ${tipo} GISE ${giseId} com passkey — ` +
				`credencial ${descreverVinculoCredencial(verificacao.dados)}`
		});

		return json({ success: true });
	} catch (err) {
		return serverError(`[presenca/finalizar-assinatura-avancada] Falha (gise=${giseId})`, err);
	}
};
