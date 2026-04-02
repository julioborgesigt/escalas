import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	getDB,
	salvarAssinaturaRelatorioGise,
	buscarGiseDetalhado,
	buscarPresencasGise,
	buscarGiseEscala,
	verificarTodosRelatoriosExtraAssinados,
	atualizarGiseEscala
} from '$lib/db';
import { gerarRelatorioExtraordinarioPdf } from '$lib/export';
import { adicionarRodapeSimples, adicionarPaginaAuditoria } from '$lib/server/pdf-signing';

export const POST = async ({ locals, params, request, platform, getClientAddress, url }: RequestEvent) => {
	const u = locals.usuario;
	if (!u || (u.tipo !== 'policial' && u.tipo !== 'admin')) {
		return json({ error: 'Somente policiais supervisores ou administradores podem assinar' }, { status: 403 });
	}

	const { id, seccionalId } = params;
	const body = await request.json().catch(() => ({}));
	const { rubrica, type, hash: inputHash, signerName, signerCpf, latitude, longitude, selfieBase64 } = body;

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const hash = inputHash || Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

	const db = getDB(platform);

	try {
		const giseIdNum = parseInt(id!);
		const secIdNum = parseInt(seccionalId!);

		const gise = await buscarGiseDetalhado(db, giseIdNum);
		if (!gise) return json({ error: 'Escala não encontrada' }, { status: 404 });

		const presencas = await buscarPresencasGise(db, giseIdNum);

		const mockSignature = {
			assinante_nome: signerName || u.nome,
			verification_hash: hash,
			rubrica: rubrica
		};

		const result = await gerarRelatorioExtraordinarioPdf(gise, presencas, secIdNum, url.origin, mockSignature as any);
		let finalPdf = result.pdf;
		const qrUrl = `${url.origin}/validar/${hash}`;

		finalPdf = await adicionarRodapeSimples(finalPdf, mockSignature.assinante_nome, {
			verificationHash: hash,
			verificationUrl: qrUrl
		});

		// Calcular Hash do original (Integridade)
		const originalHashBuffer = await crypto.subtle.digest('SHA-256', finalPdf.slice());
		const documentHash = Array.from(new Uint8Array(originalHashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		// Adicionar folha de auditoria (Manifesto) profissional
		finalPdf = await adicionarPaginaAuditoria(finalPdf, {
			signerName: signerName || u.nome,
			signerCpf: signerCpf || (u as any).cpf,
			signingTime: new Date(),
			verificationHash: hash,
			verificationUrl: qrUrl,
			ip,
			userAgent: ua,
			latitude,
			longitude,
			selfieBase64: selfieBase64,
			rubricBase64: rubrica || undefined,
			documentHash,
			token: crypto.randomUUID(),
			documentName: `Relatório Extraordinário - GISE ${id}`,
			signatureLevel: 'avancada'
		});

		const hashBuffer = await crypto.subtle.digest('SHA-256', finalPdf.slice());
		const arquivo_hash = Array.from(new Uint8Array(hashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		const p = platform as any;
		const r2 = p?.env?.escalas_docs;
		const [yyyy, mm, dd] = (gise as any).data_inicio.split('-');
		const mesAno = `${yyyy}-${mm}`;
		const folder = `gise/${mesAno}/${dd}/${id}/relatorios_extra`;
		const prefixBase = `${folder}/gise_rel_${id}_sec_${seccionalId}_${hash}`;

		let selfieKey: string | undefined = undefined;

		if (r2) {
			await r2.put(`${prefixBase}_assinada.pdf`, finalPdf, { contentType: 'application/pdf' });

			if (selfieBase64) {
				const regex = /^data:image\/(jpeg|png|jpg);base64,/;
				const matches = selfieBase64.match(regex);
				if (matches) {
					const ext = matches[1] === 'png' ? 'png' : 'jpg';
					const dataBase64 = selfieBase64.replace(regex, '');
					const binaryString = atob(dataBase64);
					const bytes = new Uint8Array(binaryString.length);
					for (let i = 0; i < binaryString.length; i++) {
						bytes[i] = binaryString.charCodeAt(i);
					}
					selfieKey = `${prefixBase}_selfie.${ext}`;
					await r2.put(selfieKey, bytes, { httpMetadata: { contentType: `image/${ext}` } });
				}
			}
		}

		await salvarAssinaturaRelatorioGise(db, {
			gise_id: giseIdNum,
			seccional_id: secIdNum,
			tipo: 'extraordinario',
			assinante_id: u.tipo === 'policial' ? u.id : null,
			assinante_nome: signerName || u.nome,
			assinante_cpf: signerCpf || (u as any).cpf || null,
			tipo_assinatura: type || 'simples',
			rubrica: rubrica,
			verification_hash: hash,
			ip_address: ip,
			user_agent: ua,
			latitude,
			longitude,
			selfie_key: selfieKey,
			arquivo_hash: arquivo_hash
		});

		// Transição automática: se todos os relatórios de extra foram assinados → pronta_para_finalizar
		const giseAtual = await buscarGiseEscala(db, giseIdNum);
		if (giseAtual && giseAtual.status === 'aguardando_assinatura_relat') {
			const todosAssinados = await verificarTodosRelatoriosExtraAssinados(db, giseIdNum);
			if (todosAssinados) {
				await atualizarGiseEscala(db, giseIdNum, { status: 'pronta_para_finalizar' });
			}
		}

		return json({ success: true });
	} catch (e: any) {
		console.error(`[GISE-SIGN] Falha ao salvar assinatura: GISE ${id}, Sec ${seccionalId}. Erro:`, e);
		return json({
			error: 'Falha técnica ao gravar a assinatura no banco de dados.'
		}, { status: 500 });
	}
};
