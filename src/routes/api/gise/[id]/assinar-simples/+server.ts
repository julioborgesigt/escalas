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

export const POST = async ({ platform, params, locals, url, request, getClientAddress }: RequestEvent) => {
	const { dia, rubrica, latitude, longitude, selfieBase64 } = await request.json().catch(() => ({}) as any);
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

		// Calcular Hash SHA-256 do arquivo final
		const hashBuffer = await crypto.subtle.digest('SHA-256', pdfComRodape.slice());
		const arquivo_hash = Array.from(new Uint8Array(hashBuffer))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');

		// Salvar no R2
		const r2 = (platform as any)?.env?.escalas_docs;
		const mesAno = gise.data_inicio.substring(0, 7);
		const folder = `gise/${mesAno}/escala_${id}`;
		const prefixBase = `${folder}/gise_${id}_${diaFinal}_${verificationHash}`;

		const documentKey = `${prefixBase}_assinada.pdf`;
		let selfieKey: string | undefined = undefined;

		if (r2) {
			await r2.put(documentKey, pdfComRodape, { contentType: 'application/pdf' });

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

		// Registrar no banco com auditoria
		await salvarGiseDocumento(db, id, documentKey, u.id, u.nome, '', verificationHash, diaFinal as any, rubrica, ip, ua, latitude, longitude, selfieKey, arquivo_hash);
		
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
