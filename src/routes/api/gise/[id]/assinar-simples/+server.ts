/**
 * POST /api/gise/[id]/assinar-simples
 *
 * Assinatura simples (confirmação administrativa) da escala GISE diária.
 * Gera PDF, salva no R2 e muda status para 'assinada'.
 * Permissão: Supervisor designado (DPC) com escala em 'aguardando_assinatura'.
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDB, buscarGiseEscala, buscarGiseDetalhado, salvarGiseDocumento, atualizarGiseEscala, buscarExigirCodigoEmailAssinatura } from '$lib/db';
import { verificarDesafio2FA } from '$lib/auth';
import { gerarPdfGise } from '$lib/export';
import { adicionarRodapeSimples, adicionarPaginaAuditoria } from '$lib/server/pdf-signing';
import { gerarCodigoValidacao, getNowBR } from '$lib/utils';
import { getR2 } from '$lib/server/platform';

export const POST = async ({ platform, params, locals, url, request, getClientAddress }: RequestEvent) => {
	const { rubrica, latitude, longitude, selfieBase64, codigoValidação, desafioId } = await request.json().catch(() => ({} as Record<string, unknown>));
	const u = locals.usuario;
	if (!u) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	if (gise.status !== 'aguardando_assinatura' && gise.status !== 'em_andamento') {
		return json({ error: 'A escala não está pronta para assinatura' }, { status: 400 });
	}

	if (u.tipo !== 'admin' && gise.supervisor_id !== u.id) {
		return json({ error: 'Apenas o supervisor designado ou administradores podem assinar' }, { status: 403 });
	}

	try {
		const giseDetalhado = await buscarGiseDetalhado(db, id);
		if (!giseDetalhado) return json({ error: 'Erro ao carregar dados da escala' }, { status: 500 });

		const exigirCodigoEmail = await buscarExigirCodigoEmailAssinatura(db);
		if (exigirCodigoEmail) {
			if (!codigoValidação || typeof codigoValidação !== 'string' || !desafioId || typeof desafioId !== 'string') {
				return json({ error: 'Código de verificação por e-mail é obrigatório para assinaturas em tela.' }, { status: 400 });
			}
			const result2FA = await verificarDesafio2FA(db, desafioId, codigoValidação);
			if (result2FA === 'expirado') return json({ error: 'O código de verificação expirou.' }, { status: 400 });
			if (result2FA === 'esgotado') return json({ error: 'Muitas tentativas. Solicite um novo código.' }, { status: 400 });
			if (!result2FA) return json({ error: 'Código de verificação inválido.' }, { status: 400 });
			if (result2FA.usuarioId !== u.id) return json({ error: 'Código não pertence ao usuário logado.' }, { status: 403 });
		}

		const result = gerarPdfGise(giseDetalhado);
		const pdfBytes = result.pdf;
		const sigY = result.finalY;

		const verificationHash = gerarCodigoValidacao();
		const verificationUrl = `${url.origin}/validar/${verificationHash}`;

		const rubW_pts = 130;
		const rx_pts = (222.75 * 2.8346) - (rubW_pts / 2);
		const ry_pts = (210 - sigY + 2) * 2.8346;

		const pdfComRodape = await adicionarRodapeSimples(
			pdfBytes,
			u.nome,
			{
				verificationHash,
				verificationUrl,
				rubricBase64: rubrica || undefined,
				customRubricX: rx_pts,
				customRubricY: ry_pts,
				ip,
				latitude,
				longitude
			}
		);

		// Calcular Hash do original (Integridade)
		const originalHashBuffer = await crypto.subtle.digest('SHA-256', pdfComRodape.slice());
		const documentHash = Array.from(new Uint8Array(originalHashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		// Adicionar folha de auditoria (Manifesto) profissional
		const pdfFinal = await adicionarPaginaAuditoria(pdfComRodape, {
			signerName: u.nome,
			signerCpf: u.cpf ?? undefined,
			signingTime: getNowBR(),
			verificationHash,
			verificationUrl: `${url.origin}/validar/${verificationHash}`,
			ip,
			userAgent: ua,
			latitude,
			longitude,
			selfieBase64: selfieBase64,
			rubricBase64: rubrica || undefined,
			documentHash,
			token: crypto.randomUUID(),
			documentName: `Escala de Serviço GISE - ${gise.data_inicio}`,
			signatureLevel: 'avancada'
		});

		const hashBuffer = await crypto.subtle.digest('SHA-256', pdfFinal.slice());
		const arquivo_hash = Array.from(new Uint8Array(hashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		const r2 = getR2(platform);
		const [yyyy, mm, dd] = gise.data_inicio.split('-');
		const mesAno = `${yyyy}-${mm}`;
		const folder = `gise/${mesAno}/${dd}/${id}/escala`;
		const prefixBase = `${folder}/gise_${id}_${verificationHash}`;

		const documentKey = `${prefixBase}_assinada.pdf`;
		let selfieKey: string | undefined = undefined;

		if (r2) {
			const r2Promises: Promise<any>[] = [r2.put(documentKey, pdfFinal, { contentType: 'application/pdf' })];

			if (selfieBase64) {
				const regex = /^data:image\/(jpeg|png|jpg);base64,/;
				const matches = selfieBase64.match(regex);
				if (matches) {
					const ext = matches[1] === 'png' ? 'png' : 'jpg';
					const dataBase64 = selfieBase64.replace(regex, '');
					const bytes = Buffer.from(dataBase64, 'base64');
					selfieKey = `${prefixBase}_selfie.${ext}`;
					r2Promises.push(r2.put(selfieKey, bytes, { httpMetadata: { contentType: `image/${ext}` } }));
				}
			}

			await Promise.all(r2Promises);
		}

		await Promise.all([
			salvarGiseDocumento(db, id, documentKey, u.id, u.nome, '', verificationHash, rubrica, ip, ua, latitude, longitude, selfieKey, arquivo_hash),
			atualizarGiseEscala(db, id, { status: 'em_andamento' })
		]);

		const filename = `gise_${gise.data_inicio}_confirmada.pdf`;
		return new Response(pdfFinal as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}"`
			}
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Erro ao gerar PDF';
		console.error('[gise/assinar-simples]', e);
		return json({ error: message }, { status: 500 });
	}
};
