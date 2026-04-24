import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarGiseDetalhado,
	buscarPresencasGise,
	buscarAssinaturaRelatorioGise
} from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { getR2 } from '$lib/server/platform';
import { giseDownloadSchema, giseIdParamSchema } from '$lib/schemas';
import { contentDisposition } from '$lib/server/api';
import { toGisePdfData } from '$lib/export';
import { getBreveRelatorioEnvMergido } from '$lib/server/breve-relatorio-env';
import { logger } from '$lib/server/logger';
import {
	giseAutorizaSeccionalRelatorioExtra,
	secIdEhSupervisaoExtra
} from '$lib/server/gise-supervisao-extra';
import { appendGiseDetalhadoToXlsxWorkbook, createAppendGiseXlsxState } from '$lib/server/gise-xlsx-workbook-append';
import ExcelJS from 'exceljs';

export const GET: RequestHandler = async ({ locals, params, platform, url }) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autenticado' }, { status: 401 });

	// Validação de Parâmetros
	const paramParsed = giseIdParamSchema.safeParse(params);
	if (!paramParsed.success) {
		return json({ error: paramParsed.error.issues[0].message }, { status: 400 });
	}
	const { id } = paramParsed.data;

	const queryParsed = giseDownloadSchema.safeParse(Object.fromEntries(url.searchParams));
	if (!queryParsed.success) {
		return json({ error: 'Parâmetros de busca inválidos' }, { status: 400 });
	}
	const { format, seccionalId, equipeType } = queryParsed.data;

	const db = getDB(platform);
	const gise = await buscarGiseDetalhado(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	const isSupervisor = u.tipo === 'policial' && gise.supervisor_id === u.id;
	const isMembro =
		u.tipo === 'policial' &&
		gise.seccionais.some((s) =>
			s.unidades.some((unidade) =>
				unidade.equipes.some((eq) => eq.membros.some((m) => m.policial_id === u.id))
			)
		);
	const isQuadroSupervisao =
		u.tipo === 'policial' &&
		[gise.supervisor_id, gise.assessor_id, gise.seint1_id, gise.seint2_id].some((pid) => pid === u.id);

	if (!isAdminGeral(u) && !isAdminSeccional(u) && !isSupervisor && !isMembro && !isQuadroSupervisao) {
		return json(
			{ error: 'Sem permissão para acessar downloads desta escala GISE.' },
			{ status: 403 }
		);
	}

	// RELATÓRIO DE SERVIÇO EXTRAORDINÁRIO (Prioriza Download do R2)
	if (format === 'extraordinario') {
		if (seccionalId === undefined || seccionalId === null) {
			return json({ error: 'Parâmetro seccionalId é obrigatório.' }, { status: 400 });
		}
		const secAutorizada = await giseAutorizaSeccionalRelatorioExtra(db, id, seccionalId);
		if (!secAutorizada) {
			return json({ error: 'Seccional inválida para esta GISE.' }, { status: 400 });
		}

		const r2 = getR2(platform);

		const reportSignature = await buscarAssinaturaRelatorioGise(db, id, seccionalId, 'extraordinario');

		// 1. Se existir assinatura, baixar do R2 preferencialmente usando a chave do banco
		if (reportSignature?.verification_hash) {
			if (!r2) {
				return json({ error: 'R2 não configurado na plataforma.' }, { status: 500 });
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
					const filename = `relatorio_extraordinario_${gise.data_inicio}_sec_${seccionalId}_assinado.pdf`;
					return new Response(pdfBytes, {
						headers: {
							'Content-Type': 'application/pdf',
							'Content-Disposition': contentDisposition(filename),
							'Cache-Control': 'no-cache'
						}
					});
				} else {
					return json({ error: 'Relatório assinado não encontrado no R2.' }, { status: 404 });
				}
			} catch (e: any) {
				return json({ error: 'Erro ao recuperar arquivo do R2' }, { status: 500 });
			}
		}

		// 2. Se NÃO existir assinatura, permitir apenas para admins/supervisores como RASCUNHO
		if (!isAdminGeral(u) && !isAdminSeccional(u) && !isSupervisor) {
			return json(
				{ error: 'Este relatório ainda não foi assinado.' },
				{ status: 403 }
			);
		}

		try {
			const presencas = await buscarPresencasGise(db, id);
			const isSupervisaoExtra = await secIdEhSupervisaoExtra(db, seccionalId);
			const { gerarRelatorioExtraordinarioPdf, gerarRelatorioExtraordinarioSupervisaoPdf } = await import(
				'$lib/export'
			);
			const brEnv = await getBreveRelatorioEnvMergido(db);
			const result = isSupervisaoExtra
				? await gerarRelatorioExtraordinarioSupervisaoPdf(
						gise,
						presencas,
						url.origin,
						null,
						undefined,
						true,
						brEnv
					)
				: await gerarRelatorioExtraordinarioPdf(
						toGisePdfData(gise, brEnv),
						presencas,
						seccionalId,
						url.origin,
						null,
						undefined
					);
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
			return json({ error: 'Erro ao gerar rascunho do relatório.' }, { status: 500 });
		}
	}

	if (format === 'pdf') {
		const filename = `gise_${gise.data_inicio}_assinada.pdf`;

		// Prioridade total: buscar o PDF assinado (com manifesto) no R2
		if (gise.documento?.r2_key) {
			const r2 = getR2(platform);
			if (r2) {
				try {
					const r2Object = await r2.get(gise.documento.r2_key);
					if (r2Object) {
						const pdfBytes = await r2Object.arrayBuffer();
						return new Response(pdfBytes, {
							headers: {
								'Content-Type': 'application/pdf',
								'Content-Disposition': contentDisposition(filename),
								'Cache-Control': 'no-cache'
							}
						});
					}
				} catch (e) {
					logger.warn('[gise/download] Falha ao buscar PDF assinado do R2', {
						gise_id: id,
						error: e instanceof Error ? e.message : String(e)
					});
				}
			}
		}

		// Fallback: gerar PDF normal
		const { gerarPdfGise } = await import('$lib/export');
		const r2Logo = getR2(platform);
		let logoBytes: Uint8Array | undefined;
		if (r2Logo) {
			try {
				const logoObj = await r2Logo.get('assets/logogise.jpg');
				if (logoObj) {
					logoBytes = new Uint8Array(await logoObj.arrayBuffer());
					logger.debug('[gise/download] Logo carregada do R2', { bytes: logoBytes.length });
				} else {
					logger.warn('[gise/download] Logo ausente no R2 (assets/logogise.jpg)');
				}
			} catch (e) {
				logger.error('[gise/download] Erro ao buscar logo do R2', {
					error: e instanceof Error ? e.message : String(e)
				});
			}
		} else {
			logger.warn('[gise/download] R2 binding indisponível');
		}
		const brForPdf = await getBreveRelatorioEnvMergido(db);
		const result = await gerarPdfGise(toGisePdfData(gise, brForPdf), logoBytes);
		return new Response(result.pdf as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': contentDisposition(`rascunho_${gise.data_inicio}.pdf`),
				'Cache-Control': 'no-cache'
			}
		});
	}

	if (format === 'produtividade') {
		if (!seccionalId) return json({ error: 'Seccional é obrigatória' }, { status: 400 });
		const { buscarRespostasProdutividadeSeccional } = await import('$lib/db');
		const { gerarRelatorioProdutividadeGisePdf } = await import('$lib/export');

		const seccional = gise.seccionais.find(
			(s: any) => s.id === seccionalId || s.seccional_id === seccionalId
		);
		if (!seccional) return json({ error: 'Seccional não encontrada' }, { status: 404 });

		// Achatar todas as equipes da seccional (de todas as unidades)
		const todasEquipes = (seccional.unidades ?? []).flatMap((u: any) => u.equipes ?? []);
		const seccionalFiltrada = equipeType
			? {
				...seccional,
				equipes: todasEquipes.filter((eq: any) => eq.tipo === equipeType)
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
		return json(
			{ error: 'Download só é liberado após a assinatura do Supervisor.' },
			{ status: 400 }
		);
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
