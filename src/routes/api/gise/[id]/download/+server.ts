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

	if (!isAdminGeral(u) && !isAdminSeccional(u) && !isSupervisor && u.tipo !== 'policial') {
		return json({ error: 'Sem permissão para acessar downloads desta escala GISE' }, { status: 403 });
	}

	const format = url.searchParams.get('format') || 'xlsx';

	// RELATÓRIO DE SERVIÇO EXTRAORDINÁRIO
	if (format === 'extraordinario') {
		const secIdParam = url.searchParams.get('seccionalId');
		const seccionalId = secIdParam ? parseInt(secIdParam) : undefined;

		const presencas = await buscarPresencasGise(db, id);

		const reportSignature = seccionalId
			? await buscarAssinaturaRelatorioGise(db, id, seccionalId, 'extraordinario')
			: null;

		if (!isAdminGeral(u) && !isAdminSeccional(u) && !isSupervisor && !reportSignature) {
			return json({ error: 'Este relatório ainda não foi assinado pelo supervisor.' }, { status: 403 });
		}

		const secSuffix = seccionalId ? `_sec_${seccionalId}` : '';
		const filename = `relatorio_extraordinario_${gise.data_inicio}${secSuffix}.pdf`;

		// Tentar buscar no R2 (independente de ser token ou manual)
		if (reportSignature?.verification_hash) {
			const p = platform as any;
			const r2 = p?.env?.escalas_docs;
			if (r2) {
				try {
					const [yyyy, mm, dd_escala] = gise.data_inicio.split('-');
					const mesAno = `${yyyy}-${mm}`;
					const folder = `gise/${mesAno}/${dd_escala}/${id}/relatorios_extra`;
					const r2Key = `${folder}/gise_rel_${id}_sec_${seccionalId}_${reportSignature.verification_hash}_assinada.pdf`;
					
					const r2Object = await r2.get(r2Key);
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
					console.warn('[download-extraordinario] Falha ao buscar PDF do R2:', e);
				}
			}
		}

		// Fallback: gerar via jsPDF (assinatura simples ou PDF não encontrado no R2)
		let qrCodeBase64: string | undefined;
		if (reportSignature?.verification_hash) {
			try {
				const QRCode = await import('qrcode');
				const qrUrl = `${url.origin}/validar/${reportSignature.verification_hash}`;
				qrCodeBase64 = await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'H' });
			} catch (e) {
				console.warn('[download-extraordinario] Falha ao gerar QR code, prosseguindo sem ele:', e);
			}
		}

		try {
			const result = await gerarRelatorioExtraordinarioPdf(gise, presencas, seccionalId, url.origin, reportSignature, qrCodeBase64);
			let finalPdf = result.pdf;

			// Fallback: Adicionar manifesto se tiver dados de assinatura mas PDF não estava no R2
			if (reportSignature && reportSignature.verification_hash) {
				finalPdf = await adicionarPaginaAuditoria(finalPdf, {
					signerName: reportSignature.assinante_nome,
					signerCpf: reportSignature.assinante_cpf ?? undefined,
					signingTime: new Date(reportSignature.created_at || Date.now()),
					verificationHash: reportSignature.verification_hash,
					verificationUrl: `${url.origin}/validar/${reportSignature.verification_hash}`,
					ip: (reportSignature as any).ip_address,
					userAgent: (reportSignature as any).user_agent,
					latitude: (reportSignature as any).latitude,
					longitude: (reportSignature as any).longitude,
					selfieBase64: (reportSignature as any).selfie_key ? undefined : undefined,
					signatureLevel: 'avancada'
				});
			}

			return new Response(finalPdf as any, {
				headers: {
					'Content-Type': 'application/pdf',
					'Content-Disposition': `attachment; filename="${filename}"`,
					'Cache-Control': 'no-cache'
				}
			});
		} catch (err) {
			console.error(`[download-extraordinario] Erro ao gerar PDF — GISE ${id}, seccional ${seccionalId}:`, err);
			return json({ error: 'Erro ao gerar o PDF do relatório extraordinário.' }, { status: 500 });
		}
	}


	if (format === 'pdf') {
		const filename = `gise_${gise.data_inicio}_assinada.pdf`;
		
		// Prioridade total: buscar o PDF assinado (com manifesto) no R2
		if (gise.documento?.r2_key) {
			const p = platform as any;
			const r2 = p?.env?.escalas_docs;
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
		return new Response(result.pdf as any, {
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
		return new Response(result.pdf as any, {
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
