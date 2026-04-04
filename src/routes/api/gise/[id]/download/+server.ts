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
	const isMembro = u.tipo === 'policial' && gise.seccionais.some(s => s.equipes.some(eq => eq.membros.some(m => m.policial_id === u.id)));

	if (!isAdminGeral(u) && !isAdminSeccional(u) && !isSupervisor && !isMembro) {
		return json({ error: 'Sem permissão para acessar downloads desta escala GISE. Você não faz parte desta equipe.' }, { status: 403 });
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

			// Coletar assinantes para o Manifesto Misto (Audit Trail)
			const signers: any[] = [];
			const p = platform as any;
			const r2 = p?.env?.escalas_docs;

			// 1. Adicionar Assinaturas dos Policiais (Entradas e Saídas)
			// Filtrar presenças apenas da seccional se seccionalId estiver definido
			const presencasFiltradas = seccionalId 
				? presencas.filter(pr => {
					// Precisamos saber se o policial pertence a uma equipe desta seccional
					const membro = gise.seccionais.find(s => s.seccional_id === seccionalId)
						?.equipes.flatMap(e => e.membros)
						.find(m => m.policial_id === pr.policial_id);
					return !!membro;
				})
				: presencas;

			// Fetch all selfies in parallel instead of sequentially
			const selfieKeys: Array<{ key: string; type: 'entrada' | 'saida'; prId: number }> = [];
			for (const pr of presencasFiltradas) {
				if (pr.entrada_rubrica && pr.entrada_selfie_key && r2) {
					selfieKeys.push({ key: pr.entrada_selfie_key, type: 'entrada', prId: pr.id });
				}
				if (pr.saida_rubrica && pr.saida_selfie_key && r2) {
					selfieKeys.push({ key: pr.saida_selfie_key, type: 'saida', prId: pr.id });
				}
			}

			const selfieResults = await Promise.all(
				selfieKeys.map(async ({ key, type, prId }) => {
					try {
						const obj = await r2.get(key);
						if (obj) {
							const buf = await obj.arrayBuffer();
							return { prId, type, data: `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}` };
						}
					} catch {}
					return { prId, type, data: undefined };
				})
			);

			const selfieMap = new Map<string, string | undefined>();
			for (const r of selfieResults) {
				selfieMap.set(`${r.prId}-${r.type}`, r.data);
			}

			for (const pr of presencasFiltradas) {
				if (pr.entrada_rubrica) {
					signers.push({
						signerName: `${pr.policial_nome} (ENTRADA)`,
						signerCpf: pr.policial_cpf ?? undefined,
						signingTime: new Date(pr.entrada_timestamp || Date.now()),
						verificationHash: `PRES-${pr.id}-E`,
						verificationUrl: `${url.origin}/validar/PRES-${pr.id}-E`,
						ip: pr.ip_address ?? undefined,
						userAgent: pr.user_agent ?? undefined,
						latitude: pr.latitude ?? undefined,
						longitude: pr.longitude ?? undefined,
						rubricBase64: pr.entrada_rubrica ?? undefined,
						selfieBase64: selfieMap.get(`${pr.id}-entrada`),
						documentHash: '',
						signatureLevel: 'avancada',
						documentName: `Relatório Extraordinário - GISE ${id}`
					});
				}
				if (pr.saida_rubrica) {
					signers.push({
						signerName: `${pr.policial_nome} (SAÍDA)`,
						signerCpf: pr.policial_cpf ?? undefined,
						signingTime: new Date(pr.saida_timestamp || Date.now()),
						verificationHash: `PRES-${pr.id}-S`,
						verificationUrl: `${url.origin}/validar/PRES-${pr.id}-S`,
						ip: pr.ip_address ?? undefined,
						userAgent: pr.user_agent ?? undefined,
						latitude: pr.latitude ?? undefined,
						longitude: pr.longitude ?? undefined,
						rubricBase64: pr.saida_rubrica ?? undefined,
						selfieBase64: selfieMap.get(`${pr.id}-saida`),
						documentHash: '',
						signatureLevel: 'avancada',
						documentName: `Relatório Extraordinário - GISE ${id}`
					});
				}
			}

			// 2. Adicionar Assinatura do Supervisor (Relatório)
			if (reportSignature && reportSignature.verification_hash) {
				let supervisorSelfie: string | undefined = undefined;
				if (r2 && (reportSignature as any).selfie_key) {
					const obj = await r2.get((reportSignature as any).selfie_key);
					if (obj) {
						const buffer = await obj.arrayBuffer();
						supervisorSelfie = Buffer.from(buffer).toString('base64');
					}
				}
				signers.push({
					signerName: reportSignature.assinante_nome,
					signerCpf: reportSignature.assinante_cpf ?? undefined,
					signingTime: new Date(reportSignature.created_at || Date.now()),
					verificationHash: reportSignature.verification_hash,
					verificationUrl: `${url.origin}/validar/${reportSignature.verification_hash}`,
					ip: (reportSignature as any).ip_address,
					userAgent: (reportSignature as any).user_agent,
					latitude: (reportSignature as any).latitude,
					longitude: (reportSignature as any).longitude,
					rubricBase64: reportSignature.rubrica || undefined,
					selfieBase64: supervisorSelfie,
					signatureLevel: reportSignature.tipo_assinatura === 'simples' ? 'avancada' : 'qualificada'
				});
			}

			if (signers.length > 0) {
				finalPdf = await adicionarPaginaAuditoria(finalPdf, signers);
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
