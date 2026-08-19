/**
 * FASE 2 da assinatura avançada por passkey do relatório extraordinário:
 * confere a asserção contra a intenção emitida na fase 1, sela e persiste.
 *
 * **Reconfere os portões da fase 1 em vez de confiar na intenção** — papel,
 * seccional válida e saída completa de todos. A intenção prova QUE aquele PDF
 * foi preparado por aquele usuário; não prova que o mundo continua o mesmo. Um
 * participante que perdeu a rubrica entre as duas fases tem de reprovar aqui.
 *
 * `conferirFinalizacaoPasskey` é o portão criptográfico e mora em
 * `webauthn/finalizar-avancada` porque os quatro fluxos avançados (escala,
 * GISE, extra, presença) usam a MESMA prova — foi extraído justamente para não
 * haver uma quarta cópia divergindo.
 *
 * **Contradição registrada, não resolvida aqui: `u.tipo === 'admin'` passa no
 * portão, e a TELA nunca oferece isso.** O `load` de `gise/[id]` define
 * `isSupervisor = u.tipo === 'policial' ? … : false`, então para um Admin Geral
 * ele é sempre falso; e os dois pontos de entrada da assinatura do extra estão
 * atrás dele — `SupervisaoDocExtra` (`{#if quadro.isSupervisor && …}`) e
 * `SeccionalRelatoriosDownloads` (`{#if isSupervisor && !assRel && …}`). O lote
 * (`GiseLoteAssinaturas`) chega a ser RENDERIZADO para o admin, mas recebe
 * `podeAssinar={isSupervisor}` e esconde os botões de assinar. O que o admin
 * alcança é "Conferência": baixar, não assinar.
 *
 * É a mesma forma que o portão da ESCALA GISE teve removida em ago/2026 — lá as
 * quatro rotas que aceitavam admin "liberavam por POST direto exatamente o que a
 * tela nunca ofereceu" (`CLAUDE.md`, §Duplicação). A família do relatório
 * extraordinário não foi junto. As TRÊS rotas de extra concordam entre si
 * (`assinar`, `preparar-…` e `finalizar-…`), então isto é decisão antiga, não
 * drift: apertar é escolha do responsável, porque fecha uma válvula de
 * operação que ninguém documentou e muda a mensagem que
 * `relatorio-extra-gise.spec.ts` afirma.
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
