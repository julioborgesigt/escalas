/**
 * POST /api/gise/[id]/relatorios/[seccionalId]/finalizar-assinatura
 *
 * Finaliza a assinatura digital (PKCS#7) no PDF do Relatório Extraordinário (GISE).
 * Padronizado com a escala GISE: retorna o PDF assinado como bytes binários.
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	getDB,
	salvarAssinaturaRelatorioGise,
	buscarGiseEscala,
	verificarTodosRelatoriosExtraAssinados,
	atualizarGiseEscala
} from '$lib/db';
import { finalizarAssinatura, embedSerproCms, adicionarPaginaAuditoria } from '$lib/server/pdf-signing';

export const POST = async ({ platform, params, locals, request, getClientAddress, url }: RequestEvent) => {
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

	if (isNaN(id) || isNaN(secIdNum)) {
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
		const pdfBytesInput = new Uint8Array(Buffer.from(preparedPdf, 'base64'));
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

		// Calcular Hash do original (Integridade)
		const originalHashBuffer = await crypto.subtle.digest('SHA-256', signedPdfBytes.slice());
		const documentHash = Array.from(new Uint8Array(originalHashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		// Adicionar folha de auditoria (Manifesto)
		const pdfFinal = await adicionarPaginaAuditoria(signedPdfBytes, {
			signerName: signerName && signerName.trim() ? signerName : u.nome,
			signerCpf: signerCpf && signerCpf.trim() ? signerCpf : (u as any)?.cpf || '',
			signingTime: new Date(signingTimeISO),
			verificationHash: verificationHash,
			verificationUrl: `${url.origin}/validar/${verificationHash}`,
			ip,
			userAgent: ua,
			latitude,
			longitude,
			documentHash,
			token: crypto.randomUUID(),
			documentName: `Relatório Extraordinário - GISE ${id}`,
			signatureLevel: 'qualificada'
		});

		const hashBuffer = await crypto.subtle.digest('SHA-256', signedPdfBytes.slice());
		const arquivo_hash = Array.from(new Uint8Array(hashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		const r2 = (p as any)?.env?.escalas_docs;
		
		const gise = await buscarGiseEscala(db, id);
		if (!gise) return json({ error: 'GISE não encontrada' }, { status: 404 });
		const [yyyy, mm, dd_escala] = gise.data_inicio.split('-');
		const mesAno = `${yyyy}-${mm}`;
		const folder = `gise/${mesAno}/${dd_escala}/${id}/relatorios_extra`;

		const r2Key = `${folder}/gise_rel_${id}_sec_${secIdNum}_${verificationHash}_assinada.pdf`;
		const filename = `relatorio_extraordinario_gise_${id}_sec_${secIdNum}.pdf`;

		if (r2) {
			await r2.put(r2Key, pdfFinal, { contentType: 'application/pdf' });
		}

		await salvarAssinaturaRelatorioGise(db, {
			gise_id: id,
			seccional_id: secIdNum,
			tipo: 'extraordinario',
			assinante_id: u.tipo === 'policial' ? u.id : null,
			assinante_nome: signerName && signerName.trim() ? signerName : u.nome,
			assinante_cpf: signerCpf && signerCpf.trim() ? signerCpf : (u as any)?.cpf || null,
			tipo_assinatura: type,
			rubrica: rubrica,
			verification_hash: verificationHash,
			ip_address: ip,
			user_agent: ua,
			latitude,
			longitude,
			selfie_key: undefined,
			arquivo_hash: arquivo_hash
		});

		// Transição automática: se todos os relatórios de extra foram assinados → pronta_para_finalizar
		if (gise && gise.status === 'aguardando_assinatura_relat') {
			const todosAssinados = await verificarTodosRelatoriosExtraAssinados(db, id);
			if (todosAssinados) {
				await atualizarGiseEscala(db, id, { status: 'pronta_para_finalizar' });
			}
		}

		// Retorna o PDF assinado como bytes binários — igual à escala GISE
		return new Response(pdfFinal as any, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}"`
			}
		});
	} catch (err: any) {
		console.error(`[GISE-SIGN] Falha ao finalizar PKI - GISE ${id}, Sec ${secIdNum}:`, err);
		return json({ error: err.message }, { status: 500 });
	}
};
