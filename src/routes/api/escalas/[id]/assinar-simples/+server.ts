import { json } from '@sveltejs/kit';
import { getDB, buscarEscala, listarPoliciaisEscala, salvarDocumentoEscala } from '$lib/db';
import { gerarPdf } from '$lib/export';
import { adicionarRodapeSimples } from '$lib/server/pdf-signing';
import type { RequestEvent } from '@sveltejs/kit';

export const POST = async ({ platform, params, locals }: RequestEvent) => {
	const db = getDB(platform);
	const escalaId = Number(params.id);
	const usuario = locals.usuario;

	if (!usuario) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	const escala = await buscarEscala(db, escalaId);
	if (!escala) {
		return json({ error: 'Escala não encontrada' }, { status: 404 });
	}

	// Policial só pode assinar escalas da sua lotação
	if (usuario.tipo === 'policial' && escala.lotacao !== usuario.lotacao) {
		return json({ error: 'Sem permissão para esta escala' }, { status: 403 });
	}

	const policiais = await listarPoliciaisEscala(db, escalaId);
	if (policiais.length === 0) {
		return json({ error: 'Escala sem policiais cadastrados' }, { status: 400 });
	}

	// Formatar data/hora no fuso de Brasília
	const agora = new Date();
	const dataHoraBrasilia = agora.toLocaleString('pt-BR', {
		timeZone: 'America/Sao_Paulo',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).replace(',', ' às');

	try {
		// Gerar o PDF da escala
		const pdfBytes = gerarPdf(escala, policiais);

		// Adicionar rodapé de confirmação
		const pdfComRodape = await adicionarRodapeSimples(
			pdfBytes,
			usuario.nome,
			dataHoraBrasilia
		);

		// Salvar no R2
		const r2Key = `escala_${escalaId}_assinada.pdf`;
		if (platform?.env?.escalas_docs) {
			await platform.env.escalas_docs.put(r2Key, pdfComRodape);
		}

		// Registrar no banco
		await salvarDocumentoEscala(db, escalaId, r2Key, usuario.nome, '');

		const filename = `escala_${escala.cidade.toLowerCase().replace(/\s+/g, '_')}_${escala.data_inicio}_confirmada.pdf`;
		return new Response(pdfComRodape as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}"`
			}
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Erro ao gerar PDF';
		console.error('[assinar-simples]', e);
		return json({ error: message }, { status: 500 });
	}
};
