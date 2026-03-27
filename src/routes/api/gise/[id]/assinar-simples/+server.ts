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

export const POST = async ({ platform, params, locals, url }: RequestEvent) => {
	const u = locals.usuario;
	if (!u || u.tipo !== 'policial') {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const id = parseInt(params.id!);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	if (gise.status !== 'aguardando_assinatura') {
		return json({ error: 'A escala não está pronta para assinatura' }, { status: 400 });
	}

	const isSupervisor = gise.supervisor_sabado_id === u.id || gise.supervisor_domingo_id === u.id;
	if (!isSupervisor) {
		return json({ error: 'Apenas o Supervisor designado pode assinar esta escala' }, { status: 403 });
	}
	if (u.cargo !== 'DPC') {
		return json({ error: 'Somente DPC pode assinar como Supervisor' }, { status: 403 });
	}

	try {
		const giseDetalhado = await buscarGiseDetalhado(db, id);
		if (!giseDetalhado) return json({ error: 'Erro ao carregar dados da escala' }, { status: 500 });

		const result = gerarPdfGise(giseDetalhado);
		const pdfBytes = result.pdf;

		const verificationHash = gerarCodigoValidacao();
		const verificationUrl = `${url.origin}/validar/${verificationHash}`;

		const pdfComRodape = await adicionarRodapeSimples(
			pdfBytes,
			u.nome,
			verificationHash,
			verificationUrl
		);

		// Salvar no R2
		const p = platform as App.Platform | undefined;
		const r2Key = `gise_${id}_assinada.pdf`;
		if (p?.env?.escalas_docs) {
			await p.env.escalas_docs.put(r2Key, pdfComRodape);
		}

		// Registrar no banco
		await salvarGiseDocumento(db, id, r2Key, u.id, u.nome, '', verificationHash);
		await atualizarGiseEscala(db, id, { status: 'assinada' });

		const filename = `gise_${gise.data_inicio}_confirmada.pdf`;
		return new Response(pdfComRodape as unknown as BodyInit, {
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
