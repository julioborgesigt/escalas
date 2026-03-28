/**
 * GET /api/gise/[id]/download?format=xlsx|pdf
 *
 * Exporta a Escala GISE em XLSX ou PDF (sem assinatura digital).
 *
 * Permissão: Admin Geral ou Admin Seccional.
 * Para XLSX/PDF assinado: download só é liberado após assinatura.
 * Para PDF sem assinatura: disponível a qualquer momento para admins.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as XLSX from 'xlsx';
import { getDB, buscarGiseDetalhado, buscarPresencasGise } from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { gerarPdfGise, gerarRelatorioExtraordinarioPdf } from '$lib/export';

export const GET: RequestHandler = async ({ locals, params, platform, url }) => {
	const u = locals.usuario;
	if (!u || (!isAdminGeral(u) && !isAdminSeccional(u))) {
		return json({ error: 'Sem permissão para baixar a escala GISE' }, { status: 403 });
	}

	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'ID inválido' }, { status: 400 });

	const db = getDB(platform);
	const gise = await buscarGiseDetalhado(db, id);
	if (!gise) return json({ error: 'Escala GISE não encontrada' }, { status: 404 });

	const format = url.searchParams.get('format') || 'xlsx';

	// RELATÓRIO DE SERVIÇO EXTRAORDINÁRIO (Com rubricas)
	if (format === 'extraordinario') {
		const diaParam = url.searchParams.get('dia') as 'sabado' | 'domingo';
		if (!diaParam) return json({ error: 'Dia é obrigatório para o relatório extraordinário' }, { status: 400 });
		
		const secIdParam = url.searchParams.get('seccionalId');
		const seccionalId = secIdParam ? parseInt(secIdParam) : undefined;
		
		const presencas = await buscarPresencasGise(db, id, diaParam);
		const result = await gerarRelatorioExtraordinarioPdf(gise, diaParam, presencas, seccionalId, url.origin);
		
		const secSuffix = seccionalId ? `_sec_${seccionalId}` : '';
		const filename = `relatorio_extraordinario_${gise.data_inicio}_${diaParam}${secSuffix}.pdf`;
		return new Response(result.pdf as any, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Cache-Control': 'no-cache'
			}
		});
	}

	// PDF sem assinatura pode ser gerado a qualquer momento
	if (format === 'pdf') {
		const diaParam = url.searchParams.get('dia') as 'sabado' | 'domingo' | 'ambos' || 'ambos';
		const result = gerarPdfGise(gise, diaParam === 'ambos' ? undefined : diaParam as 'sabado' | 'domingo');
		const filename = `gise_${gise.data_inicio}_${diaParam}.pdf`;
		return new Response(result.pdf as any, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Cache-Control': 'no-cache'
			}
		});
	}

	if (format === 'produtividade') {
		const diaParam = url.searchParams.get('dia') as 'sabado' | 'domingo';
		if (!diaParam) return json({ error: 'Dia é obrigatório' }, { status: 400 });
		
		const secIdParam = url.searchParams.get('seccionalId');
		if (!secIdParam) return json({ error: 'Seccional é obrigatória' }, { status: 400 });
		const seccionalId = parseInt(secIdParam);

		const { buscarRespostasProdutividadeSeccional } = await import('$lib/db');
		const { gerarRelatorioProdutividadeGisePdf } = await import('$lib/export');

		const seccional = gise.seccionais.find((s: any) => s.id === seccionalId || s.seccional_id === seccionalId);
		if (!seccional) return json({ error: 'Seccional não encontrada' }, { status: 404 });

		const respostas = await buscarRespostasProdutividadeSeccional(db, id, seccional.id, diaParam);
		const doc = gerarRelatorioProdutividadeGisePdf({ gise, seccional, dia: diaParam, respostas });
		
		const filename = `resumo_produtividade_${gise.data_inicio}_${diaParam}_sec_${seccionalId}.pdf`;
		return new Response(doc.output('arraybuffer') as any, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Cache-Control': 'no-cache'
			}
		});
	}
	if (gise.status !== 'assinada' && gise.status !== 'finalizada') {
		return json(
			{ error: 'A escala ainda não foi assinada. O download só é liberado após a assinatura do Supervisor.' },
			{ status: 400 }
		);
	}

	const wb = XLSX.utils.book_new();

	// Aba de resumo geral
	const resumoRows: (string | number)[][] = [
		['ESCALA GISE'],
		[`Período: ${fmtDate(gise.data_inicio)} (Sábado) a ${fmtDate(gise.data_fim)} (Domingo)`],
		[`Horário: ${gise.hora_entrada}h às ${gise.hora_saida}h`],
		[`Supervisor Sábado: ${gise.supervisor_sabado_nome ?? '—'}`],
		[`Supervisor Domingo: ${gise.supervisor_domingo_nome ?? '—'}`],
		[`Status: ${statusLabel(gise.status)}`],
		gise.documentos.sabado?.assinante_nome ? [`Assinado Sábado por: ${gise.documentos.sabado.assinante_nome}`] : [],
		gise.documentos.domingo?.assinante_nome ? [`Assinado Domingo por: ${gise.documentos.domingo.assinante_nome}`] : [],
		[],
		['Seccional', 'Unidade Operacional', 'Equipe', 'Nome', 'Cargo', 'Matrícula', 'Telefone', 'Lotação', 'Data de Início', 'Hora de Início', 'Data de Término', 'Hora de Término']
	];

	const pushMembroRows = (target: (string | number)[][], s: any, e: any, m: any, prefixColumns: (string | number)[] = []) => {
		const dias = m.dia === 'ambos' ? ['sabado', 'domingo'] : [m.dia];
		for (const d of dias) {
			const dataEf = d === 'sabado' ? gise.data_inicio : gise.data_fim;
			const hEnt = e[`hora_entrada_${d}`] || s[`hora_entrada_${d}`] || (gise as any)[`hora_entrada_${d}`] || gise.hora_entrada;
			const hSai = e[`hora_saida_${d}`] || s[`hora_saida_${d}`] || (gise as any)[`hora_saida_${d}`] || gise.hora_saida;
			
			target.push([
				...prefixColumns,
				m.policial_nome,
				m.policial_cargo,
				m.policial_matricula,
				m.policial_telefone || '—',
				m.policial_lotacao,
				fmtDate(dataEf),
				fmtHora(hEnt),
				fmtDate(dataEf),
				fmtHora(hSai)
			]);
		}
	};

	for (const sec of gise.seccionais ?? []) {
		for (const equipe of sec.equipes ?? []) {
			for (const membro of equipe.membros ?? []) {
				pushMembroRows(resumoRows, sec, equipe, membro, [
					sec.seccional_nome,
					sec.unidade_operacional_nome ?? '—',
					equipe.tipo === 'operacional' ? 'Operacional' : 'SEINT'
				]);
			}
		}
	}

	const wsResumo = XLSX.utils.aoa_to_sheet(resumoRows);
	// Largura das colunas
	wsResumo['!cols'] = [
		{ wch: 24 }, { wch: 24 }, { wch: 16 },
		{ wch: 30 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 30 },
		{ wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 }
	];
	XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo Geral');

	// Uma aba por seccional
	for (const sec of gise.seccionais ?? []) {
		const rows: (string | number)[][] = [
			[`SECCIONAL: ${sec.seccional_nome}`],
			[`Unidade Operacional: ${sec.unidade_operacional_nome ?? '—'}`],
			[`Status: ${sec.status === 'preenchida' ? 'Preenchida' : 'Pendente'}`],
			[]
		];

		for (const equipe of sec.equipes ?? []) {
			rows.push([`Equipe ${equipe.tipo === 'operacional' ? 'Operacional' : 'SEINT'} (${equipe.slots_dpc} DPC + ${equipe.slots_oip} OIP)`]);
			rows.push(['Nome', 'Cargo', 'Matrícula', 'Telefone', 'Lotação', 'Data de Início', 'Hora de Início', 'Data de Término', 'Hora de Término']);
			if (equipe.membros?.length) {
				for (const m of equipe.membros) {
					pushMembroRows(rows, sec, equipe, m);
				}
			} else {
				rows.push(['(sem membros alocados)', '', '', '', '', '', '', '', '']);
			}
			rows.push([]);
		}

		const ws = XLSX.utils.aoa_to_sheet(rows);
		ws['!cols'] = [
			{ wch: 30 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 30 },
			{ wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 10 }
		];
		// Truncar nome da aba para 31 caracteres (limite do XLSX)
		const nomAba = sec.seccional_nome.slice(0, 31);
		XLSX.utils.book_append_sheet(wb, ws, nomAba);
	}

	const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
	const filename = `gise_${gise.data_inicio}.xlsx`;

	return new Response(buffer as any, {
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

function fmtHora(h: any): string {
	const n = parseInt(String(h ?? ''));
	if (isNaN(n)) return String(h ?? '');
	return `${String(n).padStart(2, '0')}:00`;
}

function diaLabel(dia: string): string {
	if (dia === 'sabado') return 'Sábado';
	if (dia === 'domingo') return 'Domingo';
	return 'Sáb + Dom';
}

function statusLabel(status: string): string {
	const m: Record<string, string> = {
		em_preenchimento: 'Em Preenchimento',
		aguardando_assinatura: 'Aguardando Assinatura',
		assinada: 'Assinada',
		finalizada: 'Finalizada'
	};
	return m[status] ?? status;
}
