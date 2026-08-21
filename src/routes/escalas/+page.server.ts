/**
 * `load` e actions da listagem de escalas (`/escalas`, a aba "Arquivo").
 *
 * **Quem entra aqui já é admin de unidade ou de seccional.** O `load` redireciona
 * todo o resto — inclusive o Admin Geral, que tem a caixa de entrada
 * (`/recebidos`) e o painel, não a listagem operacional. Esse guarda é a
 * premissa de que o arquivo inteiro depende: por causa dele, o escopo por papel
 * nunca é "todas as unidades".
 *
 * Escopo, na ordem em que é decidido:
 *   1. `admin_unidade` → a unidade do PAPEL (`papel_unidade_id`), não a
 *      lotação atual (FLW-RBAC-003 / SEC-06);
 *   2. `admin_seccional` → a seccional e as delegacias abaixo dela; um
 *      `?lotacao=` fora dessa lista é DESCARTADO em vez de recusado, porque
 *      link antigo ou filtro salvo não deve virar erro na cara do usuário;
 *   3. a query só então é montada, já restrita.
 *
 * `depends('app:escalas')` é a chave de invalidação segmentada: as mutações da
 * listagem revalidam só este `load`, não o do layout (flags + papel GISE) —
 * `invalidateAll()` refazia tudo a cada exclusão (auditoria U-1).
 *
 * As três actions:
 * - `criar` — recusa duplicata via `verificarEscalaExistente` (a UI já bloqueia
 *   no modal, mas o POST direto precisa morrer aqui);
 * - `excluir` — destrutiva, exige papel de administração. "Mesma lotação" em
 *   `verificarPermissaoEscala` vale só para leitura; assinar é
 *   `podeAssinarEscala`. Delega a `excluirEscalaCompleta`, que limpa o R2
 *   ANTES do DELETE (R2-1);
 * - `criarComBase` — copia a escala do mês anterior da mesma lotação/tipo.
 */
import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	listarEscalas,
	listarPoliciaisEscala,
	criarEscala,
	listarUnidades,
	verificarEscalaExistente,
	listarSolicitacoesEscalas
} from '$lib/db';
import { escalaSchema } from '$lib/schemas';
import {
	registrarAuditComContexto,
	contextoDeEvento,
	inserirPoliciaisEscalaEmLotes
} from '$lib/db';
import { excluirEscalaCompleta } from '$lib/server/escalas/exclusao';
import { podeOIPSolicitarAssinatura } from '$lib/server/escalas/permissao';
import { logger } from '$lib/server/logger';
import { eq, or, and, inArray, sql, desc, type SQL } from 'drizzle-orm';
import { lotacoesAdministradas, lotacaoNoEscopo } from '$lib/server/policial-permissao';
import {
	escalas as escalasTable,
	escalaDocumentos,
	escalaSolicitacoesAssinatura,
	policiais as policiaisTable
} from '$lib/server/schema';
import { primeiroDiaDoMes, ultimoDiaDoMes, MESES_PT } from '$lib/rotacao';
import { projetarLinhasMesSeguinte } from '$lib/server/escalas/projetar-mes';
import { mensagemDeErro } from '$lib/utils/erro';

export const load: PageServerLoad = async ({ locals, platform, url, depends }) => {
	// Chave de invalidação segmentada: mutações da listagem (excluir, solicitar/
	// cancelar/concluir assinatura) chamam invalidate('app:escalas') em vez de
	// invalidateAll() — evita refazer também o load do layout (flags + papel GISE)
	// a cada operação (auditoria de performance, U-1).
	depends('app:escalas');

	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	// Admin geral n\u00e3o tem acesso \u00e0 listagem de escalas (aba "Arquivo")
	if (u.tipo === 'admin') {
		redirect(302, '/');
	}
	if (u.papel !== 'admin_seccional' && u.papel !== 'admin_unidade') {
		redirect(302, '/');
	}

	const db = getDB(platform);

	// Parâmetros de filtro
	let lotacaoParam = url.searchParams.get('lotacao') || undefined;
	const mes = url.searchParams.get('mes') ? Number(url.searchParams.get('mes')) : undefined;
	const ano = url.searchParams.get('ano') ? Number(url.searchParams.get('ano')) : undefined;
	const tipo = url.searchParams.get('tipo') || undefined;
	const busca = url.searchParams.get('busca') || undefined;
	const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined;
	const statusParam = url.searchParams.get('status');
	const statusLista =
		statusParam === 'aguardando' || statusParam === 'arquivada' ? statusParam : undefined;

	// Escopo por papel (FLW-RBAC-003): unidade do papel, não a lotação atual.
	// Conjunto vazio é "nada", não "todas" — `listarEscalas` trata `lotacoes: []`
	// como zero linhas. Sem isto, admin_unidade sem `papel_unidade_id` via a
	// listagem inteira (SEC-06).
	let lotacoesPermitidas: string[] | undefined = undefined;
	{
		const escopo = await lotacoesAdministradas(db, u);
		if (u.papel === 'admin_unidade') {
			lotacoesPermitidas = escopo ? [...escopo] : [];
			lotacaoParam = lotacoesPermitidas[0];
		} else if (u.papel === 'admin_seccional') {
			lotacoesPermitidas = escopo ? [...escopo] : [];
			if (lotacaoParam && !lotacoesPermitidas.includes(lotacaoParam)) {
				lotacaoParam = undefined;
			}
		}
	}

	// Meses já ocupados para o picker de nova escala (plantão/expediente)
	const anoAtual = new Date().getFullYear();
	const escalasExistentesBase = and(
		or(eq(escalasTable.tipo, 'plantao'), eq(escalasTable.tipo, 'expediente'))!,
		sql`cast(strftime('%Y', ${escalasTable.data_inicio}) as integer) >= ${anoAtual - 1}` as SQL,
		sql`cast(strftime('%Y', ${escalasTable.data_inicio}) as integer) <= ${anoAtual + 3}` as SQL
	);
	const recorteLotacao = lotacaoParam
		? eq(escalasTable.lotacao, lotacaoParam)
		: lotacoesPermitidas && lotacoesPermitidas.length > 0
			? inArray(escalasTable.lotacao, lotacoesPermitidas)
			: sql`1 = 0`;
	const scopeEscalas = and(escalasExistentesBase!, recorteLotacao);

	const podeAssinar =
		(u.papel === 'admin_seccional' || u.papel === 'admin_unidade') && u.cargo === 'DPC';

	// Rubrica reutilizável do signatário — para o prompt de cadastro (Lógica 2a):
	// quem pode assinar por token mas ainda não cadastrou a rubrica é convidado a
	// cadastrá-la (não-bloqueante). Só consulta para quem assina.
	let minhaRubrica: string | null = null;
	if (podeAssinar) {
		const rubRow = await db
			.select({ rubrica: policiaisTable.rubrica })
			.from(policiaisTable)
			.where(eq(policiaisTable.id, u.id))
			.get();
		minhaRubrica = rubRow?.rubrica ?? null;
	}

	// OIP admin (ou Admin Geral) pode solicitar assinatura — FLW-AUT-013.
	const podeOIPSolicitar = podeOIPSolicitarAssinatura(u);

	// Query das escalas pendentes de assinatura. Montada numa função para que o
	// tipo das linhas seja INFERIDO da própria cadeia do drizzle — um `let`
	// anotado com `ReturnType<typeof db.select>` exigia `as any` nos dois ramos
	// (a cadeia com .where/.limit é um subtipo especializado) e casts manuais
	// no retorno do load e na página.
	const montarQueryEscalasParaAssinar = () => {
		const subqDocs = db.select({ escala_id: escalaDocumentos.escala_id }).from(escalaDocumentos);
		const baseWhere = and(
			or(eq(escalasTable.tipo, 'plantao'), eq(escalasTable.tipo, 'expediente'))!,
			sql`${escalasTable.id} NOT IN (${subqDocs})` as SQL
		);
		const camposEscala = {
			id: escalasTable.id,
			titulo: escalasTable.titulo,
			cidade: escalasTable.cidade,
			data_inicio: escalasTable.data_inicio,
			data_fim: escalasTable.data_fim,
			tipo: escalasTable.tipo,
			lotacao: escalasTable.lotacao,
			is_assinada: sql<boolean>`EXISTS (SELECT 1 FROM escala_documentos WHERE escala_id = ${escalasTable.id})`
		};

		// DPC admin só vê escalas que têm uma solicitação direcionada a eles.
		// Sem recorte, o `where` caía só no "sem PDF" e listava o Estado.
		let scopeCondition: SQL | undefined;
		if (u.papel === 'admin_unidade' && lotacaoParam) {
			scopeCondition = or(
				and(
					eq(escalaSolicitacoesAssinatura.tipo, 'unidade'),
					eq(escalasTable.lotacao, lotacaoParam)
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
		} else {
			scopeCondition = sql`1 = 0`;
		}

		return db
			.select(camposEscala)
			.from(escalasTable)
			.innerJoin(
				escalaSolicitacoesAssinatura,
				eq(escalaSolicitacoesAssinatura.escala_id, escalasTable.id)
			)
			.where(and(baseWhere, scopeCondition))
			.orderBy(desc(escalasTable.created_at))
			.limit(50);
	};

	const escalasParaAssinarQuery = podeAssinar
		? montarQueryEscalasParaAssinar()
		: Promise.resolve([]);

	const [resultado, unidades, escalasExistentes, escalasParaAssinarRaw] = await Promise.all([
		listarEscalas(db, lotacaoParam, statusLista, mes, ano, tipo, undefined, undefined, {
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
	const deveCarregarSolicitacoes = u.papel === 'admin_seccional' || u.papel === 'admin_unidade';
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
			busca: busca ?? '',
			status: statusLista ?? ''
		},
		papelUnidadeId: u.papel_unidade_id ?? null,
		escalasExistentes,
		initialView,
		podeAssinar,
		minhaRubrica,
		podeOIPSolicitar,
		solicitacoesMap,
		escalasParaAssinar
	};
};

export const actions: Actions = {
	criar: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });
		// Mesmo guarda do load e de criarComBase: sem ele, qualquer policial
		// autenticado criava escala para a própria lotação via POST direto
		// (auditoria 2026-07-16, achado B-2).
		if (u.tipo !== 'admin' && u.papel !== 'admin_seccional' && u.papel !== 'admin_unidade') {
			return fail(403, { error: 'Sem permissão' });
		}

		const data = await request.formData();
		const titulo = data.get('titulo')?.toString() || '';
		const cidade = data.get('cidade')?.toString() || '';
		const data_inicio = data.get('data_inicio')?.toString() || '';
		const data_fim = data.get('data_fim')?.toString() || '';
		const hora_entrada = data.get('hora_entrada')?.toString() || '08';
		const hora_saida = data.get('hora_saida')?.toString() || '08';
		const lotacaoForm = data.get('lotacao')?.toString() || '';
		const tipo = data.get('tipo')?.toString() as 'plantao' | 'expediente' | 'fds' | '';

		const db = getDB(platform);
		let lotacao = lotacaoForm;
		if (u.tipo === 'policial') {
			const escopo = await lotacoesAdministradas(db, u);
			if (!escopo || escopo.size === 0) {
				return fail(403, { error: 'Sem permissão' });
			}
			if (lotacaoForm && lotacaoNoEscopo(escopo, lotacaoForm)) {
				lotacao = lotacaoForm;
			} else if (escopo.size === 1) {
				lotacao = [...escopo][0];
			} else if (u.lotacao && lotacaoNoEscopo(escopo, u.lotacao)) {
				// Seccional sem lotação no form: cria na própria seccional, que
				// está no escopo. Não usar lotação atual fora do papel (SEC-06).
				lotacao = u.lotacao;
			} else {
				return fail(400, {
					error: 'Informe a lotação da escala',
					fields: { titulo, cidade, data_inicio, data_fim, lotacao: lotacaoForm, tipo }
				});
			}
		}

		const parsed = escalaSchema.safeParse({
			titulo,
			cidade,
			data_inicio,
			data_fim,
			horario: `${hora_entrada}H A ${hora_saida}H`,
			hora_entrada,
			hora_saida,
			lotacao,
			tipo: tipo || undefined
		});

		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0].message,
				fields: { titulo, cidade, data_inicio, data_fim, lotacao, tipo }
			});
		}

		const validated = parsed.data;

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
				error: mensagemDeErro(err),
				stack: err instanceof Error ? err.stack : undefined
			});
			return fail(500, {
				error: 'Erro interno ao criar escala',
				fields: { titulo, cidade, data_inicio, data_fim, lotacao, tipo }
			});
		}
	},

	excluir: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });
		// Exclusão é destrutiva: exige papel de administração (mesmo guarda do
		// load). "Mesma lotação" em `verificarPermissaoEscala` vale só para
		// LEITURA; assinar é `podeAssinarEscala` (DPC admin). Auditoria
		// 2026-07-16, achado B-2.
		if (u.tipo !== 'admin' && u.papel !== 'admin_seccional' && u.papel !== 'admin_unidade') {
			return fail(403, { error: 'Sem permissão' });
		}

		const data = await request.formData();
		const escalaId = Number(data.get('escala_id'));
		if (isNaN(escalaId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);

		if (u.tipo === 'policial') {
			const { buscarEscala, buscarDocumentoEscala } = await import('$lib/db');
			const escala = await buscarEscala(db, escalaId);
			if (!escala) return fail(404, { error: 'Escala não encontrada' });

			// FLW-AUT-009: escopo do papel (não `u.lotacao` solta) — admin_unidade
			// transferido continua administrando a unidade do papel.
			const escopo = await lotacoesAdministradas(db, u);
			if (!lotacaoNoEscopo(escopo, escala.lotacao)) {
				return fail(403, { error: 'Sem permissão' });
			}

			// FLW-AUT-003: escala assinada só sai após revogar o documento.
			const doc = await buscarDocumentoEscala(db, escalaId);
			if (doc) {
				return fail(409, {
					error: 'Revogue a assinatura digital antes de excluir esta escala.'
				});
			}
		} else {
			// Admin Geral: mesmo gate — documento jurídico não some sem revogar.
			const { buscarDocumentoEscala } = await import('$lib/db');
			const doc = await buscarDocumentoEscala(db, escalaId);
			if (doc) {
				return fail(409, {
					error: 'Revogue a assinatura digital antes de excluir esta escala.'
				});
			}
		}

		// R2-1: o helper apaga blob assinado + conferência + selfie ANTES do
		// DELETE (a FK escala_documentos → escalas é ON DELETE CASCADE: sem isto,
		// a linha some e o objeto no R2, com PII forense, fica órfão).
		await excluirEscalaCompleta(db, platform, escalaId);

		if (u) {
			const { contexto, env } = contextoDeEvento(event);
			await registrarAuditComContexto(db, {
				usuario: u,
				acao: 'excluir_escala',
				entidade: 'escala',
				entidade_id: escalaId,
				alvo_tipo: 'escala',
				alvo_id: escalaId,
				detalhes: `Escala excluída: ID ${escalaId}`,
				...contexto,
				env
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

		const db = getDB(platform);

		// FLW-AUT-002: lotação do FormData precisa estar no escopo administrado
		// (Admin Geral = escopo null = livre; seccional/unidade = só as suas).
		const escopo = await lotacoesAdministradas(db, u);
		if (!lotacaoNoEscopo(escopo, lotacao)) {
			return fail(403, { error: 'Sem permissão para criar escala nesta lotação' });
		}

		const mesPrev = mes === 1 ? 12 : mes - 1;
		const anoPrev = mes === 1 ? ano - 1 : ano;

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
			const { linhas, adicionados, naoProcessados } = projetarLinhasMesSeguinte({
				tipo,
				policiaisAtuais,
				novaEscalaId,
				ano,
				mes,
				dataInicioAlvo,
				horaEntradaPadrao: escalaPrev.hora_entrada,
				horaSaidaPadrao: escalaPrev.hora_saida
			});

			await inserirPoliciaisEscalaEmLotes(db, linhas);

			return { success: true, id: novaEscalaId, adicionados, nao_processados: naoProcessados };
		} catch (err) {
			logger.error('[escalas/criarComBase] Erro interno', {
				lotacao,
				tipo,
				mes,
				ano,
				error: mensagemDeErro(err)
			});
			return fail(500, { error: 'Erro interno ao criar escala' });
		}
	}
};
