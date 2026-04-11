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

export const GET: RequestHandler = async ({ locals, params, platform, url }) => {
	const u = locals.usuario;
	if (!u) return json({ error: 'Não autenticado' }, { status: 401 });

	// Validação de Parâmetros
	const paramParsed = giseIdParamSchema.safeParse(params);
	if (!paramParsed.success) {
		return json({ error: paramParsed.error.errors[0].message }, { status: 400 });
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
			s.equipes.some((eq) => eq.membros.some((m) => m.policial_id === u.id))
		);

	if (!isAdminGeral(u) && !isAdminSeccional(u) && !isSupervisor && !isMembro) {
		return json(
			{ error: 'Sem permissão para acessar downloads desta escala GISE.' },
			{ status: 403 }
		);
	}

	// RELATÓRIO DE SERVIÇO EXTRAORDINÁRIO (Prioriza Download do R2)
	if (format === 'extraordinario') {
		const r2 = getR2(platform);

		const reportSignature = seccionalId
			? await buscarAssinaturaRelatorioGise(db, id, seccionalId, 'extraordinario')
			: null;

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
							'Content-Disposition': `attachment; filename="${filename}"`,
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
			const { gerarRelatorioExtraordinarioPdf } = await import('$lib/export');
			const result = await gerarRelatorioExtraordinarioPdf(
				gise,
				presencas,
				seccionalId,
				url.origin,
				null,
				undefined
			);
			const filename = `RASCUNHO_extraordinario_${gise.data_inicio}_sec_${seccionalId || 'geral'}.pdf`;

			return new Response(result.pdf as unknown as BodyInit, {
				headers: {
					'Content-Type': 'application/pdf',
					'Content-Disposition': `attachment; filename="${filename}"`,
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

		// Fallback: gerar PDF normal
		const { gerarPdfGise } = await import('$lib/export');
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
		if (!seccionalId) return json({ error: 'Seccional é obrigatória' }, { status: 400 });
		const { buscarRespostasProdutividadeSeccional } = await import('$lib/db');
		const { gerarRelatorioProdutividadeGisePdf } = await import('$lib/export');

		const seccional = gise.seccionais.find(
			(s: any) => s.id === seccionalId || s.seccional_id === seccionalId
		);
		if (!seccional) return json({ error: 'Seccional não encontrada' }, { status: 404 });

		const seccionalFiltrada = equipeType
			? {
					...seccional,
					equipes: (seccional.equipes || []).filter((eq: any) => eq.tipo === equipeType)
				}
			: seccional;

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
				'Content-Disposition': `attachment; filename="${filename}"`,
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

	// XLSX
	const XLSX = await import('xlsx');
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
