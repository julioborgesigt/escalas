/**
 * GET /api/gise/[id]/download?format=xlsx|pdf|extraordinario|produtividade
 *
 * Exporta a Escala GISE diária em XLSX ou PDF.
 * Permissão: Admin Geral ou Admin Seccional.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as XLSX from 'xlsx';
import { getDB, buscarGiseDetalhado, buscarPresencasGise, buscarAssinaturaRelatorioGise, buscarGiseEscala } from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { gerarPdfGise, gerarRelatorioExtraordinarioPdf } from '$lib/export';
import { getR2 } from '$lib/server/platform';
import { adicionarPaginaAuditoria } from '$lib/server/pdf-signing';

export const GET: RequestHandler = async ({ locals, params, platform, url }) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autenticado' }, { status: 401 });

	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const gise = await buscarGiseDetalhado(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	const isSupervisor = u.tipo === 'policial' && gise.supervisor_id === u.id;
	const isMembro = u.tipo === 'policial' && gise.seccionais.some(s => s.equipes.some(eq => eq.membros.some(m => m.policial_id === u.id)));

	if (!isAdminGeral(u) && !isAdminSeccional(u) && !isSupervisor && !isMembro) {
		return json({ error: 'Sem permissão para acessar downloads desta escala GISE. Você não faz parte desta equipe.' }, { status: 403 });
	}

	const format = url.searchParams.get('format') || 'xlsx';

	// RELATÓRIO DE SERVIÇO EXTRAORDINÁRIO (Prioriza Download do R2)
	if (format === 'extraordinario') {
		const secIdParam = url.searchParams.get('seccionalId');
		const seccionalId = secIdParam ? parseInt(secIdParam) : undefined;
		const r2 = getR2(platform);

		const reportSignature = seccionalId
			? await buscarAssinaturaRelatorioGise(db, id, seccionalId, 'extraordinario')
			: null;

		// 1. Se existir assinatura, baixar OBRIGATORIAMENTE do R2
		if (reportSignature?.verification_hash) {
			if (!r2) {
				return json({ error: 'R2 não configurado na plataforma.' }, { status: 500 });
			}

			try {
				const [yyyy, mm, dd_escala] = gise.data_inicio.split('-');
				const folder = `gise/${yyyy}-${mm}/${dd_escala}/${id}/relatorios_extra`;
				const r2Key = `${folder}/gise_rel_${id}_sec_${seccionalId}_${reportSignature.verification_hash}_assinada.pdf`;
				
				const r2Object = await r2.get(r2Key);
				if (r2Object) {
					const pdfBytes = await r2Object.arrayBuffer();
					const filename = `relatorio_extraordinario_${gise.data_inicio}_sec_${seccionalId}_assinado.pdf`;
					return new Response(pdfBytes, {
						headers: {
							'Content-Type': 'application/pdf',
							'Content-Disposition': `attachment; filename="${filename}"`,
							'Cache-Control': 'no-cache'
						}
					});
				} else {
					console.error(`[download-extra] Arquivo não encontrado no R2: ${r2Key}`);
					return json({ 
						error: 'O relatório assinado não foi encontrado no servidor de arquivos (R2).',
						key: r2Key 
					}, { status: 404 });
				}
			} catch (e: any) {
				console.error('[download-extra] Erro ao buscar no R2:', e);
				return json({ error: 'Erro ao recuperar o arquivo assinado do R2: ' + e.message }, { status: 500 });
			}
		}

		// 2. Se NÃO existir assinatura, permitir apenas para admins/supervisores como RASCUNHO (Fallback dinâmico)
		if (!isAdminGeral(u) && !isAdminSeccional(u) && !isSupervisor) {
			return json({ error: 'Este relatório ainda não foi assinado e você não tem permissão para ver rascunhos.' }, { status: 403 });
		}

		try {
			const presencas = await buscarPresencasGise(db, id);
			const result = await gerarRelatorioExtraordinarioPdf(gise, presencas, seccionalId, url.origin, null, undefined);
			const filename = `RASCUNHO_extraordinario_${gise.data_inicio}_sec_${seccionalId || 'geral'}.pdf`;

			return new Response(result.pdf as unknown as BodyInit, {
				headers: {
					'Content-Type': 'application/pdf',
					'Content-Disposition': `attachment; filename="${filename}"`,
					'Cache-Control': 'no-cache'
				}
			});
		} catch (err) {
			console.error(`[download-extra] Erro no fallback:`, err);
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
								'Content-Disposition': `attachment; filename="${filename}"`,
								'Cache-Control': 'no-cache'
							}
						});
					}
				} catch (e) {
					console.warn('[download-pdf] Falha ao buscar PDF assinado de R2:', e);
				}
			}
		}

		// Fallback: gerar PDF normal (rascunho ou erro no R2)
		const result = gerarPdfGise(gise);
		return new Response(result.pdf as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="rascunho_${gise.data_inicio}.pdf"`,
				'Cache-Control': 'no-cache'
			}
		});
	}

	if (format === 'produtividade') {
		const secIdParam = url.searchParams.get('seccionalId');
		if (!secIdParam) return json({ error: 'Seccional é obrigatória' }, { status: 400 });
		const seccionalId = parseInt(secIdParam);

		const { buscarRespostasProdutividadeSeccional } = await import('$lib/db');
		const { gerarRelatorioProdutividadeGisePdf } = await import('$lib/export');

		const seccional = gise.seccionais.find((s: any) => s.id === seccionalId || s.seccional_id === seccionalId);
		if (!seccional) return json({ error: 'Seccional não encontrada' }, { status: 404 });

		const respostas = await buscarRespostasProdutividadeSeccional(db, id, seccional.id);
		const result = gerarRelatorioProdutividadeGisePdf({ gise, seccional, respostas });

		const filename = `resumo_produtividade_${gise.data_inicio}_sec_${seccionalId}.pdf`;
		return new Response(result.pdf as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Cache-Control': 'no-cache'
			}
		});
	}

	if (gise.status !== 'em_andamento' && gise.status !== 'aguardando_relatorios' && gise.status !== 'aguardando_assinatura_relat' && gise.status !== 'pronta_para_finalizar' && gise.status !== 'finalizada') {
		return json(
			{ error: 'A escala ainda não foi assinada. O download só é liberado após a assinatura do Supervisor.' },
			{ status: 400 }
		);
	}

	// XLSX
	const wb = XLSX.utils.book_new();

	const resumoRows: (string | number)[][] = [
		['ESCALA GISE'],
		[`Data: ${fmtDate(gise.data_inicio)}`],
		[`Horário: ${gise.hora_entrada} às ${gise.hora_saida}`],
		[`Supervisor: ${gise.supervisor_nome ?? '—'}`],
		[`Status: ${statusLabel(gise.status)}`],
		gise.documento?.assinante_nome ? [`Assinado por: ${gise.documento.assinante_nome}`] : [],
		[],
		['Seccional', 'Unidade Operacional', 'Equipe', 'Nome', 'Cargo', 'Matrícula', 'Telefone', 'Lotação', 'Hora Entrada', 'Hora Saída']
	];

	for (const sec of gise.seccionais ?? []) {
		for (const equipe of sec.equipes ?? []) {
			for (const m of equipe.membros ?? []) {
				const hEnt = equipe.hora_entrada || sec.hora_entrada || gise.hora_entrada;
				const hSai = equipe.hora_saida || sec.hora_saida || gise.hora_saida;
				resumoRows.push([
					sec.seccional_nome,
					sec.unidade_operacional_nome ?? '—',
					equipe.tipo === 'operacional' ? 'Operacional' : 'SEINT',
					m.policial_nome,
					m.policial_cargo,
					m.policial_matricula,
					m.policial_telefone || '—',
					m.policial_lotacao ?? '—',
					hEnt,
					hSai
				]);
			}
		}
	}

	const wsResumo = XLSX.utils.aoa_to_sheet(resumoRows);
	wsResumo['!cols'] = [
		{ wch: 24 }, { wch: 24 }, { wch: 16 },
		{ wch: 30 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 30 },
		{ wch: 10 }, { wch: 10 }
	];
	XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo Geral');

	for (const sec of gise.seccionais ?? []) {
		const rows: (string | number)[][] = [
			[`SECCIONAL: ${sec.seccional_nome}`],
			[`Unidade Operacional: ${sec.unidade_operacional_nome ?? '—'}`],
			[`Status: ${sec.status === 'preenchida' ? 'Preenchida' : 'Pendente'}`],
			[]
		];

		for (const equipe of sec.equipes ?? []) {
			rows.push([`Equipe ${equipe.tipo === 'operacional' ? 'Operacional' : 'SEINT'} (${equipe.slots_dpc} DPC + ${equipe.slots_oip} OIP)`]);
			rows.push(['Nome', 'Cargo', 'Matrícula', 'Telefone', 'Lotação', 'Hora Entrada', 'Hora Saída']);
			if (equipe.membros?.length) {
				for (const m of equipe.membros) {
					const hEnt = equipe.hora_entrada || sec.hora_entrada || gise.hora_entrada;
					const hSai = equipe.hora_saida || sec.hora_saida || gise.hora_saida;
					rows.push([
						m.policial_nome, m.policial_cargo, m.policial_matricula,
						m.policial_telefone || '—', m.policial_lotacao ?? '—',
						hEnt, hSai
					]);
				}
			} else {
				rows.push(['(sem membros alocados)', '', '', '', '', '', '']);
			}
			rows.push([]);
		}

		const ws = XLSX.utils.aoa_to_sheet(rows);
		ws['!cols'] = [
			{ wch: 30 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 30 },
			{ wch: 10 }, { wch: 10 }
		];
		XLSX.utils.book_append_sheet(wb, ws, sec.seccional_nome.slice(0, 31));
	}

	const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
	const filename = `gise_${gise.data_inicio}.xlsx`;

	return new Response(buffer as unknown as BodyInit, {
		status: 200,
		headers: {
			'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-cache'
		}
	});
};

function fmtDate(iso: string): string {
	if (!iso) return '';
	const [y, m, d] = iso.split('-');
	return `${d}/${m}/${y}`;
}

function statusLabel(status: string): string {
	const m: Record<string, string> = {
		em_definicao_supervisor: 'Em definição do supervisor',
		em_preenchimento: 'Preenchendo escalados',
		aguardando_assinatura: 'Aguardando assinatura do supervisor',
		em_andamento: 'GISE em operação',
		aguardando_relatorios: 'Aguardando relatórios',
		aguardando_assinatura_relat: 'Aguardando assinatura dos Rel. de Extra',
		pronta_para_finalizar: 'Pronta para finalizar',
		finalizada: 'Concluída'
	};
	return m[status] ?? status;
}
