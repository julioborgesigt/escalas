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
 * Só o supervisor DESIGNADO — o porquê da remoção do Admin Geral está por
 * extenso no cabeçalho de `preparar-assinatura-avancada`, que é onde o
 * documento é montado.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { carregarRelatorioExtraParaAssinatura } from '$lib/server/gise/permissao';
import { getDB, registrarUsoCredencial, registrarAuditComContexto, tryGetR2 } from '$lib/db';
import { serverError, requireAuth, validateBody } from '$lib/server/api';
import { finalizarPasskeyEscalaSchema } from '$lib/schemas';
import { persistirExtraAssinado, chaveDocumentoExtra } from '$lib/server/gise/assinatura-extra';
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

	const ua = request.headers.get('user-agent') || '';
	const ip = getClientAddress();
	const db = getDB(platform);
	const portao = await carregarRelatorioExtraParaAssinatura(db, params, u);
	if (portao.recusa) return portao.recusa;
	const { gise, giseId: giseIdNum, secId: secIdNum } = portao;

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
