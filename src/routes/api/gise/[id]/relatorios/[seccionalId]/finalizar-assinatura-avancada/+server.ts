/**
 * FASE 2 da assinatura avançada por passkey do relatório extraordinário.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarGiseDetalhado,
	buscarCredencialPorId,
	registrarUsoCredencial,
	registrarAuditComContexto,
	tryGetR2,
	passkeyMetaDeAssercao,
	verificarSaidaCompletaSeccional
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
import { persistirExtraAssinado, chaveDocumentoExtra } from '$lib/server/gise/assinatura-extra';
import {
	giseAutorizaSeccionalRelatorioExtra,
	secIdEhSupervisaoExtra
} from '$lib/server/gise/supervisao-extra';
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
	if (u.tipo !== 'policial' && u.tipo !== 'admin') {
		return forbidden('Somente policiais supervisores ou administradores podem assinar');
	}

	const ua = request.headers.get('user-agent') || '';
	const ip = getClientAddress();
	const giseIdNum = parseInt(params.id!);
	const secIdNum = parseInt(params.seccionalId!);
	if (isNaN(giseIdNum) || isNaN(secIdNum)) return badRequest('ID inválido');

	const db = getDB(platform);
	const gise = await buscarGiseDetalhado(db, giseIdNum);
	if (!gise) return notFound('Escala');
	if (u.tipo !== 'admin' && gise.supervisor_id !== u.id) {
		return forbidden(
			'Apenas o supervisor designado ou administradores podem assinar este relatório.'
		);
	}
	if (!(await giseAutorizaSeccionalRelatorioExtra(db, giseIdNum, secIdNum))) {
		return badRequest('Seccional inválida para esta GISE.');
	}
	const isSupExtraGate = await secIdEhSupervisaoExtra(db, secIdNum);
	if (!(await verificarSaidaCompletaSeccional(db, giseIdNum, secIdNum, isSupExtraGate))) {
		return badRequest(
			'Todos os participantes precisam confirmar a saída (rubrica) antes de assinar o relatório.'
		);
	}

	const validated = await validateBody(request, finalizarPasskeyEscalaSchema);
	if (!validated.ok) return validated.response;
	const { intencao, preparedPdf, assercao } = validated.data;
	const pdfBytes = base64ToBytes(preparedPdf);

	const consumo = await consumirIntencaoAssinatura(
		db,
		intencao,
		{ recurso: 'gise_relatorio', recursoId: giseIdNum, escopoId: secIdNum },
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
	if (!desafio) return serverError('[extra/finalizar-passkey] hash inválido', new Error('HASH'));

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

		const persistido = await persistirExtraAssinado({
			db,
			r2: bucketOk.r2,
			giseId: giseIdNum,
			secId: secIdNum,
			assinante: {
				id: u.tipo === 'policial' ? u.id : null,
				nome: u.nome,
				cpf: u.cpf
			},
			montado: {
				finalPdf: pdfBytes,
				verificationHash: consumo.verificacaoHash,
				documentKey: chaveDocumentoExtra(
					{ id: giseIdNum, data_inicio: gise.data_inicio },
					secIdNum,
					consumo.verificacaoHash
				)
			},
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
			acao: 'assinar_relatorio_gise',
			entidade: 'gise',
			entidade_id: giseIdNum,
			detalhes:
				`Relatório extra GISE ${giseIdNum} seccional ${secIdNum} assinado com passkey — ` +
				`credencial ${descreverVinculoCredencial(verificacao.dados)}`
		});

		return json({ success: true });
	} catch (err) {
		return serverError(
			`[extra/finalizar-assinatura-avancada] Falha (gise=${giseIdNum}, sec=${secIdNum})`,
			err
		);
	}
};
