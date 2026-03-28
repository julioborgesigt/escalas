/**
 * POST /api/gise/[id]/assinar-simples
 *
 * Assinatura simples (confirmação administrativa) da escala GISE.
 * Gera PDF com rodapé de confirmação, salva no R2 e muda status.
 * Permissão: Supervisor designado (DPC) com escala em 'aguardando_assinatura'.
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getDB, buscarGiseEscala, buscarGiseDetalhado, salvarGiseDocumento, atualizarGiseEscala } from '$lib/db';
import { gerarPdfGise } from '$lib/export';
import { adicionarRodapeSimples } from '$lib/server/pdf-signing';
import { gerarCodigoValidacao } from '$lib/utils';

export const POST = async ({ platform, params, locals, url, request }: RequestEvent) => {
	const { dia, rubrica } = await request.json().catch(() => ({ dia: 'ambos', rubrica: null }));
	const u = locals.usuario;
	if (!u) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	if (gise.status !== 'aguardando_assinatura' && gise.status !== 'assinada') {
		return json({ error: 'A escala não está pronta para assinatura' }, { status: 400 });
	}

	if (u.tipo !== 'admin' && gise.supervisor_sabado_id !== u.id && gise.supervisor_domingo_id !== u.id) {
		return json({ error: 'Apenas os supervisores designados ou administradores podem assinar' }, { status: 403 });
	}

	// Se for supervisor de apenas um dia, forçar o dia correto
	let diaFinal = dia || 'ambos';
	if (gise.supervisor_sabado_id === u.id && gise.supervisor_domingo_id !== u.id) diaFinal = 'sabado';
	if (gise.supervisor_domingo_id === u.id && gise.supervisor_sabado_id !== u.id) diaFinal = 'domingo';

	try {
		const giseDetalhado = await buscarGiseDetalhado(db, id);
		if (!giseDetalhado) return json({ error: 'Erro ao carregar dados da escala' }, { status: 500 });

		const result = gerarPdfGise(giseDetalhado, diaFinal === 'ambos' ? undefined : diaFinal as 'sabado' | 'domingo');
		const pdfBytes = result.pdf;
		const sigY = result.finalY; // mm from top

		const verificationHash = gerarCodigoValidacao();
		const verificationUrl = `${url.origin}/validar/${verificationHash}`;

		// Calcular posição da rubrica (pdf-lib usa pontos do bottom: 1mm = 2.8346 pts)
		// giseSigCenterX = 0.75 * 297mm = 222.75mm
		const rubW_pts = 130; 
		const rx_pts = (222.75 * 2.8346) - (rubW_pts / 2);
		const ry_pts = (210 - sigY + 2) * 2.8346; // 2mm acima da linha

		const pdfComRodape = await adicionarRodapeSimples(
			pdfBytes,
			u.nome,
			verificationHash,
			verificationUrl,
			rubrica || undefined,
			rx_pts,
			ry_pts
		);

		// Salvar no R2
		const documentKey = `gise_${id}_${diaFinal}_assinada.pdf`;
		const env = (platform as any)?.env || (platform as any);
		if (env?.escalas_docs) {
			await env.escalas_docs.put(documentKey, pdfComRodape, {
				contentType: 'application/pdf'
			});
		}

		// Registrar no banco
		await salvarGiseDocumento(db, id, documentKey, u.id, u.nome, '', verificationHash, diaFinal as any, rubrica);
		
		// Atualizar status da escala (opcional: só 'assinada' se todos os dias estiverem assinados)
		// Por simplicidade, mantemos 'assinada' ao receber qualquer assinatura, 
		// mas o frontend mostrará quais faltam.
		await atualizarGiseEscala(db, id, { status: 'assinada' });

		const filename = `gise_${gise.data_inicio}_${diaFinal}_confirmada.pdf`;
		return new Response(pdfComRodape as any, {
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
