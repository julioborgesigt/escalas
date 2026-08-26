/**
 * POST /api/gise/[id]/presenca/finalizar-assinatura
 *
 * Finaliza a assinatura qualificada (CAdES-LT) do Termo de Presença, persiste a
 * presença (entrada/saída) e registra o termo para
 * `/validar`. Devolve o PDF assinado.
 */

import type { RequestHandler } from './$types';
import {
	getDB,
	buscarGiseEscala,
	salvarEntradaGise,
	salvarSaidaGise,
	salvarTermoPresencaGise,
	resolverParticipacaoGisePolicial,
	sincronizarStatusGiseAposPresencaRelatorios,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { finalizarPresencaSchema } from '$lib/schemas';
import {
	finalizarQualificadaDoPayload,
	respostaPdfAssinado
} from '$lib/server/assinatura/signature-service';
import { tryGetR2 } from '$lib/db';
import { gateDePresenca } from '$lib/server/gise/presenca-gate';
import { invalidarPapelGise } from '$lib/server/gise/papel-cache';
import {
	bucketParaAssinatura,
	compensarBlobAssinado,
	guardarPdfAssinado
} from '$lib/server/assinatura/blob-assinado';
import {
	requireAuth,
	badRequest,
	conflict,
	notFound,
	forbidden,
	serverError,
	validateBody
} from '$lib/server/api';
import {
	consumirIntencaoAssinatura,
	mensagemRecusaIntencao
} from '$lib/server/assinatura/intencao';

export const POST: RequestHandler = async (event) => {
	const { platform, params, locals, request, getClientAddress } = event;
	const p = platform as App.Platform | undefined;
	const db = getDB(p);
	const u = requireAuth(locals);
	if (u instanceof Response) return u;
	if (u.tipo !== 'policial') return forbidden('Apenas policiais confirmam presença.');

	const giseId = parseInt(params.id!);
	if (isNaN(giseId)) return badRequest('Parâmetro inválido');

	const validated = await validateBody(request, finalizarPresencaSchema);
	if (!validated.ok) return validated.response;
	const {
		intencao,
		preparedPdf,
		serproCms,
		messageDigest,
		signingTimeISO,
		latitude,
		longitude,
		assinanteEmail,
		tipo
	} = validated.data;

	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return notFound('Escala GISE');

	// Revalida vínculo (defesa em profundidade — `preparar` já checou).
	const part = await resolverParticipacaoGisePolicial(db, giseId, u.id);
	if (!part.participa) return forbidden('Você não participa desta escala GISE.');

	// Janela de horário e, para saída, entrada já registrada — a MESMA função do
	// `preparar`. O finalizador revalidava só a participação, então quem
	// guardasse um `preparedPdf` assinava saída sem entrada e recebia termo e
	// auditoria de sucesso (FLW-GISE-008). Antes de consumir o token e de gravar
	// byte nenhum: recusar cedo não custa nada.
	const gate = await gateDePresenca(db, { ...part, statusGise: gise.status }, giseId, u.id, tipo);
	if (!gate.ok) return gate.resposta;

	// Consome a preparação: prova que ESTE pdf foi preparado por ESTE usuário
	// para ESTE alvo, uma vez só (FLW-DOC-001). O código público de validação
	// vem daqui, não do corpo da requisição.
	//
	// DEPOIS da permissão, como na escala: o consumo QUEIMA a intenção, e quem
	// saiu da GISE no meio do caminho perderia junto a preparação — teria de
	// refazer a assinatura só para ouvir o 403 que já cabia aqui.
	// ANTES de consumir o token: sem onde guardar o PDF, a assinatura é
	// recusada em vez de virar linha apontando para o vazio (FLW-R2-003).
	const bucketOk = bucketParaAssinatura(tryGetR2(p));
	if (!bucketOk.ok) return bucketOk.resposta;
	const bucket = bucketOk.r2;

	const consumo = await consumirIntencaoAssinatura(
		db,
		intencao,
		{ recurso: 'gise_presenca', recursoId: giseId },
		{ id: u.id, tipo: u.tipo },
		Uint8Array.from(Buffer.from(preparedPdf, 'base64'))
	);
	if (!consumo.ok) return badRequest(mensagemRecusaIntencao());
	const { verificacaoHash: verificationHash } = consumo;

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	try {
		const result = await finalizarQualificadaDoPayload(
			u,
			{ preparedPdf, serproCms, messageDigestHex: messageDigest, signingTimeISO },
			{ platform: p }
		);
		if (!result.ok) return result.response;
		const { arquivoHash: arquivo_hash } = result;

		const [yyyy, mm, dd] = gise.data_inicio.split('-');
		const folder = `gise/${yyyy}-${mm}/${dd}/${giseId}/presencas_termos`;
		const r2Key = `${folder}/termo_${tipo}_pol_${u.id}_${verificationHash}.pdf`;
		const filename = `termo_presenca_${tipo}_gise_${giseId}.pdf`;

		const guardado = await guardarPdfAssinado(bucket, r2Key, result.pdfFinal, 'gise-presenca');
		if (!guardado.ok) return guardado.resposta;

		// Persiste a presença (sem selfie/GPS obrigatórios: a identidade vem do
		// certificado A3).
		if (tipo === 'entrada') {
			const entrada = await salvarEntradaGise(
				db,
				giseId,
				u.id,
				ip,
				ua,
				latitude ?? undefined,
				longitude ?? undefined,
				undefined
			);
			if (!entrada.registrada) {
				await compensarBlobAssinado(db, bucket, [r2Key], 'gise-presenca');
				return conflict('A saída já foi confirmada — a entrada não pode ser refeita.');
			}
		} else {
			const saida = await salvarSaidaGise(
				db,
				giseId,
				u.id,
				ip,
				ua,
				latitude ?? undefined,
				longitude ?? undefined,
				undefined
			);
			// A gravação é quem decide: entre o gate e aqui cabe uma requisição, e
			// `salvarSaidaGise` exige a entrada no próprio `WHERE`. Zero linhas =
			// não houve saída, e o termo não pode ser emitido. O blob já está no
			// bucket, então é compensado.
			if (!saida.registrada) {
				await compensarBlobAssinado(db, bucket, [r2Key], 'gise-presenca');
				return conflict('A saída já foi confirmada, ou não há entrada registrada.');
			}
		}

		// Registra o termo qualificado para /validar.
		const { gravado } = await salvarTermoPresencaGise(
			db,
			{
				gise_id: giseId,
				policial_id: u.id,
				tipo,
				assinante_nome: result.signerName,
				assinante_cpf: result.signerCpf || null,
				assinante_email: assinanteEmail ?? u.email,
				verification_hash: verificationHash,
				r2_key: r2Key,
				arquivo_hash,
				ip_address: ip,
				user_agent: ua,
				latitude: latitude ?? undefined,
				longitude: longitude ?? undefined,
				tipo_carimbo_tempo: result.tipoCarimboTempo,
				cert_issuer: result.metadata.cert_issuer,
				cert_serial: result.metadata.cert_serial,
				cert_valido_de: result.metadata.cert_valido_de,
				cert_valido_ate: result.metadata.cert_valido_ate,
				cms_sha256: result.metadata.cms_sha256,
				ocsp_response_b64: result.metadata.ocsp_response_b64,
				ocsp_consultado_em: result.metadata.ocsp_consultado_em,
				tst_token_b64: result.metadata.tst_token_b64
			},
			platform?.env
		);
		if (!gravado) {
			await compensarBlobAssinado(db, bucket, [r2Key], 'gise-presenca');
			return conflict('Este ato de presença já foi assinado.');
		}

		await sincronizarStatusGiseAposPresencaRelatorios(db, giseId);
		await invalidarPapelGise(u.id);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: tipo === 'entrada' ? 'presenca_gise_entrada' : 'presenca_gise_saida',
				usuario: u,
				entidade: 'gise',
				entidade_id: giseId,
				alvo_tipo: 'policial',
				alvo_id: u.id,
				alvo_nome: u.nome,
				detalhes: `Confirmação de ${tipo} na GISE ${giseId} via certificado digital (qualificada)`,
				metadados: {
					via: 'token_a3',
					verification_hash: verificationHash,
					arquivo_hash,
					tipo_carimbo_tempo: result.tipoCarimboTempo
				},
				...contexto
			},
			{ env }
		);

		return respostaPdfAssinado(result.pdfFinal, filename);
	} catch (err) {
		return serverError(`[gise/presenca/finalizar-assinatura] Falha (gise_id=${giseId})`, err);
	}
};
