import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	listarEscalas,
	listarPoliciaisEscala,
	criarEscala,
	excluirEscala,
	listarUnidades,
	verificarEscalaExistente,
	listarSolicitacoesEscalas
} from '$lib/db';
import { escalaSchema } from '$lib/schemas';
import { registrarAuditComContexto } from '$lib/db';
import { logger } from '$lib/server/logger';
import { eq, or, and, inArray, sql, desc, type SQL } from 'drizzle-orm';
import {
	unidades as unidadesTable,
	escalas as escalasTable,
	escalaPoliciais,
	escalaDocumentos,
	escalaSolicitacoesAssinatura
} from '$lib/server/schema';
import {
	calcularProximoMesDias,
	primeiroDiaDoMes,
	ultimoDiaDoMes,
	calcularDataSaida,
	agruparDiasPorPolicial,
	MESES_PT
} from '$lib/rotacao';

export const load: PageServerLoad = async ({ locals, platform, url, depends }) => {
	// Chave de invalidação segmentada: mutações da listagem (excluir, solicitar/
	// cancelar/concluir assinatura) chamam invalidate('app:escalas') em vez de
	// invalidateAll() — evita refazer também o load do layout (flags + papel GISE)
	// a cada operação (auditoria de performance, U-1).
	depends('app:escalas');

	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	// Admin geral n\u00e3o tem acesso \u00e0 listagem de escalas (aba "Arquivo")
	if (u.tipo === 'admin') {
		throw redirect(302, '/');
	}
	if (u.papel !== 'admin_seccional' && u.papel !== 'admin_unidade') {
		throw redirect(302, '/');
	}

	const db = getDB(platform);

	// Parâmetros de filtro
	// isAdmin sempre false aqui: o admin geral é redirecionado no guarda acima
	const isAdmin = false;
	let lotacaoParam = url.searchParams.get('lotacao') || undefined;
	const mes = url.searchParams.get('mes') ? Number(url.searchParams.get('mes')) : undefined;
	const ano = url.searchParams.get('ano') ? Number(url.searchParams.get('ano')) : undefined;
	const tipo = url.searchParams.get('tipo') || undefined;
	const busca = url.searchParams.get('busca') || undefined;
	const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined;

	// Escopo por papel: admin_unidade vê só sua unidade; admin_seccional vê sua seccional
	let lotacoesPermitidas: string[] | undefined = undefined;
	if (!isAdmin) {
		if (u.papel === 'admin_unidade') {
			lotacaoParam = u.lotacao ?? undefined;
		} else if (u.papel === 'admin_seccional' && u.papel_unidade_id) {
			const rows = await db
				.select({ nome: unidadesTable.nome })
				.from(unidadesTable)
				.where(
					or(
						eq(unidadesTable.id, u.papel_unidade_id),
						eq(unidadesTable.seccional_id, u.papel_unidade_id)
					)
				);
			lotacoesPermitidas = rows.map((r) => r.nome);
			// Valida que o filtro manual está dentro do escopo permitido
			if (lotacaoParam && !lotacoesPermitidas.includes(lotacaoParam)) {
				lotacaoParam = undefined;
			}
		}
	}

	// Admin geral sem unidade selecionada: aguarda seleção
	const skipLoad = isAdmin && !lotacaoParam;

	// Meses já ocupados para o picker de nova escala (plantão/expediente)
	const anoAtual = new Date().getFullYear();
	const escalasExistentesBase = and(
		or(eq(escalasTable.tipo, 'plantao'), eq(escalasTable.tipo, 'expediente'))!,
		sql`cast(strftime('%Y', ${escalasTable.data_inicio}) as integer) >= ${anoAtual - 1}` as SQL,
		sql`cast(strftime('%Y', ${escalasTable.data_inicio}) as integer) <= ${anoAtual + 3}` as SQL
	);
	const scopeEscalas =
		u.papel === 'admin_unidade' && u.lotacao
			? and(escalasExistentesBase!, eq(escalasTable.lotacao, u.lotacao))
			: u.papel === 'admin_seccional' && lotacoesPermitidas && lotacoesPermitidas.length > 0
				? and(escalasExistentesBase!, inArray(escalasTable.lotacao, lotacoesPermitidas))
				: escalasExistentesBase;

	const podeAssinar =
		(u.papel === 'admin_seccional' || u.papel === 'admin_unidade') && u.cargo === 'DPC';

	// OIP admin pode solicitar assinatura (mas não assinar diretamente)
	const podeOIPSolicitar =
		(u.papel === 'admin_seccional' || u.papel === 'admin_unidade') && u.cargo === 'OIP';

	let escalasParaAssinarQuery: ReturnType<typeof db.select> | Promise<never[]> = Promise.resolve(
		[]
	);
	if (podeAssinar) {
		const subqDocs = db.select({ escala_id: escalaDocumentos.escala_id }).from(escalaDocumentos);
		const baseWhere = and(
			or(eq(escalasTable.tipo, 'plantao'), eq(escalasTable.tipo, 'expediente'))!,
			sql`${escalasTable.id} NOT IN (${subqDocs})` as SQL
		);

		if (isAdmin) {
			// Admin geral vê todas as escalas não assinadas (sem exigir solicitação)
			escalasParaAssinarQuery = db
				.select({
					id: escalasTable.id,
					titulo: escalasTable.titulo,
					cidade: escalasTable.cidade,
					data_inicio: escalasTable.data_inicio,
					data_fim: escalasTable.data_fim,
					tipo: escalasTable.tipo,
					lotacao: escalasTable.lotacao,
					is_assinada: sql<boolean>`EXISTS (SELECT 1 FROM escala_documentos WHERE escala_id = ${escalasTable.id})`
				})
				.from(escalasTable)
				.where(baseWhere)
				.orderBy(desc(escalasTable.created_at))
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				.limit(50) as any; // drizzle's chained query type is a specialized subtype of ReturnType<typeof db.select>
		} else {
			// DPC admin só vê escalas que têm uma solicitação direcionada a eles
			let scopeCondition;
			if (u.papel === 'admin_unidade' && u.lotacao) {
				scopeCondition = or(
					and(
						eq(escalaSolicitacoesAssinatura.tipo, 'unidade'),
						eq(escalasTable.lotacao, u.lotacao)
					),
					and(
						eq(escalaSolicitacoesAssinatura.tipo, 'respondencia'),
						eq(escalaSolicitacoesAssinatura.destinatario_id, u.id)
					)
				);
			} else if (
				u.papel === 'admin_seccional' &&
				lotacoesPermitidas &&
				lotacoesPermitidas.length > 0
			) {
				scopeCondition = or(
					and(
						eq(escalaSolicitacoesAssinatura.tipo, 'unidade'),
						inArray(escalasTable.lotacao, lotacoesPermitidas)
					),
					and(
						eq(escalaSolicitacoesAssinatura.tipo, 'respondencia'),
						eq(escalaSolicitacoesAssinatura.destinatario_id, u.id)
					)
				);
			}

			escalasParaAssinarQuery = db
				.select({
					id: escalasTable.id,
					titulo: escalasTable.titulo,
					cidade: escalasTable.cidade,
					data_inicio: escalasTable.data_inicio,
					data_fim: escalasTable.data_fim,
					tipo: escalasTable.tipo,
					lotacao: escalasTable.lotacao,
					is_assinada: sql<boolean>`EXISTS (SELECT 1 FROM escala_documentos WHERE escala_id = ${escalasTable.id})`
				})
				.from(escalasTable)
				.innerJoin(
					escalaSolicitacoesAssinatura,
					eq(escalaSolicitacoesAssinatura.escala_id, escalasTable.id)
				)
				.where(
					scopeCondition
						? and(
								baseWhere,
								scopeCondition!
							)
						: baseWhere
				)
				.orderBy(desc(escalasTable.created_at))
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				.limit(50) as any; // drizzle's chained query type is a specialized subtype of ReturnType<typeof db.select>
		}
	}

	const [resultado, unidades, escalasExistentes, escalasParaAssinarRaw] = await Promise.all([
		skipLoad
			? { escalas: [], total: 0, page: 1, limit: 20, totalPages: 1 }
			: listarEscalas(db, lotacaoParam, undefined, mes, ano, tipo, undefined, undefined, {
					busca,
					page,
					limit: 20,
					lotacoes: !lotacaoParam ? lotacoesPermitidas : undefined
				}),
		listarUnidades(db),
		db
			.select({
				lotacao: escalasTable.lotacao,
				tipo: escalasTable.tipo,
				ano: sql<number>`cast(strftime('%Y', ${escalasTable.data_inicio}) as integer)`,
				mes: sql<number>`cast(strftime('%m', ${escalasTable.data_inicio}) as integer)`
			})
			.from(escalasTable)
			.where(scopeEscalas),
		escalasParaAssinarQuery
	]);

	const escalasParaAssinar = escalasParaAssinarRaw;

	// Carrega solicitações pendentes para OIP e DPC admins — necessário para status correto na lista
	type SolicitacaoInfo = {
		tipo: 'unidade' | 'respondencia';
		destinatario_nome?: string;
		destinatario_id?: number;
	};
	const solicitacoesMap: Record<number, SolicitacaoInfo> = {};
	const deveCarregarSolicitacoes =
		!isAdmin && (u.papel === 'admin_seccional' || u.papel === 'admin_unidade');
	if (deveCarregarSolicitacoes && resultado.escalas.length > 0) {
		const escalasNaoAssinadas = resultado.escalas
			.filter((e) => (e.tipo === 'plantao' || e.tipo === 'expediente') && !e.is_assinada)
			.map((e) => e.id);
		if (escalasNaoAssinadas.length > 0) {
			const mapa = await listarSolicitacoesEscalas(db, escalasNaoAssinadas);
			for (const [k, v] of mapa) {
				solicitacoesMap[k] = v;
			}
		}
	}

	const v = url.searchParams.get('v');
	const initialView =
		v === 'assinaturas' ? 'assinaturas' : url.searchParams.toString() ? 'lista' : 'home';

	return {
		escalas: resultado.escalas,
		pagination: {
			page: resultado.page,
			limit: resultado.limit,
			total: resultado.total,
			totalPages: resultado.totalPages
		},
		unidades,
		filtros: {
			lotacao: lotacaoParam ?? '',
			mes: mes ?? 0,
			ano: ano ?? 0,
			tipo: tipo ?? 'todos',
			busca: busca ?? ''
		},
		isAdmin,
		skipLoad,
		papelUnidadeId: u.papel_unidade_id ?? null,
		escalasExistentes,
		initialView,
		podeAssinar,
		podeOIPSolicitar,
		solicitacoesMap,
		escalasParaAssinar: escalasParaAssinar as Array<{
			id: number;
			titulo: string;
			cidade: string;
			data_inicio: string;
			data_fim: string;
			tipo: string;
			lotacao: string;
			is_assinada: boolean;
		}>
	};
};

export const actions: Actions = {
	criar: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const data = await request.formData();
		const titulo = data.get('titulo')?.toString() || '';
		const cidade = data.get('cidade')?.toString() || '';
		const data_inicio = data.get('data_inicio')?.toString() || '';
		const data_fim = data.get('data_fim')?.toString() || '';
		const hora_entrada = data.get('hora_entrada')?.toString() || '08';
		const hora_saida = data.get('hora_saida')?.toString() || '08';
		const lotacao = data.get('lotacao')?.toString() || '';
		const tipo = data.get('tipo')?.toString() as 'plantao' | 'expediente' | 'fds' | '';

		const parsed = escalaSchema.safeParse({
			titulo,
			cidade,
			data_inicio,
			data_fim,
			horario: `${hora_entrada}H A ${hora_saida}H`,
			hora_entrada,
			hora_saida,
			lotacao: u.tipo === 'policial' ? u.lotacao : lotacao,
			tipo: tipo || undefined
		});

		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0].message,
				fields: { titulo, cidade, data_inicio, data_fim, lotacao, tipo }
			});
		}

		const validated = parsed.data;
		const db = getDB(platform);

		// Valida unicidade
		if (validated.tipo && validated.lotacao) {
			const existente = await verificarEscalaExistente(
				db,
				validated.lotacao,
				validated.tipo as 'plantao' | 'expediente' | 'fds',
				validated.data_inicio,
				validated.data_fim
			);
			if (existente) {
				const periodo = validated.tipo === 'fds' ? 'nesta semana' : 'neste mês';
				const tipoLabel =
					validated.tipo === 'plantao'
						? 'Plantão'
						: validated.tipo === 'expediente'
							? 'Expediente'
							: 'Final de Semana';
				return fail(409, {
					error: `Já existe uma Escala de ${tipoLabel} para ${validated.lotacao} ${periodo}.`,
					fields: { titulo, cidade, data_inicio, data_fim, lotacao, tipo }
				});
			}
		}

		try {
			const result = await criarEscala(db, {
				titulo: validated.titulo,
				cidade: validated.cidade,
				data_inicio: validated.data_inicio,
				data_fim: validated.data_fim,
				horario: validated.horario,
				hora_entrada: validated.hora_entrada,
				hora_saida: validated.hora_saida,
				lotacao: validated.lotacao,
				tipo: validated.tipo
			});

			return { success: true, id: result[0]?.id };
		} catch (err) {
			logger.error('[escalas/criar] Erro interno ao criar escala', {
				lotacao,
				tipo,
				error: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack : undefined
			});
			return fail(500, {
				error: 'Erro interno ao criar escala',
				fields: { titulo, cidade, data_inicio, data_fim, lotacao, tipo }
			});
		}
	},

	excluir: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const data = await request.formData();
		const escalaId = Number(data.get('escala_id'));
		if (isNaN(escalaId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);

		if (u.tipo === 'policial') {
			const { buscarEscala } = await import('$lib/db');
			const escala = await buscarEscala(db, escalaId);
			if (!escala) return fail(404, { error: 'Escala não encontrada' });

			if (u.papel === 'admin_seccional' && u.papel_unidade_id) {
				const rows = await db
					.select({ nome: unidadesTable.nome })
					.from(unidadesTable)
					.where(
						or(
							eq(unidadesTable.id, u.papel_unidade_id),
							eq(unidadesTable.seccional_id, u.papel_unidade_id)
						)
					);
				const permitidas = new Set(rows.map((r) => r.nome));
				if (!permitidas.has(escala.lotacao)) {
					return fail(403, { error: 'Sem permissão' });
				}
			} else if (escala.lotacao !== u.lotacao) {
				return fail(403, { error: 'Sem permissão' });
			}
		}

		await excluirEscala(db, escalaId);

		if (u) {
			await registrarAuditComContexto(db, {
				usuario: u,
				acao: 'excluir_escala',
				entidade: 'escala',
				entidade_id: escalaId,
				detalhes: `Escala excluída: ID ${escalaId}`
			});
		}

		return { success: true };
	},

	criarComBase: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });
		if (u.tipo !== 'admin' && u.papel !== 'admin_seccional' && u.papel !== 'admin_unidade') {
			return fail(403, { error: 'Sem permissão' });
		}

		const data = await request.formData();
		const lotacao = data.get('lotacao')?.toString() || '';
		const tipo = data.get('tipo')?.toString() as 'plantao' | 'expediente';
		const mes = Number(data.get('mes'));
		const ano = Number(data.get('ano'));

		if (!lotacao || !tipo || !mes || !ano) {
			return fail(400, { error: 'Dados inválidos' });
		}

		const mesPrev = mes === 1 ? 12 : mes - 1;
		const anoPrev = mes === 1 ? ano - 1 : ano;

		const db = getDB(platform);

		const escalaPrev = await verificarEscalaExistente(
			db,
			lotacao,
			tipo,
			primeiroDiaDoMes(anoPrev, mesPrev)
		);
		if (!escalaPrev) {
			return fail(404, {
				error: `Não há escala de ${tipo === 'plantao' ? 'Plantão' : 'Expediente'} para ${lotacao} em ${MESES_PT[mesPrev - 1]} ${anoPrev}`
			});
		}

		const dataInicioAlvo = primeiroDiaDoMes(ano, mes);
		const dataFimAlvo = ultimoDiaDoMes(ano, mes);
		const tipoLabel = tipo === 'plantao' ? 'PLANTÃO' : 'EXPEDIENTE';

		try {
			const result = await criarEscala(db, {
				titulo: `ESCALA DE ${tipoLabel} DA ${lotacao.toUpperCase()} – ${MESES_PT[mes - 1].toUpperCase()} ${ano}`,
				cidade: escalaPrev.cidade,
				data_inicio: dataInicioAlvo,
				data_fim: dataFimAlvo,
				horario: escalaPrev.horario,
				hora_entrada: escalaPrev.hora_entrada,
				hora_saida: escalaPrev.hora_saida,
				lotacao,
				tipo
			});

			const novaEscalaId = result[0]?.id;
			if (!novaEscalaId) return fail(500, { error: 'Erro ao criar escala' });

			const policiaisAtuais = await listarPoliciaisEscala(db, escalaPrev.id);
			let adicionados = 0;
			const naoProcessados: Array<{ nome: string; motivo: string }> = [];
			const linhasParaInserir: (typeof escalaPoliciais.$inferInsert)[] = [];

			if (tipo === 'expediente') {
				const vistos = new Set<number>();
				const he = escalaPrev.hora_entrada || '00:00';
				const hs = escalaPrev.hora_saida || '23:59';
				for (const p of policiaisAtuais) {
					if (vistos.has(p.policial_id)) continue;
					vistos.add(p.policial_id);
					const dsE = p.hora_entrada || he;
					const dsS = p.hora_saida || hs;
					linhasParaInserir.push({
						escala_id: novaEscalaId,
						policial_id: p.policial_id,
						data_plantao: dataInicioAlvo,
						data_saida: calcularDataSaida(dataInicioAlvo, dsE, dsS),
						hora_entrada: dsE,
						hora_saida: dsS
					});
					adicionados++;
				}
			} else {
				const diasPorPolicial = agruparDiasPorPolicial(policiaisAtuais);
				const he = escalaPrev.hora_entrada || '00:00';
				const hs = escalaPrev.hora_saida || '23:59';
				for (const [policialId, { nome, dias, equipe }] of diasPorPolicial) {
					const { dias: novosDias, rotacao } = calcularProximoMesDias(dias, ano, mes);
					if (novosDias.length === 0) {
						naoProcessados.push({
							nome,
							motivo: rotacao === null ? 'Rotação não identificada' : 'Nenhum dia calculado'
						});
						continue;
					}
					for (const dia of novosDias) {
						linhasParaInserir.push({
							escala_id: novaEscalaId,
							policial_id: policialId,
							data_plantao: dia,
							data_saida: calcularDataSaida(dia, he, hs),
							hora_entrada: he,
							hora_saida: hs,
							equipe
						});
					}
					adicionados++;
				}
			}

			if (linhasParaInserir.length > 0) {
				// D1 limita ~100 statements por batch e ~999 params por statement.
				// Cada linha usa 8 campos → inserimos em lotes de 50 statements,
				// bem abaixo do limite. db.batch() garante atomicidade por lote.
				const BATCH_SIZE = 50;
				for (let i = 0; i < linhasParaInserir.length; i += BATCH_SIZE) {
					const chunk = linhasParaInserir.slice(i, i + BATCH_SIZE);
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					await db.batch(chunk.map((row) => db.insert(escalaPoliciais).values(row)) as any); // drizzle batch requires a non-empty tuple type; array from .map() is not assignable
				}
			}

			return { success: true, id: novaEscalaId, adicionados, nao_processados: naoProcessados };
		} catch (err) {
			logger.error('[escalas/criarComBase] Erro interno', {
				lotacao,
				tipo,
				mes,
				ano,
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, { error: 'Erro interno ao criar escala' });
		}
	}
};
