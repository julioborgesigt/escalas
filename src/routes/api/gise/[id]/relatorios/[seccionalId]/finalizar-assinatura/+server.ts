/**
 * POST /api/gise/[id]/relatorios/[seccionalId]/finalizar-assinatura
 *
 * Finaliza a assinatura digital (PKCS#7) no PDF do Relatório Extraordinário (GISE).
 * Padronizado com a escala GISE: retorna o PDF assinado como bytes binários.
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import forge from 'node-forge';
import {
	getDB,
	salvarAssinaturaRelatorioGise,
	buscarGiseEscala,
	verificarTodosRelatoriosExtraAssinados,
	atualizarGiseEscala,
	buscarPresencasGise,
	buscarGiseSeccionalMembros
} from '$lib/db';
import { finalizarAssinatura, embedSerproCms, adicionarPaginaAuditoria, extrairDadosCertificado, normalizarTexto, type AuditTrailOptions } from '$lib/server/pdf-signing';
import { getR2 } from '$lib/server/platform';

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
			const nomeLogado = normalizarTexto(u.nome);
			const nomeToken = normalizarTexto(dadosToken.nome);
			const cpfLogado = u.cpf || '';
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

		// 1. Calcular Hash do original (Integridade do conteúdo assinado)
		const originalHashBuffer = await crypto.subtle.digest('SHA-256', signedPdfBytes.slice());
		const documentHash = Array.from(new Uint8Array(originalHashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		const r2 = getR2(p);

		// 2. Coletar Assinaturas dos Policiais (Entradas e Saídas) dessa Seccional para o Manifesto
		const signers: AuditTrailOptions[] = [];
		
		const [membrosSec, todasPresencas] = await Promise.all([
			buscarGiseSeccionalMembros(db, id, secIdNum),
			buscarPresencasGise(db, id)
		]);
		const idsMembros = new Set(membrosSec.map((m: any) => m.policial_id));
		const presencasFiltradas = todasPresencas.filter(p => idsMembros.has(p.policial_id));

		// Fetch all selfies in parallel instead of sequentially
		const selfieKeys: Array<{ key: string; type: 'entrada' | 'saida'; prId: number }> = [];
		for (const pr of presencasFiltradas) {
			if (pr.entrada_rubrica && pr.entrada_selfie_key && r2) {
				selfieKeys.push({ key: pr.entrada_selfie_key, type: 'entrada', prId: pr.id });
			}
			if (pr.saida_rubrica && pr.saida_selfie_key && r2) {
				selfieKeys.push({ key: pr.saida_selfie_key, type: 'saida', prId: pr.id });
			}
		}

		const selfieResults = await Promise.all(
			selfieKeys.map(async ({ key, type, prId }) => {
				try {
					const obj = await r2!.get(key);
					if (obj) {
						const buf = await obj.arrayBuffer();
						return { prId, type, data: `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}` };
					}
				} catch {}
				return { prId, type, data: undefined };
			})
		);

		const selfieMap = new Map<string, string | undefined>();
		for (const r of selfieResults) {
			selfieMap.set(`${r.prId}-${r.type}`, r.data);
		}

		for (const pr of presencasFiltradas) {
			if (pr.entrada_rubrica) {
				signers.push({
					signerName: `${pr.policial_nome} (ENTRADA)`,
					signerCpf: pr.policial_cpf ?? undefined,
					signingTime: new Date(pr.entrada_timestamp || Date.now()),
					verificationHash: `PRES-${pr.id}-E`,
					verificationUrl: `${url.origin}/validar/PRES-${pr.id}-E`,
					ip: pr.ip_address ?? undefined,
					userAgent: pr.user_agent ?? undefined,
					latitude: pr.latitude ?? undefined,
					longitude: pr.longitude ?? undefined,
					rubricBase64: pr.entrada_rubrica ?? undefined,
					selfieBase64: selfieMap.get(`${pr.id}-entrada`),
					documentHash,
					signatureLevel: 'avancada',
					documentName: `Relatório Extraordinário - GISE ${id}`
				});
			}
			if (pr.saida_rubrica) {
				signers.push({
					signerName: `${pr.policial_nome} (SAÍDA)`,
					signerCpf: pr.policial_cpf ?? undefined,
					signingTime: new Date(pr.saida_timestamp || Date.now()),
					verificationHash: `PRES-${pr.id}-S`,
					verificationUrl: `${url.origin}/validar/PRES-${pr.id}-S`,
					ip: pr.ip_address ?? undefined,
					userAgent: pr.user_agent ?? undefined,
					latitude: pr.latitude ?? undefined,
					longitude: pr.longitude ?? undefined,
					rubricBase64: pr.saida_rubrica ?? undefined,
					selfieBase64: selfieMap.get(`${pr.id}-saida`),
					documentHash,
					signatureLevel: 'avancada',
					documentName: `Relatório Extraordinário - GISE ${id}`
				});
			}
		}

		// 3. Adicionar Assinatura do Supervisor
		signers.push({
			signerName: dadosToken?.nome || u.nome,
			signerCpf: dadosToken?.cpf || u.cpf || undefined,
			signingTime: new Date(signingTimeISO),
			verificationHash: verificationHash,
			verificationUrl: `${url.origin}/validar/${verificationHash}`,
			ip: ip ?? undefined,
			userAgent: ua ?? undefined,
			latitude: latitude ?? undefined,
			longitude: longitude ?? undefined,
			documentHash,
			token: crypto.randomUUID(),
			documentName: `Relatório Extraordinário - GISE ${id}`,
			signatureLevel: 'qualificada'
		});

		// 4. Adicionar folhas de auditoria ao PDF final
		const pdfFinal = await adicionarPaginaAuditoria(signedPdfBytes, signers);

		// Hash do arquivo FINAL (com auditoria) para controle
		const hashBuffer = await crypto.subtle.digest('SHA-256', pdfFinal.slice());
		const arquivo_hash = Array.from(new Uint8Array(hashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');
		
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
			assinante_nome: dadosToken?.nome || u.nome,
			assinante_cpf: dadosToken?.cpf || u.cpf || null,
			tipo_assinatura: type,
			rubrica: rubrica,
			verification_hash: verificationHash,
			ip_address: ip,
			user_agent: ua,
			latitude,
			longitude,
			selfie_key: undefined,
			r2_key: r2Key,
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
		return new Response(pdfFinal as unknown as BodyInit, {
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
