/**
 * POST /api/gise/[id]/finalizar-assinatura
 *
 * Finaliza a assinatura digital (PKCS#7) no PDF da GISE.
 * Salva o documento no R2 e registra no banco de dados.
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import forge from 'node-forge';
import { getDB, buscarGiseEscala, salvarGiseDocumento, atualizarGiseEscala } from '$lib/db';
import { finalizarAssinatura, embedSerproCms, adicionarPaginaAuditoria, extrairDadosCertificado, normalizarTexto } from '$lib/server/pdf-signing';

export const POST = async ({ platform, params, locals, request, getClientAddress, url }: RequestEvent) => {
	const p = platform as App.Platform | undefined;
	const db = getDB(p);
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autorizado' }, { status: 401 });

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const { preparedPdf, rawSignature, serproCms, certificateBase64, messageDigest, signingTimeISO, signerName, signerCpf, verificationHash, dia, latitude, longitude } = await request.json();

	try {
		const gise = await buscarGiseEscala(db, id);
		if (!gise) return json({ error: 'GISE não encontrada' }, { status: 404 });

		const diaFinal = dia || 'ambos';

		// Finalizar o PDF (assinado)
		const pdfBytesInput = new Uint8Array(Buffer.from(preparedPdf, 'base64'));
		// Validar Certificado (Token) vs Usuário Logado
		let dadosToken: { nome: string; cpf: string } | null = null;
		if (serproCms) {
			dadosToken = extrairDadosCertificado(serproCms);
		} else if (certificateBase64) {
			// Em caso de PKI antigo (manual)
			const der = forge.util.decode64(certificateBase64);
			const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(der));
			// Simplificado: extrai CN e CPF
			const cn = cert.subject.getField('CN')?.value as string || '';
			const sn = cert.subject.getField('serialNumber')?.value as string || '';
			dadosToken = { 
				nome: cn.split(':')[0].trim(), 
				cpf: sn.replace(/\D/g, '').slice(-11) || cn.split(':').pop()?.replace(/\D/g, '').slice(-11) || ''
			};
		}

		if (dadosToken) {
			const nomeLogado = normalizarTexto(u.nome);
			const nomeToken = normalizarTexto(dadosToken.nome);
			const cpfLogado = (u as any).cpf || '';
			const cpfToken = dadosToken.cpf;

			if (cpfLogado && cpfToken !== cpfLogado) {
				return json({ error: 'O token não pertence ao usuário logado (CPF incompatível).' }, { status: 400 });
			}
			if (nomeLogado && nomeToken !== nomeLogado) {
				// Permite uma margem de manobra se o CPF bater, mas se ambos falharem, bloqueia
				if (!cpfLogado) {
					return json({ error: 'O token não pertence ao usuário logado (Nome incompatível).' }, { status: 400 });
				}
			}
		}

		let signedPdfBytes: Uint8Array;
		if (serproCms) {
			signedPdfBytes = await embedSerproCms(pdfBytesInput, serproCms);
		} else {
			signedPdfBytes = await finalizarAssinatura(
				pdfBytesInput,
				rawSignature,
				certificateBase64,
				messageDigest,
				signingTimeISO
			);
		}

		// Calcular Hash do original (Integridade)
		const originalHashBuffer = await crypto.subtle.digest('SHA-256', signedPdfBytes.slice());
		const documentHash = Array.from(new Uint8Array(originalHashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		// Adicionar folha de auditoria (Manifesto)
		const pdfFinal = await adicionarPaginaAuditoria(signedPdfBytes, {
			signerName: dadosToken?.nome || u.nome,
			signerCpf: dadosToken?.cpf || (u as any)?.cpf || '',
			signingTime: new Date(signingTimeISO),
			verificationHash: verificationHash,
			verificationUrl: `${url.origin}/validar/${verificationHash}`,
			ip,
			userAgent: ua,
			latitude,
			longitude,
			documentHash,
			token: crypto.randomUUID(),
			documentName: `Escala de Serviço GISE - ${gise.data_inicio}`,
			signatureLevel: 'qualificada'
		});

		// Salvar no R2
		const [yyyy, mm, dd_escala] = gise.data_inicio.split('-');
		const mesAno = `${yyyy}-${mm}`;
		const folder = `gise/${mesAno}/${dd_escala}/${id}/escala`;

		const documentKey = `${folder}/gise_${id}_${verificationHash}_assinada.pdf`;
		const env = (p as any)?.env || (p as any);
		if (env?.escalas_docs) {
			await env.escalas_docs.put(documentKey, pdfFinal, {
				contentType: 'application/pdf'
			});
		}

		// Registrar no banco com auditoria
		const finalSignerName = dadosToken?.nome || u.nome;
		const finalSignerCpf = dadosToken?.cpf || (u as any)?.cpf || '';
		await salvarGiseDocumento(
			db,
			id,
			documentKey,
			u.id,
			finalSignerName,
			finalSignerCpf,
			verificationHash,
			undefined,
			ip,
			ua,
			latitude,
			longitude
		);

		// Avançar status para andamento
		await atualizarGiseEscala(db, id, { status: 'em_andamento' });

		return new Response(pdfFinal as any, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${documentKey}"`
			}
		});
	} catch (err: any) {
		console.error('[GISE SIGN]', err);
		return json({ error: err.message }, { status: 500 });
	}
};
