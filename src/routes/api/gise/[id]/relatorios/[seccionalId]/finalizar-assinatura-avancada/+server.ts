/**
 * FASE 2 da assinatura avançada por passkey do relatório extraordinário.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarGiseDetalhado,
	registrarUsoCredencial,
	registrarAuditComContexto,
	tryGetR2,
	verificarSaidaCompletaSeccional
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
import { persistirExtraAssinado, chaveDocumentoExtra } from '$lib/server/gise/assinatura-extra';
import {
	giseAutorizaSeccionalRelatorioExtra,
	secIdEhSupervisaoExtra
} from '$lib/server/gise/supervisao-extra';
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

	const prova = await conferirFinalizacaoPasskey({
		db,
		alvo: { recurso: 'gise_relatorio', recursoId: giseIdNum, escopoId: secIdNum },
		usuario: u,
		corpo: validated.data,
		url,
		platform,
		logTag: 'extra/finalizar-passkey'
	});
	if (!prova.ok) return prova.recusa;
	const { credencial, pdfBytes } = prova;

	try {
		const bucketOk = bucketParaAssinatura(tryGetR2(platform));
		if (!bucketOk.ok) return bucketOk.resposta;

		await registrarUsoCredencial(db, credencial.id, prova.dados.contador);

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
				verificationHash: prova.verificacaoHash,
				documentKey: chaveDocumentoExtra(
					{ id: giseIdNum, data_inicio: gise.data_inicio },
					secIdNum,
					prova.verificacaoHash
				)
			},
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
			acao: 'assinar_relatorio_gise',
			entidade: 'gise',
			entidade_id: giseIdNum,
			detalhes:
				`Relatório extra GISE ${giseIdNum} seccional ${secIdNum} assinado com passkey — ` +
				`credencial ${descreverVinculoCredencial(prova.dados)}`
		});

		return json({ success: true });
	} catch (err) {
		return serverError(
			`[extra/finalizar-assinatura-avancada] Falha (gise=${giseIdNum}, sec=${secIdNum})`,
			err
		);
	}
};
