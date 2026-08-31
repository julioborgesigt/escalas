/**
 * O plano operacional em si: criar, ler, editar, excluir.
 *
 * ## O número do plano sai da própria escrita
 *
 * `numero` é sequencial POR ANO e aparece na capa do documento
 * ("PLANO OPERACIONAL 123/2026"). Ele NÃO é calculado por um `SELECT MAX`
 * seguido de um `INSERT`: entre os dois cabe outra requisição, e o resultado
 * seriam dois planos com o mesmo número impresso — cada um convencido de ser o
 * 123/2026.
 *
 * A numeração acontece DENTRO do INSERT (`INSERT ... SELECT MAX+1 ... WHERE
 * ano = ?`), e o `UNIQUE (ano, numero)` é a tranca de verdade. É a mesma lição
 * de `uq_escalas_mensal` (migração 0063) e de `adicionarGiseMembro`: quem
 * decide é a gravação, não a consulta.
 *
 * ## Exclusão
 *
 * Plano se exclui de verdade — diferente de `operacoes`, que só desativa. A
 * razão da diferença é que operação é referenciada por escala histórica e PDF
 * assinado, enquanto um plano não é referenciado por nada: ele é a folha do
 * documento. O que o `CASCADE` leva junto (equipes, membros) só existe para
 * ele.
 *
 * O que NÃO se exclui é a versão de valores que ele aplicou — `custo_parametro_id`
 * é `RESTRICT`, e por isso a exclusão do plano nunca alcança `custo_parametros`.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { planosOperacionais } from '../../server/schema';
import type { PlanoOperacional } from '../../server/schema';
import { linhasAfetadas, type Database } from '../core';

/** O que a tela de criação envia. `numero` e `ano` NÃO entram: quem os decide é o banco. */
export interface EntradaPlano {
	nome: string;
	finalidade?: string;
	acoes?: string;
	nup?: string | null;
	data_inicio: string;
	hora_inicio?: string;
	data_fim?: string | null;
	hora_fim?: string | null;
	feriado?: boolean;
	coordenador_id?: number | null;
	demandante_unidade_id?: number | null;
	departamento?: string;
	oip_por_equipe_padrao?: number;
	/** O DPC escolhido na busca; `diretor_nome` é o texto congelado que o PDF imprime. */
	diretor_id?: number | null;
	diretor_nome?: string;
	diretor_cargo?: string;
	custo_parametro_id?: number | null;
}

/** Os campos que a edição pode tocar. `numero`/`ano` ficam de fora — ver o cabeçalho. */
export type PatchPlano = Partial<{
	nome: string;
	finalidade: string;
	acoes: string;
	nup: string | null;
	data_inicio: string;
	hora_inicio: string;
	data_fim: string | null;
	hora_fim: string | null;
	feriado: boolean;
	coordenador_id: number | null;
	demandante_unidade_id: number | null;
	departamento: string;
	oip_por_equipe_padrao: number;
	diretor_id: number | null;
	diretor_nome: string;
	diretor_cargo: string;
	custo_parametro_id: number | null;
	status: 'rascunho' | 'concluido';
}>;

/** O ano civil de uma data ISO `YYYY-MM-DD`. */
function anoDe(dataISO: string): number {
	return Number(dataISO.slice(0, 4));
}

/**
 * Cria o plano com número sequencial do ano da sua data de início, e devolve
 * id e número.
 *
 * O ano vem de `data_inicio`, não do relógio: um plano montado em dezembro para
 * uma operação de janeiro é 01/2027, não 145/2026 — é a data da operação que o
 * documento carrega na capa.
 */
export async function criarPlano(
	db: Database,
	dados: EntradaPlano
): Promise<{ id: number; numero: number; ano: number }> {
	const ano = anoDe(dados.data_inicio);

	const [row] = await db
		.insert(planosOperacionais)
		.values({
			// A numeração inteira acontece aqui dentro. Ver o cabeçalho do módulo.
			numero: sql`(SELECT COALESCE(MAX(${planosOperacionais.numero}), 0) + 1 FROM ${planosOperacionais} WHERE ${planosOperacionais.ano} = ${ano})`,
			ano,
			nome: dados.nome,
			finalidade: dados.finalidade ?? '',
			acoes: dados.acoes ?? '',
			nup: dados.nup ?? null,
			data_inicio: dados.data_inicio,
			hora_inicio: dados.hora_inicio ?? '08:00',
			data_fim: dados.data_fim ?? null,
			hora_fim: dados.hora_fim ?? null,
			feriado: dados.feriado ?? false,
			coordenador_id: dados.coordenador_id ?? null,
			demandante_unidade_id: dados.demandante_unidade_id ?? null,
			departamento: dados.departamento ?? 'DPI SUL',
			oip_por_equipe_padrao: dados.oip_por_equipe_padrao ?? 4,
			diretor_id: dados.diretor_id ?? null,
			diretor_nome: dados.diretor_nome ?? '',
			diretor_cargo: dados.diretor_cargo ?? '',
			custo_parametro_id: dados.custo_parametro_id ?? null
		})
		.returning({ id: planosOperacionais.id, numero: planosOperacionais.numero });

	return { id: row.id, numero: row.numero, ano };
}

/** Um plano pelo id, ou `null`. */
export async function buscarPlano(db: Database, id: number): Promise<PlanoOperacional | null> {
	const row = await db.select().from(planosOperacionais).where(eq(planosOperacionais.id, id)).get();
	return row ?? null;
}

/** Uma linha da lista de planos, com o que o card mostra sem abrir o plano. */
export interface PlanoDaLista extends PlanoOperacional {
	/** Quantas equipes o plano tem — a lista mostra o porte da operação. */
	equipes: number;
}

/**
 * Todos os planos, do mais recente para o mais antigo (por data de operação).
 *
 * Ordena por `data_inicio` e não por `created_at`: o que a lista responde é
 * "que operações vêm aí / vieram", não "o que foi digitado por último".
 */
export async function listarPlanos(db: Database): Promise<PlanoDaLista[]> {
	const linhas = await db
		.select({
			plano: planosOperacionais,
			// Nomes de tabela ESCRITOS À MÃO, e não `${planoEquipes}` / `${planosOperacionais.id}`.
			//
			// Com uma tabela só no FROM, o drizzle emite as colunas SEM qualificar
			// — `WHERE "plano_id" = "id"`. Numa subconsulta correlacionada isso
			// muda o significado: dentro de `FROM plano_equipes`, `"id"` resolve
			// para `plano_equipes.id`, não para o `planos_operacionais.id` de fora.
			// A correlação se perde, o SQL continua VÁLIDO e a contagem sai errada
			// sem erro nenhum (o teste pegou 1 no lugar de 3).
			equipes: sql<number>`(SELECT COUNT(*) FROM plano_equipes WHERE plano_equipes.plano_id = planos_operacionais.id)`
		})
		.from(planosOperacionais)
		.orderBy(desc(planosOperacionais.data_inicio), desc(planosOperacionais.id))
		.all();

	return linhas.map((l) => ({ ...l.plano, equipes: Number(l.equipes) }));
}

/**
 * Patch do plano. Toca só as chaves presentes — omitir é "não mexer", e passar
 * `null` num campo anulável APAGA o valor.
 *
 * `updated_at` é reescrito em toda chamada: é o que a tela usa para dizer
 * "salvo às HH:MM" sem precisar de um segundo write.
 */
export async function atualizarPlano(
	db: Database,
	id: number,
	dados: PatchPlano
): Promise<boolean> {
	const r = await db
		.update(planosOperacionais)
		.set({ ...dados, updated_at: sql`(datetime('now', '-3 hours'))` })
		.where(eq(planosOperacionais.id, id));
	return linhasAfetadas(r) > 0;
}

/**
 * Exclui o plano. Equipes e membros vão junto pelo CASCADE; a versão de valores
 * que ele aplicou NÃO vai (é `RESTRICT`, e continua servindo aos outros planos).
 *
 * Devolve `false` quando não havia plano com esse id — o chamador transforma
 * isso em 404 em vez de responder sucesso para uma exclusão que não aconteceu.
 */
export async function excluirPlano(db: Database, id: number): Promise<boolean> {
	const r = await db.delete(planosOperacionais).where(eq(planosOperacionais.id, id));
	return linhasAfetadas(r) > 0;
}

/**
 * O plano de um dado (ano, número) — como o documento o identifica.
 *
 * Serve à conferência: alguém com o PDF na mão quer achar o registro de origem.
 */
export async function buscarPlanoPorNumero(
	db: Database,
	ano: number,
	numero: number
): Promise<PlanoOperacional | null> {
	const row = await db
		.select()
		.from(planosOperacionais)
		.where(and(eq(planosOperacionais.ano, ano), eq(planosOperacionais.numero, numero)))
		.get();
	return row ?? null;
}
