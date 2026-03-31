/**
 * POST /api/gise/[id]/relatorios/[seccionalId]/[dia]/finalizar-assinatura
 *
 * Finaliza a assinatura digital (PKCS#7) no PDF do Relatório Extraordinário (GISE).
 * Salva o documento no R2 e registra no banco de dados.
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDB, salvarAssinaturaRelatorioGise } from '$lib/db';
import { finalizarAssinatura, embedSerproCms } from '$lib/server/pdf-signing';

export const POST = async ({ platform, params, locals, request, getClientAddress }: RequestEvent) => {
	const p = platform as App.Platform | undefined;
	const db = getDB(p);
	const u = locals.usuario;
	if (!u || (u.tipo !== 'policial' && u.tipo !== 'admin')) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	const secIdNum = parseInt(params.seccionalId!);
	const dia = params.dia!;
	
	if (isNaN(id) || isNaN(secIdNum) || !['sabado', 'domingo'].includes(dia)) {
		return json({ error: 'Parâmetros inválidos' }, { status: 400 });
	}

	const payload = await request.json().catch(() => ({}));
	const {
		preparedPdf,
		rawSignature,
		serproCms,
		certificateBase64,
		messageDigest,
		signingTimeISO,
		signerName,
		signerCpf,
		verificationHash,
		latitude,
		longitude,
		rubrica
	} = payload;

	try {
		// Finalizar o PDF (assinado)
		const pdfBytesInput = new Uint8Array(Object.values(preparedPdf));
		let signedPdfBytes: Uint8Array;
		let type: 'webpki' | 'serpro' = 'webpki';

		if (serproCms) {
			type = 'serpro';
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

		// Calcular Hash SHA-256 do arquivo final
		const hashBuffer = await crypto.subtle.digest('SHA-256', signedPdfBytes.slice());
		const arquivo_hash = Array.from(new Uint8Array(hashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		// Salvar PDF no R2
		const r2 = (p as any)?.env?.escalas_docs;
		const dateObj = new Date();
		const mesAno = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
		const folder = `gise/${mesAno}/escala_${id}`;
		const prefixBase = `${folder}/gise_rel_${id}_sec_${secIdNum}_${dia}_${verificationHash}`;
		
		if (r2) {
			await r2.put(`${prefixBase}_assinada.pdf`, signedPdfBytes, { contentType: 'application/pdf' });
		}

		// Registrar no DB
		await salvarAssinaturaRelatorioGise(db, {
			gise_id: id,
			seccional_id: secIdNum,
			dia: dia as 'sabado' | 'domingo',
			tipo: 'extraordinario',
			assinante_id: u.tipo === 'policial' ? u.id : null,
			assinante_nome: signerName || u.nome,
			assinante_cpf: signerCpf || (u as any)?.cpf || null,
			tipo_assinatura: type,
			rubrica: rubrica,
			verification_hash: verificationHash,
			ip_address: ip,
			user_agent: ua,
			latitude,
			longitude,
			selfie_key: undefined, // Digital signature does not require selfie
			arquivo_hash: arquivo_hash
		});

		return json({ success: true });
	} catch (err: any) {
		console.error(`[GISE-SIGN] Falha ao finalizar PKI - GISE ${id}, Sec ${secIdNum}:`, err);
		return json({ error: err.message }, { status: 500 });
	}
};
