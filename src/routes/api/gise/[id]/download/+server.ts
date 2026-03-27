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
import { getDB, buscarGiseDetalhado } from '$lib/db';
import { isAdminGeral, isAdminSeccional } from '$lib/auth';
import { gerarPdfGise } from '$lib/export';

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

	// PDF sem assinatura pode ser gerado a qualquer momento
	if (format === 'pdf') {
		const result = gerarPdfGise(gise);
		const filename = `gise_${gise.data_inicio}.pdf`;
		return new Response(result.pdf as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Cache-Control': 'no-cache'
			}
		});
	}

	// XLSX requer assinatura
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
		gise.documento?.assinante_nome ? [`Assinado por: ${gise.documento.assinante_nome}`] : [],
		[],
		['Seccional', 'Unidade Operacional', 'Equipe', 'Nome', 'Cargo', 'Matrícula', 'Dia']
	];

	for (const sec of gise.seccionais ?? []) {
		for (const equipe of sec.equipes ?? []) {
			for (const membro of equipe.membros ?? []) {
				resumoRows.push([
					sec.seccional_nome,
					sec.unidade_operacional_nome ?? '—',
					equipe.tipo === 'operacional' ? 'Operacional' : 'SEINT',
					membro.policial_nome,
					membro.policial_cargo,
					membro.policial_matricula,
					diaLabel(membro.dia)
				]);
			}
		}
	}

	const wsResumo = XLSX.utils.aoa_to_sheet(resumoRows);
	// Largura das colunas
	wsResumo['!cols'] = [
		{ wch: 24 }, { wch: 24 }, { wch: 16 },
		{ wch: 30 }, { wch: 8 }, { wch: 14 }, { wch: 12 }
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
			rows.push(['Nome', 'Cargo', 'Matrícula', 'Dia']);
			if (equipe.membros?.length) {
				for (const m of equipe.membros) {
					rows.push([m.policial_nome, m.policial_cargo, m.policial_matricula, diaLabel(m.dia)]);
				}
			} else {
				rows.push(['(sem membros alocados)', '', '', '']);
			}
			rows.push([]);
		}

		const ws = XLSX.utils.aoa_to_sheet(rows);
		ws['!cols'] = [{ wch: 30 }, { wch: 8 }, { wch: 14 }, { wch: 12 }];
		// Truncar nome da aba para 31 caracteres (limite do XLSX)
		const nomAba = sec.seccional_nome.slice(0, 31);
		XLSX.utils.book_append_sheet(wb, ws, nomAba);
	}

	const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
	const filename = `gise_${gise.data_inicio}.xlsx`;

	return new Response(buffer, {
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
