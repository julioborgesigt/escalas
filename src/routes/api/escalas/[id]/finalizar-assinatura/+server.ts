import { json } from '@sveltejs/kit';
import type { RequestEvent } from './$types';
import { logger } from '$lib/server/logger';
import { getDB, getR2, hasR2, buscarEscala, salvarDocumentoEscala, registrarAuditComContexto } from '$lib/db';
import { finalizarAssinatura, embedSerproCms, extrairDadosCertificado } from '$lib/server/pdf-signing';
import { determinarTipoCarimbo } from '$lib/server/document-utils';

export const POST = async ({ platform, params, locals, request, getClientAddress }: RequestEvent) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const {
		preparedPdf,
		signature,
		certificate,
		serproCms,
		serproResponse,
		verificationHash,
		signingTimeISO,
		messageDigestHex,
		documentHash,
		assinanteEmail,
		latitude,
		longitude
	} = await request.json();

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return json({ error: 'Escala não encontrada' }, { status: 404 });

	// Mesma regra do preparar-assinatura: somente admin ou dono da lotação pode finalizar.
	// Sem isto, qualquer usuário autenticado poderia enviar um preparedPdf arbitrário e
	// produzir um documento "assinado" em nome de outra unidade.
	if (u.tipo !== 'admin' && u.lotacao !== escala.lotacao) {
		return json({ error: 'Sem permissão para assinar esta escala' }, { status: 403 });
	}

	try {
		const preparedPdfBytes = Buffer.from(preparedPdf, 'base64');
		let signedPdf: Uint8Array;

		let nomeAssinante = u.nome;
		let cpfAssinante = u.cpf || '';

		if (serproCms) {
			signedPdf = await embedSerproCms(preparedPdfBytes, serproCms);
			const dados = extrairDadosCertificado(serproCms);
			nomeAssinante = dados.nome;
			cpfAssinante = dados.cpf;
		} else {
			signedPdf = await finalizarAssinatura(
				preparedPdfBytes,
				signature,
				certificate,
				messageDigestHex,
				signingTimeISO
			);
			const dados = extrairDadosCertificado(certificate);
			nomeAssinante = dados.nome;
			cpfAssinante = dados.cpf;
		}

		if (!hasR2(platform)) {
			return json({ error: 'Storage R2 não configurado' }, { status: 500 });
		}

		const bucket = getR2(platform);
		const r2Key = `escalas/${new Date().getFullYear()}/${id}_${verificationHash}.pdf`;
		await bucket.put(r2Key, signedPdf, {
			httpMetadata: { contentType: 'application/pdf' }
		});

		const tipoCarimboTempo = determinarTipoCarimbo(serproResponse);

		await salvarDocumentoEscala(
			db,
			id,
			r2Key,
			nomeAssinante,
			cpfAssinante,
			verificationHash,
			ip ?? undefined,
			ua || undefined,
			latitude ?? undefined,
			longitude ?? undefined,
			undefined, // selfieKey
			documentHash ?? undefined,
			assinanteEmail ?? undefined,
			tipoCarimboTempo
		);

		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'assinar_escala',
			entidade: 'escala',
			entidade_id: id,
			detalhes: `Escala ${id} assinada por ${nomeAssinante} (${cpfAssinante})`
		});

		return json({ success: true, message: 'Escala assinada digitalmente com sucesso' });
	} catch (err: any) {
		logger.error('[API/finalizar-assinatura] Erro', { error: err?.message });
		return json({ error: 'Falha ao finalizar assinatura. Tente novamente.' }, { status: 500 });
	}
};
