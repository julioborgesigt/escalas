import { eq, and, or, sql, desc, asc, inArray, like, type SQL } from 'drizzle-orm';
import {
	escalas,
	escalaPoliciais,
	escalaDocumentos,
	policiais,
	escalaSolicitacoesAssinatura
} from '../server/schema';
import type * as schema from '../server/schema';
import type { EscalaPolicialComDados, EscalaListagem } from '../types';
import { batchNonEmpty, type Database } from './core';

/** Escapa caracteres especiais do LIKE para evitar wildcard injection */
function escapeLike(str: string): string {
	return str.replace(/[%_\\]/g, '\\$&');
}

/**
 * Listagem paginada de escalas, com todos os filtros da UI (lotação, status,
 * mês/ano, tipo, "visto", busca livre). Os parâmetros posicionais são herança
 * dos primeiros call sites; filtros novos entram em `opts`.
 */
export async function listarEscalas(
	db: Database,
	lotacao?: string,
	status?: 'pendente' | 'assinada',
	mes?: number,
	ano?: number,
	tipo?: string,
	visto?: boolean,
	criadaEmDepoisDe?: string,
	opts?: {
		busca?: string;
		page?: number;
		limit?: number;
		lotacoes?: string[];
		/** Substring da lotação (filtro "Unidade" da cx. de entrada). */
		lotacaoBusca?: string;
		/** Substring de data_inicio, ex.: '2026-06' ou '2026-06-10'. */
		dataBusca?: string;
	}
): Promise<{
	escalas: EscalaListagem[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	const conditions: SQL[] = [];

	if (lotacao) {
		conditions.push(eq(escalas.lotacao, lotacao));
	} else if (opts?.lotacoes && opts.lotacoes.length > 0) {
		conditions.push(inArray(escalas.lotacao, opts.lotacoes));
	}
	if (mes) {
		const monthStr = mes.toString().padStart(2, '0');
		conditions.push(sql`strftime('%m', ${escalas.data_inicio}) = ${monthStr}`);
	}
	if (ano) conditions.push(sql`strftime('%Y', ${escalas.data_inicio}) = ${ano.toString()}`);
	if (tipo && tipo !== 'todos')
		conditions.push(eq(escalas.tipo, tipo as 'plantao' | 'expediente' | 'fds'));
	if (visto !== undefined) conditions.push(eq(escalas.visto_por_admin, visto ? 1 : 0));
	if (criadaEmDepoisDe) conditions.push(sql`${escalas.created_at} >= ${criadaEmDepoisDe}`);

	// Busca por título ou cidade
	if (opts?.busca) {
		const buscaEscapada = escapeLike(opts.busca.trim());
		conditions.push(
			or(like(escalas.titulo, `%${buscaEscapada}%`), like(escalas.cidade, `%${buscaEscapada}%`))!
		);
	}

	if (opts?.lotacaoBusca) {
		conditions.push(like(escalas.lotacao, `%${escapeLike(opts.lotacaoBusca.trim())}%`));
	}

	if (opts?.dataBusca) {
		conditions.push(like(escalas.data_inicio, `%${escapeLike(opts.dataBusca.trim())}%`));
	}

	// Filtro de status via IS NULL / IS NOT NULL sobre o LEFT JOIN abaixo
	if (status === 'pendente') {
		conditions.push(sql`${escalaDocumentos.escala_id} IS NULL`);
	} else if (status === 'assinada') {
		conditions.push(sql`${escalaDocumentos.escala_id} IS NOT NULL`);
	}

	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

	const page = Math.max(1, opts?.page ?? 1);
	const limit = Math.min(100, Math.max(1, opts?.limit ?? 20));
	const offset = (page - 1) * limit;

	// LEFT JOIN com escalaDocumentos (1:1, UNIQUE constraint) para obter is_assinada
	// e window COUNT em um único round-trip ao D1.
	const results = await db
		.select({
			id: escalas.id,
			titulo: escalas.titulo,
			cidade: escalas.cidade,
			data_inicio: escalas.data_inicio,
			data_fim: escalas.data_fim,
			horario: escalas.horario,
			hora_entrada: escalas.hora_entrada,
			hora_saida: escalas.hora_saida,
			lotacao: escalas.lotacao,
			tipo: escalas.tipo,
			visto_por_admin: escalas.visto_por_admin,
			finalizada_em: escalas.finalizada_em,
			email_envio: escalas.email_envio,
			created_at: escalas.created_at,
			is_assinada: sql<boolean>`CASE WHEN ${escalaDocumentos.escala_id} IS NOT NULL THEN 1 ELSE 0 END`,
			total: sql<number>`count(*) OVER()`
		})
		.from(escalas)
		.leftJoin(escalaDocumentos, eq(escalaDocumentos.escala_id, escalas.id))
		.where(whereClause)
		.orderBy(desc(escalas.created_at))
		.limit(limit)
		.offset(offset);

	const total = results.length > 0 ? Number(results[0].total) : 0;
	const totalPages = Math.ceil(total / limit);

	if (results.length === 0) {
		return { escalas: [], total, page, limit, totalPages };
	}

	const mapeadas = results.map(({ total: _t, ...e }) => e);

	return { escalas: mapeadas, total, page, limit, totalPages };
}

/**
 * A escala em si (cabeçalho: título, lotação, tipo, intervalo e horário), sem os
 * escalados — quem precisa deles chama `listarPoliciaisEscala`.
 */
export async function buscarEscala(db: Database, id: number): Promise<schema.Escala | undefined> {
	return db.select().from(escalas).where(eq(escalas.id, id)).get();
}

/**
 * Cria a escala VAZIA e devolve `[{ id }]` — os policiais entram depois, por
 * `adicionarTodosPoliciais` ou pela adição manual.
 *
 * Não checa duplicidade: chame `verificarEscalaExistente` antes, ou a mesma
 * lotação ganha duas escalas para o mesmo período.
 */
export async function criarEscala(
	db: Database,
	data: Omit<schema.NovaEscala, 'id' | 'created_at'>
) {
	return db.insert(escalas).values(data).returning({ id: escalas.id });
}

/**
 * Apaga a escala. Escalados, documento assinado e solicitação de assinatura
 * descem por `ON DELETE CASCADE`.
 *
 * É justamente esse cascade que torna a chamada DIRETA perigosa: a linha de
 * `escala_documentos` desaparece levando consigo o `r2_key`, e o PDF assinado, a
 * cópia de conferência e a selfie ficam no R2 sem ninguém que saiba que existem
 * (R2-1). Use `excluirEscalaCompleta` (`$lib/server/escala-exclusao`), que limpa
 * o R2 antes — esta função é a peça interna dele.
 */
export async function excluirEscala(db: Database, id: number) {
	return db.delete(escalas).where(eq(escalas.id, id));
}

/**
 * Já existe escala equivalente para esta lotação? A regra de "equivalente"
 * muda por tipo:
 *
 * - **fds**: qualquer SOBREPOSIÇÃO de datas com o intervalo pedido (dois fins
 *   de semana não podem cobrir o mesmo dia);
 * - **mensal**: qualquer escala do mesmo tipo naquele MÊS.
 *
 * A comparação mensal é feita por intervalo (`>= dia 1` e `< dia 1 do mês
 * seguinte`) em vez de `substr(data_inicio, 1, 7)` para que o índice de
 * `data_inicio` seja usado.
 */
export async function verificarEscalaExistente(
	db: Database,
	lotacao: string,
	tipo: 'plantao' | 'expediente' | 'fds',
	dataInicio: string,
	dataFim?: string
): Promise<schema.Escala | undefined> {
	if (tipo === 'fds') {
		const fim = dataFim ?? dataInicio;
		// Overlap: existente.inicio <= novoFim AND existente.fim >= novoInicio
		return db
			.select()
			.from(escalas)
			.where(
				and(
					eq(escalas.lotacao, lotacao),
					eq(escalas.tipo, tipo),
					sql`${escalas.data_inicio} <= ${fim}`,
					sql`${escalas.data_fim} >= ${dataInicio}`
				)
			)
			.get();
	}
	// Range query em vez de substr() para aproveitar índices em data_inicio
	const mesAno = dataInicio.substring(0, 7);
	const [ano, mes] = mesAno.split('-').map(Number);
	const proximoMes =
		mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, '0')}-01`;

	return db
		.select()
		.from(escalas)
		.where(
			and(
				eq(escalas.lotacao, lotacao),
				eq(escalas.tipo, tipo),
				sql`${escalas.data_inicio} >= ${mesAno + '-01'}`,
				sql`${escalas.data_inicio} < ${proximoMes}`
			)
		)
		.get();
}

/** Marca/desmarca a escala como lida na caixa de entrada do Admin Geral. */
export async function marcarVisto(db: Database, id: number, visto: boolean) {
	return db
		.update(escalas)
		.set({ visto_por_admin: visto ? 1 : 0 })
		.where(eq(escalas.id, id));
}

/**
 * Conclui a escala de FDS: grava o instante do envio e o e-mail de destino.
 *
 * `finalizada_em` é gravado no horário de Brasília (UTC-3) em texto, no mesmo
 * formato dos outros carimbos legados desta tabela — não é ISO com `Z`.
 */
export async function finalizarEscalaFDS(
	db: Database,
	id: number,
	emailEnvio: string
): Promise<void> {
	const agora = new Date(Date.now() - 3 * 60 * 60 * 1000)
		.toISOString()
		.replace('T', ' ')
		.substring(0, 19);
	await db
		.update(escalas)
		.set({ finalizada_em: agora, email_envio: emailEnvio })
		.where(eq(escalas.id, id));
}

/** Reabre a escala de FDS. Preserva `email_envio` como histórico do último envio. */
export async function desfinalizarEscalaFDS(db: Database, id: number): Promise<void> {
	await db.update(escalas).set({ finalizada_em: null }).where(eq(escalas.id, id));
}

// ---- Escala Policiais ----

/** Insere um policial em várias datas de uma vez (um INSERT por lote, não por dia). */
export async function adicionarMultiplasDatasPlantao(
	db: Database,
	escalaId: number,
	policialId: number,
	datas: Array<{ data_plantao: string; data_saida: string }>,
	horaEntrada: string,
	horaSaida: string,
	equipe: string = '',
	observacoes: string = ''
): Promise<void> {
	if (datas.length === 0) return;

	// Batch insert em vez de loop individual
	await db.insert(escalaPoliciais).values(
		datas.map((d) => ({
			escala_id: escalaId,
			policial_id: policialId,
			data_plantao: d.data_plantao,
			data_saida: d.data_saida,
			hora_entrada: horaEntrada,
			hora_saida: horaSaida,
			equipe,
			observacoes
		}))
	);
}

/** Preenche a escala com todos os policiais da lotação, no horário padrão dela. */
export async function adicionarTodosPoliciais(
	db: Database,
	escalaId: number,
	lotacao: string,
	regime: 'plantao' | 'expediente',
	dataPlantao: string,
	dataSaida: string,
	horaEntrada: string,
	horaSaida: string
): Promise<number> {
	const candidatos = await db
		.select({ id: policiais.id })
		.from(policiais)
		.where(
			and(eq(policiais.ativo, 1), eq(policiais.lotacao, lotacao), eq(policiais.regime, regime))
		);

	if (candidatos.length === 0) return 0;

	const jaNaEscala = await db
		.select({ policial_id: escalaPoliciais.policial_id })
		.from(escalaPoliciais)
		.where(eq(escalaPoliciais.escala_id, escalaId));

	const idsJaAdicionados = new Set(jaNaEscala.map((e) => e.policial_id));
	const novos = candidatos.filter((p) => !idsJaAdicionados.has(p.id));

	if (novos.length === 0) return 0;

	// D1 limita ~100 parâmetros por statement; cada linha tem 9 campos,
	// então um INSERT multi-linha com >11 policiais estouraria o limite.
	// db.batch() executa N statements em um único round-trip de forma atômica.
	const insertsLote = novos.map((p) =>
		db.insert(escalaPoliciais).values({
			escala_id: escalaId,
			policial_id: p.id,
			data_plantao: dataPlantao,
			data_saida: dataSaida,
			hora_entrada: horaEntrada,
			hora_saida: horaSaida
		})
	);
	await batchNonEmpty(db, insertsLote);

	return novos.length;
}

/**
 * Query (NÃO executada) da listagem de escalados, para compor
 * `db.batch([mutação, listarPoliciaisEscalaQuery(...)])` e resolver escrita +
 * releitura em um só round-trip ao D1.
 *
 * A ordenação é a da tabela na tela: por data de plantão, DPC antes de OIP
 * (`desc` no cargo, porque 'D' < 'O') e nome em ordem alfabética.
 */
export function listarPoliciaisEscalaQuery(db: Database, escalaId: number) {
	return db
		.select({
			id: escalaPoliciais.id,
			escala_id: escalaPoliciais.escala_id,
			policial_id: escalaPoliciais.policial_id,
			data_plantao: escalaPoliciais.data_plantao,
			data_saida: escalaPoliciais.data_saida,
			horario: escalaPoliciais.horario,
			hora_entrada: escalaPoliciais.hora_entrada,
			hora_saida: escalaPoliciais.hora_saida,
			observacoes: escalaPoliciais.observacoes,
			nome: policiais.nome,
			matricula: policiais.matricula,
			cargo: policiais.cargo,
			telefone: policiais.telefone,
			lotacao: policiais.lotacao,
			regime: policiais.regime,
			classe: policiais.classe,
			equipe: escalaPoliciais.equipe
		})
		.from(escalaPoliciais)
		.innerJoin(policiais, eq(escalaPoliciais.policial_id, policiais.id))
		.where(eq(escalaPoliciais.escala_id, escalaId))
		.orderBy(asc(escalaPoliciais.data_plantao), desc(policiais.cargo), asc(policiais.nome));
}

/**
 * Escalados da escala, com os dados do policial já juntados — a mesma query de
 * `listarPoliciaisEscalaQuery`, executada. Use esta salvo quando precisar
 * compor um `db.batch`.
 *
 * Devolve UMA LINHA POR DIA de plantão do policial, não uma por policial: a
 * granularidade da tabela é (escala, policial, data).
 */
export async function listarPoliciaisEscala(
	db: Database,
	escalaId: number
): Promise<EscalaPolicialComDados[]> {
	const result = await listarPoliciaisEscalaQuery(db, escalaId);
	return result as EscalaPolicialComDados[];
}

// ---- Solicitações de Assinatura ----

/**
 * Registra o pedido de assinatura de uma escala mensal. O destinatário pode ser
 * um DPC específico (`destinatario_id`) ou o papel genérico — é o que decide
 * quem enxerga a escala fora da própria lotação.
 */
export async function criarSolicitacaoAssinatura(
	db: Database,
	escalaId: number,
	solicitanteId: number,
	tipo: 'unidade' | 'respondencia',
	destinatarioId?: number
) {
	await db
		.delete(escalaSolicitacoesAssinatura)
		.where(eq(escalaSolicitacoesAssinatura.escala_id, escalaId));
	await db.insert(escalaSolicitacoesAssinatura).values({
		escala_id: escalaId,
		solicitante_id: solicitanteId,
		tipo,
		destinatario_id: destinatarioId ?? null
	});
}

/**
 * A solicitação de assinatura dá a este admin DPC acesso à escala de outra
 * unidade? Decisão PURA (sem banco), reaproveitada pelo guard de permissão e
 * pelos testes de RBAC, que cobrem a matriz de casos sem tocar o D1.
 *
 * Concede quando:
 * - `respondencia` direcionada diretamente a este usuário — nomeação explícita
 *   vale mesmo fora do escopo administrativo, que é justamente o sentido de
 *   nomear alguém; OU
 * - `unidade` **E** a lotação da escala está dentro do escopo do admin
 *   (`lotacoesPermitidas`). Sem a segunda condição o ramo devolvia `true` para
 *   QUALQUER admin DPC, o que abria acesso cross-unidade/seccional — é o IDOR
 *   A1, e é por isso que a regra virou função testável.
 */
export function solicitacaoConcedeAcessoDpc(
	sol: { tipo: string; destinatario_id: number | null } | undefined,
	usuarioId: number,
	escalaLotacao: string | undefined,
	lotacoesPermitidas: string[] | undefined
): boolean {
	if (!sol) return false;
	if (sol.tipo === 'respondencia' && sol.destinatario_id === usuarioId) return true;
	if (sol.tipo === 'unidade') {
		return !!(escalaLotacao && lotacoesPermitidas?.includes(escalaLotacao));
	}
	return false;
}

/**
 * Versão com banco de `solicitacaoConcedeAcessoDpc`: lê a solicitação da escala
 * (há no máximo uma) e aplica a mesma regra. É o atalho usado pelo guard de
 * permissão; a regra em si mora na função pura acima.
 */
export async function temSolicitacaoParaDpcAdmin(
	db: Database,
	escalaId: number,
	usuarioId: number,
	lotacoesPermitidas?: string[],
	escalaLotacao?: string
): Promise<boolean> {
	const sol = await db
		.select({
			tipo: escalaSolicitacoesAssinatura.tipo,
			destinatario_id: escalaSolicitacoesAssinatura.destinatario_id
		})
		.from(escalaSolicitacoesAssinatura)
		.where(eq(escalaSolicitacoesAssinatura.escala_id, escalaId))
		.get();

	return solicitacaoConcedeAcessoDpc(sol, usuarioId, escalaLotacao, lotacoesPermitidas);
}

/**
 * A solicitação de assinatura da escala, completa, ou `undefined` se não houver
 * pedido pendente. Há no máximo uma: `criarSolicitacaoAssinatura` apaga a
 * anterior antes de inserir, então pedir de novo SUBSTITUI o destinatário.
 */
export async function buscarSolicitacaoAssinatura(db: Database, escalaId: number) {
	return db
		.select()
		.from(escalaSolicitacoesAssinatura)
		.where(eq(escalaSolicitacoesAssinatura.escala_id, escalaId))
		.get();
}

/** Revoga o pedido de assinatura — e, com ele, o acesso cross-unidade que ele concedia. */
export async function excluirSolicitacaoAssinatura(db: Database, escalaId: number) {
	await db
		.delete(escalaSolicitacoesAssinatura)
		.where(eq(escalaSolicitacoesAssinatura.escala_id, escalaId));
}

/**
 * Solicitações de várias escalas de uma vez, indexadas por `escala_id` — evita o
 * N+1 na lista de escalas, que mostra o selo "aguardando assinatura" em cada
 * linha.
 *
 * `Map` em vez de array porque o consumidor faz lookup por id, e escala sem
 * solicitação simplesmente não tem chave (nada de entrada nula para filtrar).
 * `escalaIds` vazio devolve `Map` vazio sem consultar o banco: `inArray` com
 * lista vazia gera SQL inválido no D1.
 *
 * `destinatario_nome` vem de `leftJoin` e fica `undefined` na solicitação por
 * papel genérico, que não nomeia ninguém.
 */
export async function listarSolicitacoesEscalas(
	db: Database,
	escalaIds: number[]
): Promise<
	Map<
		number,
		{ tipo: 'unidade' | 'respondencia'; destinatario_nome?: string; destinatario_id?: number }
	>
> {
	if (escalaIds.length === 0) return new Map();

	const rows = await db
		.select({
			escala_id: escalaSolicitacoesAssinatura.escala_id,
			tipo: escalaSolicitacoesAssinatura.tipo,
			destinatario_id: escalaSolicitacoesAssinatura.destinatario_id,
			destinatario_nome: policiais.nome
		})
		.from(escalaSolicitacoesAssinatura)
		.leftJoin(policiais, eq(policiais.id, escalaSolicitacoesAssinatura.destinatario_id))
		.where(inArray(escalaSolicitacoesAssinatura.escala_id, escalaIds));

	const map = new Map<
		number,
		{ tipo: 'unidade' | 'respondencia'; destinatario_nome?: string; destinatario_id?: number }
	>();
	for (const row of rows) {
		map.set(row.escala_id, {
			tipo: row.tipo as 'unidade' | 'respondencia',
			destinatario_id: row.destinatario_id ?? undefined,
			destinatario_nome: row.destinatario_nome ?? undefined
		});
	}
	return map;
}
