import { eq, and, desc, sql, type SQL } from 'drizzle-orm';
import {
	giseEscalas,
	giseSeccionais,
	giseEquipes,
	giseMembros,
	giseModeloFormulario,
	giseRespostasFormulario,
	unidades
} from '../../server/schema';
import type { Database } from '../core';

import { logger } from '../../server/logger';

import { parseRespostasFormularioJsonLoose } from '../../schemas/gise-respostas-form';

/** Pergunta de um modelo de formulário GISE (operacional ou SEINT). */
interface PerguntaModelo {
	id: number;
	texto: string;
	tipo: string;
	key: string;
	filhos: PerguntaModelo[];
	subtexto_qtd?: string;
	subtexto_lista?: string;
	subtexto_tipo?: string;
}

// ---- Formulário de Produtividade ----

const DEFAULT_QUESTIONS = [
	{ id: 1, texto: '1. VTR E PLACA', tipo: 'vtr_placa', key: 'vtr_placa', filhos: [] },
	{ id: 2, texto: '2. KM INICIAL', tipo: 'numero', key: 'km_inicial', filhos: [] },
	{ id: 3, texto: '3. KM FINAL', tipo: 'numero', key: 'km_final', filhos: [] },
	{
		id: 4,
		texto: '4. HOUVE PROCEDIMENTOS EM FLAGRANTE REALIZADOS?',
		tipo: 'prisoes_maiores',
		key: 'procedimentos_flagrante_bool',
		subtexto_qtd: '4.1 QUANTIDADE:',
		subtexto_lista: '4.2 INFORMAR NOMES E PROCEDIMENTOS:',
		filhos: []
	},
	{
		id: 5,
		texto: '5. MANDADOS CUMPRIDOS (MAIORES)',
		tipo: 'mandados_maiores',
		key: 'mandados_cumpridos',
		filhos: []
	},
	{
		id: 6,
		texto: '6. APREENSÕES CUMPRIDAS (MENORES)',
		tipo: 'apreensoes_menores',
		key: 'apreensoes_cumpridas',
		filhos: []
	},
	{
		id: 7,
		texto: '7. PRISÕES/APREENSÕES FLAGRANTE',
		tipo: 'select_99',
		key: 'prisoes_apreensoes_flagrante',
		filhos: []
	},
	{
		id: 8,
		texto: '8. TENTATIVA CUMPRIMENTO MANDADO',
		tipo: 'sim_nao',
		key: 'tentativa_mandado',
		filhos: []
	},
	{
		id: 9,
		texto: '9. MANDADO BUSCA E APREENSÃO',
		tipo: 'sim_nao',
		key: 'busca_apreensao',
		filhos: []
	},
	{
		id: 10,
		texto: '10. APREENSÃO DE DROGAS',
		tipo: 'drogas_complex',
		key: 'apreensoes_drogas',
		filhos: []
	},
	{
		id: 11,
		texto: '11. HOUVE APREENSÃO DE ARMAS/MUNIÇÕES?',
		tipo: 'armas_complex',
		key: 'apreensoes_armas_bool',
		subtexto_tipo: '11.1 TIPO DE ARMA:',
		subtexto_qtd: '11.1.1 QUANTIDADE:',
		filhos: []
	},
	{ id: 12, texto: '12. LOCAL DE CRIME', tipo: 'select_99', key: 'local_crime', filhos: [] },
	{
		id: 13,
		texto: '13. ORDEM DE MISSÃO CUMPRIDA',
		tipo: 'select_99',
		key: 'ordem_missao',
		filhos: []
	},
	{
		id: 14,
		texto: '14. LEVANTAMENTO DE ALVOS',
		tipo: 'select_99',
		key: 'levantamento_alvos',
		filhos: []
	},
	{ id: 15, texto: '15. OITIVAS REALIZADAS', tipo: 'select_99', key: 'oitivas', filhos: [] },
	{
		id: 16,
		texto: '16. REPRESENTAÇÃO PRISÃO',
		tipo: 'select_99',
		key: 'representacao_prisao',
		filhos: []
	},
	{
		id: 17,
		texto: '17. REPRESENTAÇÃO BUSCA',
		tipo: 'select_99',
		key: 'representacao_busca',
		filhos: []
	},
	{ id: 18, texto: '18. Nº ABORDAGENS', tipo: 'select_99', key: 'abordagens', filhos: [] },
	{ id: 19, texto: '19. RESUMO DILIGÊNCIAS', tipo: 'textarea', key: 'descricao', filhos: [] }
];

/**
 * Modelo padrão do formulário SEINT — fonte ÚNICA, usada como fallback tanto
 * aqui (agregação/relatórios) quanto no load de `/res-gise` (UI do formulário
 * e botão "restaurar padrão"). Antes existia uma cópia idêntica de 122 linhas
 * na página (achado 11.3 do docs/ARQUIVOS.md).
 */
export const DEFAULT_SEINT_QUESTIONS = [
	{
		id: 1,
		texto: '1. Houve EXTRAÇÃO DE DADOS DE APARELHOS CELULARES?',
		tipo: 'sim_nao',
		key: 'extracao_celulares',
		filhos: [
			{
				id: 101,
				texto: '1.1 Quantidade de aparelhos analisados (1 a 99)',
				tipo: 'numero',
				key: 'extracao_qtd',
				filhos: []
			},
			{
				id: 102,
				texto: '1.2 Listagem de aparelhos analisados (Modelo, Nº proc, Delegacia, Concluída)',
				tipo: 'textarea',
				key: 'extracao_lista',
				filhos: []
			}
		]
	},
	{
		id: 2,
		texto: '2. Houve ANÁLISE DE DADOS DE EXTRAÇÃO?',
		tipo: 'sim_nao',
		key: 'analise_extracao',
		filhos: [
			{
				id: 201,
				texto: '2.1 Quantidade de aparelhos analisados (1 a 99)',
				tipo: 'numero',
				key: 'analise_qtd',
				filhos: []
			},
			{
				id: 202,
				texto: '2.2 Listagem de aparelhos analisados (Tamanho, Modelo, Nº proc, Delegacia)',
				tipo: 'textarea',
				key: 'analise_lista',
				filhos: []
			}
		]
	},
	{
		id: 3,
		texto: '3. Houve PRODUÇÃO DE RELATÓRIOS?',
		tipo: 'sim_nao',
		key: 'producao_relatorios',
		filhos: [
			{
				id: 301,
				texto: '3.1 Quantidade de relatórios produzidos (1 a 99)',
				tipo: 'numero',
				key: 'relatorios_qtd',
				filhos: []
			},
			{
				id: 302,
				texto:
					'3.2 Listagem de relatórios produzidos (Nº Relatório, Alvos, Proc. Vinculado, Delegacia)',
				tipo: 'textarea',
				key: 'relatorios_lista',
				filhos: []
			}
		]
	},
	{
		id: 4,
		texto: '4. Houve LEVANTAMENTO DE DADOS DE ALVOS FORAGIDOS?',
		tipo: 'sim_nao',
		key: 'levantamento_foragidos',
		filhos: [
			{
				id: 401,
				texto: '4.1 Quantidade de levantamentos produzidos (1 a 99)',
				tipo: 'numero',
				key: 'levantamentos_qtd',
				filhos: []
			},
			{
				id: 402,
				texto:
					'4.2 Listagem de relatórios produzidos (Nome do Alvo, Proc. Vinculado, Delegacia, Resultado)',
				tipo: 'textarea',
				key: 'levantamentos_lista',
				filhos: []
			}
		]
	},
	{
		id: 5,
		texto: '5. Houve INTERCEPTAÇÃO TELEFÔNICA?',
		tipo: 'sim_nao',
		key: 'interceptacao_tel',
		filhos: [
			{
				id: 501,
				texto: '5.1 Quantidade de INTERCEPTAÇÃO TELEFÔNICA (1 a 99)',
				tipo: 'numero',
				key: 'interceptacao_qtd',
				filhos: []
			},
			{
				id: 502,
				texto: '5.2 Existem OPERAÇÕES que necessitaram de acompanhamento?',
				tipo: 'sim_nao',
				key: 'operacoes_acompanhamento_bool',
				filhos: [
					{
						id: 503,
						texto: '5.2.1 Listagem de OPERAÇÕES (Nome da operação e Delegacia de origem)',
						tipo: 'textarea',
						key: 'operacoes_lista',
						filhos: []
					}
				]
			}
		]
	}
];

export async function buscarRespostasProdutividadeSeccional(
	db: Database,
	giseId: number,
	seccionalId: number
) {
	const [configRows, rows] = await Promise.all([
		db.select().from(giseModeloFormulario).all(),
		db
			.select({
				equipe_id: giseRespostasFormulario.equipe_id,
				respostas: giseRespostasFormulario.respostas,
				equipe_tipo: giseEquipes.tipo
			})
			.from(giseRespostasFormulario)
			.innerJoin(giseEquipes, eq(giseRespostasFormulario.equipe_id, giseEquipes.id))
			.where(
				and(
					eq(giseRespostasFormulario.gise_id, giseId),
					eq(giseEquipes.gise_seccional_id, seccionalId)
				)
			)
			.all()
	]);
	const modelosMap = new Map<string, PerguntaModelo[]>();
	configRows.forEach((row) => {
		try {
			modelosMap.set(row.tipo, JSON.parse(row.config));
		} catch (err) {
			logger.error('[gise] parse modelo formulário', { tipo: row.tipo, err: String(err) });
		}
	});

	const allResults: { equipe_id: number; pergunta: string; resposta: string }[] = [];

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- resps is a dynamic untyped JSON blob; narrowing every access would change logic
	const processarPerguntas = (listaPerguntas: PerguntaModelo[], resps: any, eqId: number) => {
		for (const p of listaPerguntas) {
			const resp = resps[p.key] ?? resps[String(p.id)] ?? resps[p.id];
			if (resp !== undefined && resp !== null && resp !== '') {
				allResults.push({ equipe_id: eqId, pergunta: p.texto, resposta: String(resp) });

				const isSim = String(resp).toLowerCase() === 'sim' || resp === true;

				if (isSim || p.tipo === 'operacoes_seint_pura') {
					if (p.tipo === 'mandados_maiores' && resps.mandados_lista) {
						(resps.mandados_lista as { nome?: string; mandado?: string }[]).forEach((item, idx) => {
							if (item.nome || item.mandado) {
								allResults.push({
									equipe_id: eqId,
									pergunta: `  ↳ Mandado ${idx + 1}`,
									resposta: `${item.nome} - ${item.mandado}`
								});
							}
						});
					}
					if (p.tipo === 'prisoes_maiores' && resps.prisoes_lista) {
						(resps.prisoes_lista as { nome?: string; mandado?: string }[]).forEach((item, idx) => {
							if (item.nome || item.mandado) {
								allResults.push({
									equipe_id: eqId,
									pergunta: `  ↳ Procedimento ${idx + 1}`,
									resposta: `${item.nome} - ${item.mandado}`
								});
							}
						});
					}
					if (p.tipo === 'armas_complex' && resps.armas_detalhe) {
						Object.entries(resps.armas_detalhe).forEach(([tipo, qtd]) => {
							if (Number(qtd) > 0) {
								allResults.push({
									equipe_id: eqId,
									pergunta: `  ↳ Arma: ${tipo}`,
									resposta: `${qtd}`
								});
							}
						});
					}
					if (p.tipo === 'apreensoes_menores' && resps.apreensoes_lista) {
						(resps.apreensoes_lista as { nome?: string; mandado?: string }[]).forEach(
							(item, idx) => {
								if (item.nome || item.mandado) {
									allResults.push({
										equipe_id: eqId,
										pergunta: `  ↳ Apreensão ${idx + 1}`,
										resposta: `${item.nome} - ${item.mandado}`
									});
								}
							}
						);
					}
					if (p.tipo === 'drogas_complex' && resps.drogas_selecionadas) {
						resps.drogas_selecionadas.forEach((d: string) => {
							const peso = resps.drogas_detalhe?.[d] || '0';
							const unid = resps.drogas_unidade?.[d] || 'g';
							allResults.push({
								equipe_id: eqId,
								pergunta: `  ↳ Droga: ${d}`,
								resposta: `${peso}${unid}`
							});
						});
					}
					// SEINT Complex Types
					if (p.tipo === 'celulares_complex' && resps.celulares_lista) {
						(resps.celulares_lista as { modelo?: string; n_proc?: string }[]).forEach(
							(item, idx) => {
								if (item.modelo || item.n_proc) {
									allResults.push({
										equipe_id: eqId,
										pergunta: `  ↳ Aparelho ${idx + 1}`,
										resposta:
											`${item.modelo || ''} ${item.n_proc ? '(Proc: ' + item.n_proc + ')' : ''}`.trim()
									});
								}
							}
						);
					}
					if (p.tipo === 'analise_complex' && resps.analise_lista) {
						(
							resps.analise_lista as { modelo?: string; n_proc?: string; tamanho?: string }[]
						).forEach((item, idx) => {
							if (item.modelo || item.n_proc) {
								allResults.push({
									equipe_id: eqId,
									pergunta: `  ↳ Análise ${idx + 1}`,
									resposta:
										`${item.modelo || ''} ${item.tamanho ? '[' + item.tamanho + ']' : ''} ${item.n_proc ? '(Proc: ' + item.n_proc + ')' : ''}`.trim()
								});
							}
						});
					}
					if (p.tipo === 'relatorios_seint_complex' && resps.relatorios_seint_lista) {
						(resps.relatorios_seint_lista as { n_relat?: string; q_alvos?: string }[]).forEach(
							(item, idx) => {
								if (item.n_relat || item.q_alvos) {
									allResults.push({
										equipe_id: eqId,
										pergunta: `  ↳ Relatório ${idx + 1}`,
										resposta:
											`${item.n_relat || ''} ${item.q_alvos ? '(' + item.q_alvos + ' alvos)' : ''}`.trim()
									});
								}
							}
						);
					}
					if (p.tipo === 'foragidos_complex' && resps.foragidos_lista) {
						(resps.foragidos_lista as { nome?: string; resultado?: string }[]).forEach(
							(item, idx) => {
								if (item.nome || item.resultado) {
									allResults.push({
										equipe_id: eqId,
										pergunta: `  ↳ Alvo ${idx + 1}`,
										resposta: `${item.nome || ''} - Status: ${item.resultado || 'N/I'}`.trim()
									});
								}
							}
						);
					}
					if (
						(p.tipo === 'operacoes_seint_complex' || p.tipo === 'operacoes_seint_pura') &&
						resps.operacoes_seint_lista
					) {
						(resps.operacoes_seint_lista as { nome?: string; delegacia?: string }[]).forEach(
							(item, idx) => {
								if (item.nome || item.delegacia) {
									allResults.push({
										equipe_id: eqId,
										pergunta: `  ↳ Operação ${idx + 1}`,
										resposta: `${item.nome || ''} (${item.delegacia || ''})`.trim()
									});
								}
							}
						);
					}

					if (p.filhos && p.filhos.length > 0) {
						processarPerguntas(p.filhos, resps, eqId);
					}
				}
			}
		}
	};

	for (const r of rows) {
		const resps = parseRespostasFormularioJsonLoose(r.respostas) as Record<string, unknown>;

		const modeloPerguntas =
			modelosMap.get(r.equipe_tipo) ||
			(r.equipe_tipo === 'seint' ? DEFAULT_SEINT_QUESTIONS : DEFAULT_QUESTIONS);

		processarPerguntas(modeloPerguntas, resps, r.equipe_id!);
	}

	return allResults;
}

export async function buscarGiseModeloFormulario(
	db: Database,
	tipo: 'operacional' | 'seint' = 'operacional'
) {
	try {
		return db.select().from(giseModeloFormulario).where(eq(giseModeloFormulario.tipo, tipo)).get();
	} catch (err) {
		logger.error('[buscarGiseModeloFormulario] falha na query', { tipo, err: String(err) });
		return null;
	}
}

export async function salvarGiseModeloFormulario(
	db: Database,
	tipo: 'operacional' | 'seint',
	config: string
) {
	const existente = await db
		.select({ id: giseModeloFormulario.id })
		.from(giseModeloFormulario)
		.where(eq(giseModeloFormulario.tipo, tipo))
		.get();

	if (existente) {
		return db
			.update(giseModeloFormulario)
			.set({ config, updated_at: sql`datetime('now', '-3 hours')` })
			.where(eq(giseModeloFormulario.id, existente.id));
	}

	return db
		.insert(giseModeloFormulario)
		.values({ tipo, config, updated_at: sql`datetime('now', '-3 hours')` });
}

// ---- Respostas ----

export async function buscarRespostaGise(
	db: Database,
	giseId: number,
	policialId: number | null,
	equipeId?: number
) {
	let targetEquipeId = equipeId;

	if (!targetEquipeId && policialId) {
		const meuMembro = await db
			.select({ equipe_id: giseMembros.equipe_id })
			.from(giseMembros)
			.where(eq(giseMembros.policial_id, policialId))
			.get();
		if (meuMembro) targetEquipeId = meuMembro.equipe_id;
	}

	if (targetEquipeId) {
		return db
			.select()
			.from(giseRespostasFormulario)
			.where(
				and(
					eq(giseRespostasFormulario.gise_id, giseId),
					eq(giseRespostasFormulario.equipe_id, targetEquipeId)
				)
			)
			.get();
	} else if (policialId) {
		return db
			.select()
			.from(giseRespostasFormulario)
			.where(
				and(
					eq(giseRespostasFormulario.gise_id, giseId),
					eq(giseRespostasFormulario.policial_id, policialId)
				)
			)
			.get();
	}

	return null;
}

export async function salvarRespostaGise(
	db: Database,
	giseId: number,
	policialId: number,
	respostas: string,
	equipeId?: number
) {
	const existente = await buscarRespostaGise(db, giseId, policialId, equipeId);

	if (existente) {
		const targetId = existente.id;
		return db
			.update(giseRespostasFormulario)
			.set({ respostas, updated_at: sql`datetime('now', '-3 hours')` })
			.where(eq(giseRespostasFormulario.id, targetId));
	}

	return db.insert(giseRespostasFormulario).values({
		gise_id: giseId,
		policial_id: policialId,
		equipe_id: equipeId ?? null,
		respostas,
		updated_at: sql`datetime('now', '-3 hours')`
	});
}

export async function listarTodasRespostasGise(
	db: Database,
	opts?: { page?: number; limit?: number; mes?: number; ano?: number }
): Promise<{
	respostas: Array<{
		id: number;
		gise_id: number;
		policial_id: number;
		respostas: string;
		updated_at: string;
		data_inicio: string;
		seccional_id: number;
		seccional_nome: string;
		equipe_id: number;
		equipe_tipo: string;
	}>;
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	const page = Math.max(1, opts?.page ?? 1);
	const limit = Math.min(500, Math.max(1, opts?.limit ?? 200));
	const offset = (page - 1) * limit;

	// Build dynamic conditions
	const conditions: SQL[] = [];
	if (opts?.mes) {
		const monthStr = opts.mes.toString().padStart(2, '0');
		conditions.push(sql`strftime('%m', ${giseEscalas.data_inicio}) = ${monthStr}`);
	}
	if (opts?.ano) {
		conditions.push(sql`strftime('%Y', ${giseEscalas.data_inicio}) = ${opts.ano.toString()}`);
	}
	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

	// Count total
	const countResult = await db
		.select({ count: sql<number>`count(*)` })
		.from(giseRespostasFormulario)
		.innerJoin(giseEquipes, eq(giseRespostasFormulario.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
		.where(whereClause)
		.get();
	const total = Number(countResult?.count ?? 0);
	const totalPages = Math.ceil(total / limit);

	const resultados = await db
		.select({
			id: giseRespostasFormulario.id,
			gise_id: giseRespostasFormulario.gise_id,
			policial_id: giseRespostasFormulario.policial_id,
			respostas: giseRespostasFormulario.respostas,
			updated_at: giseRespostasFormulario.updated_at,
			data_inicio: giseEscalas.data_inicio,
			seccional_id: giseSeccionais.seccional_id,
			seccional_nome: unidades.nome,
			equipe_id: giseEquipes.id,
			equipe_tipo: giseEquipes.tipo
		})
		.from(giseRespostasFormulario)
		.innerJoin(giseEquipes, eq(giseRespostasFormulario.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
		.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
		.where(whereClause)
		.orderBy(desc(giseEscalas.data_inicio))
		.limit(limit)
		.offset(offset);

	return { respostas: resultados, total, page, limit, totalPages };
}

export type GiseRespostaListagemItem = Awaited<
	ReturnType<typeof listarTodasRespostasGise>
>['respostas'][number];
