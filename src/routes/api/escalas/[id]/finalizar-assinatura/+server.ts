import { json } from '@sveltejs/kit';
import type { RequestEvent } from './$types';
import { getDB, getR2, hasR2, buscarEscala, salvarDocumentoEscala, registrarAuditComContexto } from '$lib/db';
import { finalizarAssinatura, embedSerproCms, extrairDadosCertificado } from '$lib/server/pdf-signing';

export const POST = async ({ platform, params, locals, request }: RequestEvent) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const { preparedPdf, signature, certificate, serproCms, verificationHash, signingTimeISO, messageDigestHex } = await request.json();

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return json({ error: 'Escala não encontrada' }, { status: 404 });

	try {
		const preparedPdfBytes = Buffer.from(preparedPdf, 'base64');
		let signedPdf: Uint8Array;

		let nomeAssinante = u.nome;
		let cpfAssinante = u.cpf || '';

		if (serproCms) {
			// Assinatura via SERPRO (já vem CMS completo em BER)
			signedPdf = await embedSerproCms(preparedPdfBytes, serproCms);
			const dados = extrairDadosCertificado(serproCms);
			nomeAssinante = dados.nome;
			cpfAssinante = dados.cpf;
		} else {
			// Assinatura via Web PKI (vem raw signature e certificate)
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

		// Upload para R2
		if (!hasR2(platform)) {
			return json({ error: 'Storage R2 não configurado' }, { status: 500 });
		}

		const bucket = getR2(platform);
		const r2Key = `escalas/${new Date().getFullYear()}/${id}_${verificationHash}.pdf`;
		await bucket.put(r2Key, signedPdf, {
			httpMetadata: { contentType: 'application/pdf' }
		});

		// Salvar no BD
		await salvarDocumentoEscala(db, id, {
			r2_key: r2Key,
			assinante_nome: nomeAssinante,
			assinante_cpf: cpfAssinante,
			verificacao_hash: verificationHash
		});

		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'assinar_escala',
			entidade: 'escala',
			entidade_id: id,
			detalhes: `Escala ${id} assinada por ${nomeAssinante} (${cpfAssinante})`
		});

		return json({ success: true, message: 'Escala assinada digitalmente com sucesso' });
	} catch (err: any) {
		console.error('[API/finalizar-assinatura] Erro:', err);
		return json({ error: 'Falha ao processar assinatura final: ' + err.message }, { status: 500 });
	}
};
