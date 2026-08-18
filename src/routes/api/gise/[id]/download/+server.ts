/**
 * Downloads da escala GISE — um endpoint para todos os formatos
 * (`?format=pdf|xlsx|extraordinario`), porque todos partem da mesma permissão e
 * da mesma auditoria: exportar é acesso a dado pessoal e fica registrado antes
 * de qualquer byte sair.
 *
 * A regra dos DOIS ARTEFATOS aparece aqui inteira. Para um documento já
 * assinado existem duas versões:
 *
 * - **com manifesto** — o blob ÍNTEGRO do R2, com a assinatura criptográfica
 *   preservada. Só o Admin Geral e o próprio assinante recebem
 *   (`podeBaixarComManifesto` + `?manifesto=true`), porque o manifesto carrega
 *   dados forenses (IP, GPS, selfie);
 * - **cópia de conferência** — o mesmo conteúdo regerado com rodapé e QR para
 *   `/validar`, sem manifesto. É o que circula.
 *
 * Sem assinatura, o que sai é RASCUNHO, marcado como tal.
 *
 * O caminho legado regenera o relatório quando não há blob no R2 (assinaturas
 * anteriores à gravação do arquivo) — mesma aparência, sem valor forense.
 */
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarGiseDetalhado,
	buscarPresencasGise,
	buscarAssinaturaRelatorioGise
} from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { verificarPermissaoGise } from '$lib/server/gise/permissao';
import {
	podeBaixarComManifesto,
	gerarCopiaConferencia,
	chaveConferencia
} from '$lib/server/assinatura/copia-conferencia';
import { carregarLogosGise } from '$lib/server/gise/logos';
import { registrarAuditComContexto } from '$lib/db/audit';
import { tryGetR2 } from '$lib/db';
import { giseDownloadSchema, giseIdParamSchema } from '$lib/schemas';
import {
	contentDisposition,
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	serverError
} from '$lib/server/api';
import { toGisePdfData } from '$lib/server/export';
import { getBreveRelatorioEnvMergido } from '$lib/server/gise/breve-relatorio-env';
import { logger } from '$lib/server/logger';
import {
	giseAutorizaSeccionalRelatorioExtra,
	secIdEhSupervisaoExtra
} from '$lib/server/gise/supervisao-extra';
import {
	appendGiseDetalhadoToXlsxWorkbook,
	createAppendGiseXlsxState
} from '$lib/server/gise/xlsx-workbook-append';
import ExcelJS from 'exceljs';
import { mensagemDeErro } from '$lib/utils/erro';

export const GET: RequestHandler = async ({ locals, params, platform, url }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	// Validação de Parâmetros
	const paramParsed = giseIdParamSchema.safeParse(params);
	if (!paramParsed.success) return badRequest(paramParsed.error.issues[0].message);
	const { id } = paramParsed.data;

	const queryParsed = giseDownloadSchema.safeParse(Object.fromEntries(url.searchParams));
	if (!queryParsed.success) return badRequest('Parâmetros de busca inválidos');

	const { format, seccionalId, equipeType, manifesto } = queryParsed.data;

	const db = getDB(platform);
	const gise = await buscarGiseDetalhado(db, id);
	if (!gise) return notFound('Escala GISE');

	// GiseDetalhado estende GiseEscala — o helper enxerga supervisor_id,
	// assessor_id, seint*_id direto e só dispara query extra de gise_membros
	// se o usuário não for admin/quadro.
	const perm = await verificarPermissaoGise(db, gise, u);
	if (!perm.permitido) {
		return forbidden(perm.motivo ?? 'Sem permissão para acessar downloads desta escala GISE.');
	}

	await registrarAuditComContexto(db, {
		usuario: u,
		acao: 'exportar_gise',
		entidade: 'gise',
		entidade_id: id,
		detalhes: `Formato: ${format}`
	});

	// RELATÓRIO DE SERVIÇO EXTRAORDINÁRIO (Prioriza Download do R2)
	if (format === 'extraordinario') {
		if (seccionalId === undefined || seccionalId === null) {
			return badRequest('Parâmetro seccionalId é obrigatório.');
		}
		const secAutorizada = await giseAutorizaSeccionalRelatorioExtra(db, id, seccionalId);
		if (!secAutorizada) return badRequest('Seccional inválida para esta GISE.');

		const { esq: logoEsq, dir: logoDir } = await carregarLogosGise(platform);
		const r2 = tryGetR2(platform);

		const reportSignature = await buscarAssinaturaRelatorioGise(
			db,
			id,
			seccionalId,
			'extraordinario'
		);

		// 1. Se existir assinatura: admin/DPC-assinante com ?manifesto=true recebe o
		//    blob forense íntegro do R2; os demais recebem a cópia de conferência.
		if (reportSignature?.verification_hash) {
			if (manifesto && podeBaixarComManifesto(u, reportSignature.assinante_id)) {
				if (!r2) {
					return serverError('[gise/download] R2 não configurado', new Error('R2_NOT_CONFIGURED'));
				}

				try {
					// Prioridade total: usar a chave salva no banco de dados (mais robusto)
					let r2Key = reportSignature.r2_key;

					// Fallback apenas para registros legados
					if (!r2Key) {
						const [yyyy, mm, dd_escala] = gise.data_inicio.split('-');
						const folder = `gise/${yyyy}-${mm}/${dd_escala}/${id}/relatorios_extra`;
						r2Key = `${folder}/gise_rel_${id}_sec_${seccionalId}_${reportSignature.verification_hash}_assinada.pdf`;
					}

					const r2Object = await r2.get(r2Key);
					if (r2Object) {
						const pdfBytes = await r2Object.arrayBuffer();
						const filename = `relatorio_extraordinario_${gise.data_inicio}_sec_${seccionalId}_assinado_manifesto.pdf`;
						return new Response(pdfBytes, {
							headers: {
								'Content-Type': 'application/pdf',
								'Content-Disposition': contentDisposition(filename),
								'Cache-Control': 'no-cache'
							}
						});
					} else {
						return notFound('Relatório assinado no R2');
					}
				} catch (e) {
					return serverError(
						`[gise/download] Erro ao recuperar arquivo do R2 (gise=${id}, sec=${seccionalId})`,
						e
					);
				}
			}

			// Não privilegiado: preferimos a cópia de conferência IDÊNTICA já gravada no
			// R2 na assinatura (mesmos bytes do relatório assinado); só regeneramos
			// (legado) quando ela não existe.
			if (r2) {
				const confObj = await r2.get(chaveConferencia(reportSignature.verification_hash));
				if (confObj) {
					const filename = `conferencia_extraordinario_${gise.data_inicio}_sec_${seccionalId}.pdf`;
					return new Response(await confObj.arrayBuffer(), {
						headers: {
							'Content-Type': 'application/pdf',
							'Content-Disposition': contentDisposition(filename),
							'Cache-Control': 'no-cache'
						}
					});
				}
			}

			// Fallback legado: regenera o relatório (sem manifesto forense) + rodapé/QR.
			try {
				const presencas = await buscarPresencasGise(db, id, platform?.env);
				const isSupExtra = await secIdEhSupervisaoExtra(db, seccionalId);
				const { gerarPdfRelatorioExtraordinario } = await import('$lib/server/export');
				const brEnv = await getBreveRelatorioEnvMergido(db, gise.operacao_id);
				const result = await gerarPdfRelatorioExtraordinario({
					isSupExtra,
					gise,
					presencas,
					seccionalId,
					baseUrl: url.origin,
					brEnv,
					logoEsqBytes: logoEsq,
					logoDirBytes: logoDir,
					reportSignature
				});
				const hash = reportSignature.verification_hash;
				const buffer = await gerarCopiaConferencia({
					pdfRascunho: result.pdf,
					assinanteNome: reportSignature.assinante_nome,
					verificationHash: hash,
					verificationUrl: `${url.origin}/validar/${hash}`,
					rubricBase64: reportSignature.rubrica ?? undefined
				});
				const filename = `conferencia_extraordinario_${gise.data_inicio}_sec_${seccionalId}.pdf`;
				return new Response(buffer as unknown as BodyInit, {
					headers: {
						'Content-Type': 'application/pdf',
						'Content-Disposition': contentDisposition(filename),
						'Cache-Control': 'no-cache'
					}
				});
			} catch (err) {
				return serverError(
					`[gise/download] Falha ao gerar cópia de conferência do relatório (gise=${id}, sec=${seccionalId})`,
					err
				);
			}
		}

		// 2. Se NÃO existir assinatura, permitir apenas como RASCUNHO para:
		//    Admin Geral, supervisor da GISE, ou admin seccional DAquela seccional.
		//    verificarPermissaoGise só prova participação na GISE — sem o filtro
		//    por seccionalId, admin seccional A baixaria PII/presença da B
		//    (FLW-AUT-008).
		const isSupervisor = u.tipo === 'policial' && gise.supervisor_id === u.id;
		if (isAdminGeral(u) || isSupervisor) {
			// ok
		} else if (isAdminSeccional(u) && u.papel_unidade_id === seccionalId) {
			// ok — só a própria seccional
		} else {
			return forbidden('Este relatório ainda não foi assinado.');
		}

		try {
			const presencas = await buscarPresencasGise(db, id, platform?.env);
			const isSupervisaoExtra = await secIdEhSupervisaoExtra(db, seccionalId);
			const { gerarPdfRelatorioExtraordinario } = await import('$lib/server/export');
			const brEnv = await getBreveRelatorioEnvMergido(db, gise.operacao_id);
			// `isPreparando: isSupervisaoExtra` preserva EXATAMENTE o comportamento
			// anterior (rascunho de supervisão omitia o placeholder "Aguardando
			// Conferência", o de seccional mostrava). O rascunho não é assinado
			// nenhum dos dois (`reportSignature: null`), então essa diferença entre
			// os ramos não parece proposital — mas mudar a saída aqui muda um PDF
			// protegido por golden, e não é decisão desta extração.
			const result = await gerarPdfRelatorioExtraordinario({
				isSupExtra: isSupervisaoExtra,
				gise,
				presencas,
				seccionalId,
				baseUrl: url.origin,
				brEnv,
				logoEsqBytes: logoEsq,
				logoDirBytes: logoDir,
				reportSignature: null,
				isPreparando: isSupervisaoExtra
			});
			const filename = isSupervisaoExtra
				? `RASCUNHO_extraordinario_supervisao_${gise.data_inicio}.pdf`
				: `RASCUNHO_extraordinario_${gise.data_inicio}_sec_${seccionalId || 'geral'}.pdf`;

			return new Response(result.pdf as unknown as BodyInit, {
				headers: {
					'Content-Type': 'application/pdf',
					'Content-Disposition': contentDisposition(filename),
					'Cache-Control': 'no-cache'
				}
			});
		} catch (err) {
			return serverError(`[gise/download] Erro ao gerar rascunho do relatório (gise=${id})`, err);
		}
	}

	if (format === 'pdf') {
		const docGise = gise.documento;

		// Admin ou DPC-assinante com ?manifesto=true: blob forense íntegro do R2.
		if (docGise?.r2_key && manifesto && podeBaixarComManifesto(u, docGise.assinante_id)) {
			const r2 = tryGetR2(platform);
			if (r2) {
				try {
					const r2Object = await r2.get(docGise.r2_key);
					if (r2Object) {
						const pdfBytes = await r2Object.arrayBuffer();
						return new Response(pdfBytes, {
							headers: {
								'Content-Type': 'application/pdf',
								'Content-Disposition': contentDisposition(
									`gise_${gise.data_inicio}_assinada_manifesto.pdf`
								),
								'Cache-Control': 'no-cache'
							}
						});
					}
				} catch (e) {
					logger.warn('[gise/download] Falha ao buscar PDF assinado do R2', {
						gise_id: id,
						error: mensagemDeErro(e)
					});
				}
			}
		}

		// Documento assinado: preferimos a cópia de conferência IDÊNTICA já gravada no
		// R2 na assinatura (mesmos bytes do documento assinado). Serve direto, sem
		// regenerar rascunho. Só quando ela não existe caímos na regeneração legada.
		if (docGise?.r2_key && docGise.verificacao_hash) {
			const r2Conf = tryGetR2(platform);
			if (r2Conf) {
				const confObj = await r2Conf.get(chaveConferencia(docGise.verificacao_hash));
				if (confObj) {
					return new Response(await confObj.arrayBuffer(), {
						headers: {
							'Content-Type': 'application/pdf',
							'Content-Disposition': contentDisposition(`conferencia_gise_${gise.data_inicio}.pdf`),
							'Cache-Control': 'no-cache'
						}
					});
				}
			}
		}

		// Rascunho sem manifesto — base para a cópia de conferência (documento
		// assinado, usuário não privilegiado) e para a GISE ainda não assinada.
		const { gerarPdfGise } = await import('$lib/server/export');
		const r2Logo = tryGetR2(platform);
		let logoBytes: Uint8Array | undefined;
		let logoCearaBytes: Uint8Array | undefined;
		if (r2Logo) {
			try {
				const [logoObj, cearaObj] = await Promise.all([
					r2Logo.get('assets/logogise.jpg'),
					r2Logo.get('assets/logo_ceara.jpg')
				]);
				if (logoObj) logoBytes = new Uint8Array(await logoObj.arrayBuffer());
				else logger.warn('[gise/download] Logo ausente no R2 (assets/logogise.jpg)');
				if (cearaObj) logoCearaBytes = new Uint8Array(await cearaObj.arrayBuffer());
			} catch (e) {
				logger.error('[gise/download] Erro ao buscar logo do R2', {
					error: mensagemDeErro(e)
				});
			}
		} else {
			logger.warn('[gise/download] R2 binding indisponível');
		}
		const brForPdf = await getBreveRelatorioEnvMergido(db, gise.operacao_id);
		const result = await gerarPdfGise(toGisePdfData(gise, brForPdf), logoBytes, logoCearaBytes);

		// Documento assinado → cópia de conferência por padrão
		// (rascunho + rodapé/QR para /validar, sem manifesto forense).
		if (docGise?.r2_key) {
			const hash = docGise.verificacao_hash ?? undefined;
			const buffer = await gerarCopiaConferencia({
				pdfRascunho: result.pdf,
				assinanteNome: docGise.assinante_nome,
				verificationHash: hash,
				verificationUrl: hash ? `${url.origin}/validar/${hash}` : undefined
			});
			return new Response(buffer as unknown as BodyInit, {
				headers: {
					'Content-Type': 'application/pdf',
					'Content-Disposition': contentDisposition(`conferencia_gise_${gise.data_inicio}.pdf`),
					'Cache-Control': 'no-cache'
				}
			});
		}

		return new Response(result.pdf as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': contentDisposition(`rascunho_${gise.data_inicio}.pdf`),
				'Cache-Control': 'no-cache'
			}
		});
	}

	if (format === 'produtividade') {
		if (seccionalId === undefined || seccionalId === null)
			return badRequest('Seccional é obrigatória');

		const { buscarRespostasProdutividadeSeccional } = await import('$lib/db');
		const { gerarRelatorioProdutividadeGisePdf } = await import('$lib/server/export');

		const seccional = gise.seccionais.find(
			(s) => s.id === seccionalId || s.seccional_id === seccionalId
		);
		if (!seccional) return notFound('Seccional');

		// Achatar todas as equipes da seccional (de todas as unidades)
		const todasEquipes = (seccional.unidades ?? []).flatMap((u) => u.equipes ?? []);
		const seccionalFiltrada = equipeType
			? {
					...seccional,
					equipes: todasEquipes.filter((eq) => eq.tipo === equipeType)
				}
			: { ...seccional, equipes: todasEquipes };

		const respostas = await buscarRespostasProdutividadeSeccional(db, id, seccional.id);
		const result = gerarRelatorioProdutividadeGisePdf({
			gise,
			seccional: seccionalFiltrada,
			respostas
		});

		const tipoSufixo =
			equipeType === 'seint' ? '_seint' : equipeType === 'operacional' ? '_operacional' : '';
		const filename = `resumo_produtividade${tipoSufixo}_${gise.data_inicio}_sec_${seccionalId}.pdf`;
		return new Response(result.pdf as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': contentDisposition(filename),
				'Cache-Control': 'no-cache'
			}
		});
	}

	if (
		gise.status !== 'em_andamento' &&
		gise.status !== 'aguardando_relatorios' &&
		gise.status !== 'aguardando_assinatura_relat' &&
		gise.status !== 'pronta_para_finalizar' &&
		gise.status !== 'finalizada'
	) {
		return badRequest('Download só é liberado após a assinatura do Supervisor.');
	}

	// XLSX (mesma estrutura que o export agregado do histórico; uma GISE por arquivo)
	const wb = new ExcelJS.Workbook();
	const xlsxState = createAppendGiseXlsxState();
	await appendGiseDetalhadoToXlsxWorkbook(wb, db, gise, xlsxState, { multiEscala: false });

	const arrayBuffer = await wb.xlsx.writeBuffer();
	const buffer = new Uint8Array(arrayBuffer as ArrayBuffer);
	const filename = `gise_${gise.data_inicio}.xlsx`;

	return new Response(buffer as unknown as BodyInit, {
		status: 200,
		headers: {
			'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'Content-Disposition': contentDisposition(filename),
			'Cache-Control': 'no-cache'
		}
	});
};
