import { json } from '@sveltejs/kit';
import forge from 'node-forge';
import { getDB, buscarEscala, salvarDocumentoEscala } from '$lib/db';
import { finalizarAssinatura, embedSerproCms, extrairDadosCertificado, normalizarTexto } from '$lib/server/pdf-signing';
import type { RequestEvent } from '@sveltejs/kit';

export const POST = async ({ platform, params, request, locals, getClientAddress }: RequestEvent) => {
	const db = getDB(platform);
	const escalaId = Number(params.id);
	const usuario = locals.usuario;
	const p = platform as App.Platform | undefined;

	if (!usuario) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const escala = await buscarEscala(db, escalaId);
	if (!escala) {
		return json({ error: 'Escala não encontrada' }, { status: 404 });
	}

	const body = await request.json();
	const { preparedPdf, rawSignature, certificateBase64, messageDigest, signingTimeISO, serproCms, signerName, signerCpf, verificationHash, latitude, longitude } = body;

	if (!preparedPdf) {
		return json({ error: 'preparedPdf é obrigatório' }, { status: 400 });
	}

	const filename = `escala_${escala.cidade.toLowerCase().replace(/\s+/g, '_')}_${escala.data_inicio}_assinada.pdf`;

	try {
		const preparedPdfBytes = new Uint8Array(Buffer.from(preparedPdf, 'base64'));

		// Validar Certificado (Token) vs Usuário Logado
		let dadosToken: { nome: string; cpf: string } | null = null;
		if (serproCms) {
			dadosToken = extrairDadosCertificado(serproCms);
		} else if (certificateBase64) {
			const der = forge.util.decode64(certificateBase64);
			const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(der));
			const cn = cert.subject.getField('CN')?.value as string || '';
			const sn = cert.subject.getField('serialNumber')?.value as string || '';
			dadosToken = { 
				nome: cn.split(':')[0].trim(), 
				cpf: sn.replace(/\D/g, '').slice(-11) || cn.split(':').pop()?.replace(/\D/g, '').slice(-11) || ''
			};
		}

		if (dadosToken) {
			const nomeLogado = normalizarTexto(usuario.nome);
			const nomeToken = normalizarTexto(dadosToken.nome);
			const cpfLogado = (usuario as any).cpf || '';
			const cpfToken = dadosToken.cpf;

			if (cpfLogado && cpfToken !== cpfLogado) {
				return json({ error: 'O token não pertence ao usuário logado (CPF incompatível).' }, { status: 400 });
			}
			if (nomeLogado && nomeToken !== nomeLogado) {
				if (!cpfLogado) {
					return json({ error: 'O token não pertence ao usuário logado (Nome incompatível).' }, { status: 400 });
				}
			}
		}

		let signedPdf: Uint8Array;

		if (serproCms) {
			signedPdf = await embedSerproCms(preparedPdfBytes, serproCms);
		} else {
			if (!rawSignature || !certificateBase64 || !messageDigest || !signingTimeISO) {
				return json(
					{ error: 'rawSignature, certificateBase64, messageDigest e signingTimeISO são obrigatórios para o fluxo Web PKI' },
					{ status: 400 }
				);
			}
			signedPdf = await finalizarAssinatura(
				preparedPdfBytes,
				rawSignature,
				certificateBase64,
				messageDigest,
				signingTimeISO
			);
		}

		// Salva o PDF no Cloudflare R2 e registra no banco
		const finalSignerName = dadosToken?.nome || signerName || usuario.nome;
		const finalSignerCpf = dadosToken?.cpf || (usuario as any).cpf || '';

		const env = p?.env as any;
		if (env?.escalas_docs) {
			const mesAno = escala.data_inicio.substring(0, 7);
			const folder = `escalas/${mesAno}/escala_${escalaId}`;
			const r2Key = `${folder}/escala_${escalaId}_${verificationHash}_assinada.pdf`;
			try {
				await env.escalas_docs.put(r2Key, signedPdf);
				await salvarDocumentoEscala(db, escalaId, r2Key, finalSignerName, finalSignerCpf, verificationHash, ip, ua, latitude, longitude);
			} catch (err) {
				console.error('[finalizar-assinatura] Erro ao salvar no R2 ou BD:', err);
			}
		} else {
			console.warn('[finalizar-assinatura] R2 (escalas_docs) não configurado no env.');
		}

		return new Response(signedPdf as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}"`
			}
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Erro ao assinar PDF';
		console.error('[finalizar-assinatura] Erro:', e);
		return json({ error: message }, { status: 500 });
	}
};
