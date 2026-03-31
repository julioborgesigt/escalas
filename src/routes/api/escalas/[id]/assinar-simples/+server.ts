import { json } from '@sveltejs/kit';
import { getDB, buscarEscala, listarPoliciaisEscala, salvarDocumentoEscala } from '$lib/db';
import { gerarPdf, gerarPdfPlantao, gerarPdfExpediente } from '$lib/export';
import { adicionarRodapeSimples } from '$lib/server/pdf-signing';
import { gerarCodigoValidacao } from '$lib/utils';
import type { RequestEvent } from '@sveltejs/kit';

export const POST = async ({ platform, params, locals, url, request, getClientAddress }: RequestEvent) => {
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

	const body = await request.json().catch(() => ({}));
	const { latitude, longitude, rubricBase64, selfieBase64 } = body;
	
	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

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
			{
				verificationHash,
				verificationUrl,
				ip,
				latitude,
				longitude,
				rubricBase64: rubricBase64 || undefined
			}
		);

		// Calcular Hash SHA-256 do arquivo final
		const hashBuffer = await crypto.subtle.digest('SHA-256', pdfComRodape.slice());
		const arquivo_hash = Array.from(new Uint8Array(hashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		const p = platform as any;
		const r2 = p?.env?.escalas_docs;
		
		// Criar pasta mensal ex: escalas/2026-03
		const mesAno = escala.data_inicio.substring(0, 7);
		const folder = `escalas/${mesAno}/escala_${escalaId}`;
		const prefixBase = `${folder}/escala_${escalaId}_${verificationHash}`;

		const r2Key = `${prefixBase}_assinada.pdf`;
		let selfieKey: string | undefined = undefined;

		if (r2) {
			await r2.put(r2Key, pdfComRodape);

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

		// Registrar no banco com auditoria completa
		await salvarDocumentoEscala(db, escalaId, r2Key, usuario.nome, '', verificationHash, ip, ua, latitude, longitude, selfieKey, arquivo_hash);

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
