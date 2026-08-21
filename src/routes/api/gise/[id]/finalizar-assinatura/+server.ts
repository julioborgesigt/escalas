/**
 * POST /api/gise/[id]/finalizar-assinatura
 *
 * Finaliza a assinatura digital (PKCS#7) no PDF da GISE.
 * Salva o documento no R2 e registra no banco de dados.
 */

import type { RequestHandler } from './$types';
import {
	getDB,
	salvarGiseDocumento,
	atualizarGiseEscala,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { finalizarAssinaturaGiseSchema } from '$lib/schemas';
import {
	finalizarQualificadaDoPayload,
	respostaPdfAssinado
} from '$lib/server/assinatura/signature-service';
import { tryGetR2 } from '$lib/db';
import {
	bucketParaAssinatura,
	guardarPdfAssinado,
	compensarBlobAssinado
} from '$lib/server/assinatura/blob-assinado';
import { requireAuth, badRequest, serverError, validateBody, conflict } from '$lib/server/api';
import {
	consumirIntencaoAssinatura,
	mensagemRecusaIntencao
} from '$lib/server/assinatura/intencao';
import { carregarGiseParaAssinatura } from '$lib/server/gise/permissao';

export const POST: RequestHandler = async (event) => {
	const { platform, params, locals, request, getClientAddress } = event;
	const p = platform as App.Platform | undefined;
	const db = getDB(p);
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const validated = await validateBody(request, finalizarAssinaturaGiseSchema);
	if (!validated.ok) return validated.response;
	const {
		intencao,
		preparedPdf,
		serproCms,
		messageDigest,
		signingTimeISO,
		latitude,
		longitude,
		assinanteEmail
	} = validated.data;

	// Esta era a QUINTA cópia do portão, e a única sem a checagem de status —
	// as outras quatro recusam GISE fora de `aguardando_assinatura`/`em_andamento`.
	// Entrar pelo portão fecha a lacuna sem custo: o `preparar` não mexe no
	// status, e este handler move para `em_andamento`, que está no conjunto
	// permitido — então reassinar continua passando.
	const portao = await carregarGiseParaAssinatura(db, params.id, u);
	if (portao.recusa) return portao.recusa;
	const { gise, id } = portao;

	// Consome a preparação: prova que ESTE pdf foi preparado por ESTE usuário
	// para ESTE alvo, uma vez só (FLW-DOC-001). O código público de validação
	// vem daqui, não do corpo da requisição.
	//
	// DEPOIS da permissão, como na escala: o consumo QUEIMA a intenção, e quem
	// perdeu a permissão no meio do caminho perderia junto a preparação — teria
	// de refazer a assinatura só para ouvir o 403 que já cabia aqui.
	// ANTES de consumir o token: sem onde guardar o PDF, a assinatura é
	// recusada em vez de virar linha apontando para o vazio (FLW-R2-003).
	const bucketOk = bucketParaAssinatura(tryGetR2(p));
	if (!bucketOk.ok) return bucketOk.resposta;
	const bucket = bucketOk.r2;

	const consumo = await consumirIntencaoAssinatura(
		db,
		intencao,
		{ recurso: 'gise', recursoId: id },
		{ id: u.id, tipo: u.tipo },
		Uint8Array.from(Buffer.from(preparedPdf, 'base64'))
	);
	if (!consumo.ok) return badRequest(mensagemRecusaIntencao());
	const { verificacaoHash: verificationHash } = consumo;

	try {
		// Delega ao serviço unificado: validação CPF token vs CPF logado
		// (sem bypass), embed do CMS, verificação CAdES-LT, OCSP, PAdES-LT
		// e hash do PDF final.
		const result = await finalizarQualificadaDoPayload(
			u,
			{ preparedPdf, serproCms, messageDigestHex: messageDigest, signingTimeISO },
			{ platform: p }
		);
		if (!result.ok) return result.response;
		const { arquivoHash } = result;

		const [yyyy, mm, dd_escala] = gise.data_inicio.split('-');
		const mesAno = `${yyyy}-${mm}`;
		const folder = `gise/${mesAno}/${dd_escala}/${id}/escala`;

		const documentKey = `${folder}/gise_${id}_${verificationHash}_assinada.pdf`;
		const guardado = await guardarPdfAssinado(bucket, documentKey, result.pdfFinal, 'gise-escala');
		if (!guardado.ok) return guardado.resposta;

		const { gravado } = await salvarGiseDocumento(db, {
			giseId: id,
			r2Key: documentKey,
			assinanteId: u.id,
			assinanteNome: result.signerName,
			assinanteCpf: result.signerCpf,
			verificacaoHash: verificationHash,
			ipAddress: ip,
			userAgent: ua,
			latitude,
			longitude,
			arquivoHash,
			assinanteEmail,
			tipoCarimboTempo: result.tipoCarimboTempo,
			cadesMeta: result.metadata,
			env: platform?.env
		});
		if (!gravado) {
			await compensarBlobAssinado(db, bucket, [documentKey], 'gise-escala');
			return conflict('Revogue a assinatura existente antes de assinar novamente');
		}

		await atualizarGiseEscala(db, id, { status: 'em_andamento' });

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'assinar_gise',
				usuario: u,
				entidade: 'gise',
				entidade_id: id,
				alvo_tipo: 'gise',
				alvo_id: id,
				detalhes: `GISE ${id} assinada com certificado digital (qualificada, ICP-Brasil)`,
				metadados: {
					tipo: 'qualificada',
					verificationHash,
					data_inicio: gise.data_inicio,
					arquivo_hash: arquivoHash,
					tipo_carimbo_tempo: result.tipoCarimboTempo
				},
				...contexto
			},
			{ env }
		);

		return respostaPdfAssinado(result.pdfFinal, documentKey);
	} catch (err) {
		return serverError(`[gise/finalizar-assinatura] Falha (giseId=${id})`, err);
	}
};
