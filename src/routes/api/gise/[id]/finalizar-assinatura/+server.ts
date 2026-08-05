/**
 * POST /api/gise/[id]/finalizar-assinatura
 *
 * Finaliza a assinatura digital (PKCS#7) no PDF da GISE.
 * Salva o documento no R2 e registra no banco de dados.
 */

import type { RequestHandler } from './$types';
import {
	getDB,
	buscarGiseEscala,
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
import { bucketParaAssinatura, guardarPdfAssinado } from '$lib/server/assinatura/blob-assinado';
import {
	requireAuth,
	badRequest,
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

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

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

	const gise = await buscarGiseEscala(db, id);
	if (!gise) return notFound('GISE');

	// Permissão de negócio: apenas supervisor designado ou admin.
	if (u.tipo !== 'admin' && gise.supervisor_id !== u.id) {
		return forbidden(
			'Apenas o supervisor designado ou administradores podem finalizar esta escala'
		);
	}

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

		await salvarGiseDocumento(
			db,
			id,
			documentKey,
			u.id,
			result.signerName,
			result.signerCpf,
			verificationHash,
			undefined,
			ip,
			ua,
			latitude,
			longitude,
			undefined, // selfieKey
			arquivoHash,
			assinanteEmail,
			result.tipoCarimboTempo,
			result.metadata,
			platform?.env
		);

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
