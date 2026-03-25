import { json } from '@sveltejs/kit';
import { getDB, buscarEscala, listarPoliciaisEscala, salvarDocumentoEscala } from '$lib/db';
import { gerarPdf, gerarPdfPlantao, gerarPdfExpediente } from '$lib/export';
import { adicionarRodapeSimples } from '$lib/server/pdf-signing';
import { gerarCodigoValidacao } from '$lib/utils';
import type { RequestEvent } from '@sveltejs/kit';

export const POST = async ({ platform, params, locals, url }: RequestEvent) => {
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

	// Formatar data/hora no fuso de Brasília (usado internamente se necessário)
	// No entanto, o adicionarRodapeSimples agora gera sua própria dataHoraFormatada.

	try {
		// Gerar o PDF da escala correto conforme o tipo
		const result = escala.tipo === 'expediente'
			? gerarPdfExpediente(escala, policiais)
			: escala.tipo === 'plantao'
				? gerarPdfPlantao(escala, policiais)
				: gerarPdf(escala, policiais);
		
		const pdfBytes = result.pdf;


		const verificationHash = gerarCodigoValidacao();
		const verificationUrl = `${url.origin}/validar/${verificationHash}`;

		// Adicionar rodapé de confirmação
		const pdfComRodape = await adicionarRodapeSimples(
			pdfBytes,
			usuario.nome,
			verificationHash,
			verificationUrl
		);

		// Salva no R2
		const p = platform as App.Platform | undefined;
		const r2Key = `escala_${escalaId}_assinada.pdf`;
		if (p?.env?.escalas_docs) {
			await p.env.escalas_docs.put(r2Key, pdfComRodape);
		}

		// Registrar no banco
		await salvarDocumentoEscala(db, escalaId, r2Key, usuario.nome, '', verificationHash);

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
