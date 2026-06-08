import type { RequestHandler } from './$types';
import { getDB, buscarEscala, listarPoliciaisEscala, buscarDocumentoEscala } from '$lib/db';
import * as exportLib from '$lib/server/export';
import {
	contentDisposition,
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	serverError
} from '$lib/server/api';
import { getR2 } from '$lib/server/platform';
import { logger } from '$lib/server/logger';
import { verificarPermissaoEscala } from '$lib/server/escala-permissao';
import { podeBaixarForense, gerarCopiaConferencia } from '$lib/server/copia-conferencia';
import { registrarAuditComContexto } from '$lib/db/audit';

type EscalaArg = Parameters<typeof exportLib.gerarPdf>[0];
type PoliciaisArg = Parameters<typeof exportLib.gerarPdf>[1];

/** Gera o rascunho PDF da escala (sem manifesto forense), conforme o tipo. */
async function gerarRascunhoEscalaPdf(
	escala: EscalaArg,
	policiais: PoliciaisArg,
	platform: App.Platform | undefined
): Promise<Uint8Array> {
	if (escala.tipo === 'expediente') {
		const [logoPolicia, logoCeara] = await Promise.all([
			carregarLogoR2(platform, 'assets/logogise.jpg'),
			carregarLogoR2(platform, 'assets/logo_ceara.jpg')
		]);
		const result = await exportLib.gerarPdfExpediente(escala, policiais, logoPolicia, logoCeara);
		return result.pdf;
	}
	if (escala.tipo === 'plantao') {
		return exportLib.gerarPdfPlantao(escala, policiais).pdf;
	}
	return exportLib.gerarPdf(escala, policiais).pdf;
}

async function carregarLogoR2(
	platform: App.Platform | undefined,
	key: string
): Promise<Uint8Array | undefined> {
	try {
		const r2 = getR2(platform);
		if (!r2) return undefined;
		const obj = await r2.get(key);
		if (!obj) return undefined;
		return new Uint8Array(await obj.arrayBuffer());
	} catch {
		return undefined;
	}
}

export const GET: RequestHandler = async ({ params, platform, url, locals }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const id = Number(params.id);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return notFound('Escala');

	const perm = await verificarPermissaoEscala(db, id, escala.lotacao, u);
	if (!perm.permitido) return forbidden(perm.motivo ?? 'Sem permissão para baixar esta escala');

	const format = url.searchParams.get('format')?.toLowerCase() || 'pdf';

	// Para o PDF de uma escala assinada decidimos cedo quem recebe o quê:
	// Super Admin → blob forense do R2 (com manifesto); demais → cópia de
	// conferência (regenerada, sem manifesto). Registramos a distinção na auditoria.
	const querPdfAssinavel =
		format === 'pdf' && (escala.tipo === 'expediente' || escala.tipo === 'plantao');
	const docAssinado = querPdfAssinavel ? await buscarDocumentoEscala(db, id) : undefined;
	const privilegiado = podeBaixarForense(u);
	const copiaInfo = docAssinado?.r2_key
		? privilegiado
			? ' · Cópia: forense'
			: ' · Cópia: conferencia'
		: '';

	await registrarAuditComContexto(db, {
		usuario: u,
		acao: 'exportar_escala',
		entidade: 'escala',
		entidade_id: id,
		detalhes: `Formato: ${format} · Tipo: ${escala.tipo}${copiaInfo}`
	});

	const filename = `${escala.titulo.replace(/[/\\?%*:|"<>]/g, '-')}.${format === 'docx' || format === 'doc' ? 'docx' : format === 'xlsx' || format === 'excel' || format === 'xls' ? 'xlsx' : 'pdf'}`;

	try {
		// ── PDF de escala assinada ───────────────────────────────────────────
		if (querPdfAssinavel && docAssinado?.r2_key) {
			if (privilegiado) {
				// Super Admin: blob forense íntegro (com manifesto) do R2.
				const r2 = getR2(platform);
				if (r2) {
					try {
						const r2Obj = await r2.get(docAssinado.r2_key);
						if (r2Obj) {
							return new Response(await r2Obj.arrayBuffer(), {
								headers: {
									'Content-Type': 'application/pdf',
									'Content-Disposition': contentDisposition(filename),
									'Cache-Control': 'no-cache'
								}
							});
						}
					} catch (e) {
						logger.warn('[escalas/download] Falha ao buscar PDF assinado do R2', {
							escala_id: id,
							error: String(e)
						});
					}
				}
				// R2 ausente/falhou: cai no rascunho regenerado (sem manifesto) abaixo.
			} else {
				// Demais usuários: cópia de conferência (sem manifesto forense).
				const policiaisConf = await listarPoliciaisEscala(db, id);
				const rascunho = await gerarRascunhoEscalaPdf(escala, policiaisConf, platform);
				const hash = docAssinado.verificacao_hash ?? undefined;
				const buffer = await gerarCopiaConferencia({
					pdfRascunho: rascunho,
					assinanteNome: docAssinado.assinante_nome,
					verificationHash: hash,
					verificationUrl: hash ? `${url.origin}/validar/${hash}` : undefined
				});
				return new Response(buffer as BodyInit, {
					headers: {
						'Content-Type': 'application/pdf',
						'Content-Disposition': contentDisposition(`conferencia_${filename}`),
						'Cache-Control': 'no-cache'
					}
				});
			}
		}

		const policiais = await listarPoliciaisEscala(db, id);

		let buffer: Uint8Array;
		let contentType: string;

		if (format === 'docx' || format === 'doc') {
			if (escala.tipo === 'plantao') buffer = await exportLib.gerarDocxPlantao(escala, policiais);
			else if (escala.tipo === 'expediente')
				buffer = await exportLib.gerarDocxExpediente(escala, policiais);
			else buffer = await exportLib.gerarDocx(escala, policiais);
			contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
		} else if (format === 'xlsx' || format === 'excel' || format === 'xls') {
			if (escala.tipo === 'plantao') buffer = await exportLib.gerarXlsxPlantao(escala, policiais);
			else if (escala.tipo === 'expediente')
				buffer = await exportLib.gerarXlsxExpediente(escala, policiais);
			else buffer = await exportLib.gerarXlsx(escala, policiais);
			contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
		} else {
			// PDF draft (escala sem assinatura): rascunho sem manifesto.
			buffer = await gerarRascunhoEscalaPdf(escala, policiais, platform);
			contentType = 'application/pdf';
		}

		return new Response(buffer as BodyInit, {
			headers: {
				'Content-Type': contentType,
				'Content-Disposition': contentDisposition(filename),
				'Cache-Control': 'no-cache'
			}
		});
	} catch (err) {
		return serverError(`[escalas/download] Falha ao gerar arquivo (escala_id=${id})`, err);
	}
};
