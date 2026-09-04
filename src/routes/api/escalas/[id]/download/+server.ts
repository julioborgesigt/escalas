/**
 * GET /api/escalas/[id]/download — baixa a escala em PDF, DOCX ou XLSX.
 *
 * O PDF tem dois caminhos que não se misturam:
 *
 * - **escala já assinada** (plantão/expediente): devolve o BLOB do R2, o
 *   arquivo exato que foi assinado — regerar quebraria o hash e a assinatura.
 *   `?manifesto=true` entrega a versão com o manifesto de auditoria (restrita a
 *   quem pode vê-lo); sem o parâmetro vai a cópia de conferência, sem os dados
 *   pessoais do manifesto (minimização, LGPD);
 * - **demais casos**: gera na hora a partir do banco.
 *
 * DOCX e XLSX são sempre gerados — são formatos de trabalho, não o documento
 * oficial. Todo download é auditado, com o formato e a cópia escolhida.
 */
import type { RequestHandler } from './$types';
import { getDB, buscarEscala, listarPoliciaisEscala, buscarDocumentoEscala } from '$lib/db';
import * as exportLib from '$lib/server/export';
import {
	CACHE_PRIVADO,
	contentDisposition,
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	serverError
} from '$lib/server/api';
import { tryGetR2 } from '$lib/db';
import { logger } from '$lib/server/logger';
import { verificarPermissaoEscala } from '$lib/server/escalas/permissao';
import {
	podeBaixarComManifesto,
	gerarCopiaConferencia,
	chaveConferencia
} from '$lib/server/assinatura/copia-conferencia';
import { gerarRascunhoEscalaPdf } from '$lib/server/assinatura/conferencia-pdf';
import { registrarAuditComContexto } from '$lib/db/audit';
import { limitarGeracaoPesada } from '$lib/server/rate-limit-pesado';

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

	// Teto por CONTA, depois da autorização: 429 não deve vazar para quem nem
	// podia baixar esta escala. Ver `rate-limit-pesado.ts`.
	const excedeu = await limitarGeracaoPesada(db, u);
	if (excedeu) return excedeu;

	const format = url.searchParams.get('format')?.toLowerCase() || 'pdf';
	const querManifesto = url.searchParams.get('manifesto') === 'true';

	const querPdfAssinavel =
		format === 'pdf' && (escala.tipo === 'expediente' || escala.tipo === 'plantao');
	const docAssinado = querPdfAssinavel ? await buscarDocumentoEscala(db, id) : undefined;
	const comManifesto = querManifesto && podeBaixarComManifesto(u);
	const copiaInfo = docAssinado?.r2_key
		? comManifesto
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
			if (comManifesto) {
				// Admin com ?manifesto=true: blob forense íntegro (com manifesto) do R2.
				const r2 = tryGetR2(platform);
				if (r2) {
					try {
						const r2Obj = await r2.get(docAssinado.r2_key);
						if (r2Obj) {
							return new Response(await r2Obj.arrayBuffer(), {
								headers: {
									'Content-Type': 'application/pdf',
									'Content-Disposition': contentDisposition(
										filename.replace('.pdf', '_manifesto.pdf')
									),
									'Cache-Control': CACHE_PRIVADO
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
				// R2 ausente/falhou: cai na cópia de conferência abaixo.
			}
			// Padrão (sem manifesto): cópia de conferência para todos os usuários.
			// Preferimos a cópia IDÊNTICA já gravada no R2 na assinatura (mesmos bytes
			// do documento assinado); só regeneramos (legado) quando ela não existe.
			const r2Conf = tryGetR2(platform);
			if (r2Conf && docAssinado.verificacao_hash) {
				const confObj = await r2Conf.get(chaveConferencia(docAssinado.verificacao_hash));
				if (confObj) {
					return new Response(confObj.body as unknown as BodyInit, {
						headers: {
							'Content-Type': 'application/pdf',
							'Content-Disposition': contentDisposition(`conferencia_${filename}`),
							'Cache-Control': CACHE_PRIVADO
						}
					});
				}
			}
			// Fallback legado: regenera a cópia de conferência a partir do rascunho.
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
					'Cache-Control': CACHE_PRIVADO
				}
			});
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
				'Cache-Control': CACHE_PRIVADO
			}
		});
	} catch (err) {
		return serverError(`[escalas/download] Falha ao gerar arquivo (escala_id=${id})`, err);
	}
};
