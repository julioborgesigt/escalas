/**
 * Unidades (departamentos, seccionais e delegacias).
 *
 * Ponto central do modelo: policiais e escalas referenciam a unidade pelo
 * NOME (`policiais.lotacao`, `escalas.lotacao`), não por chave estrangeira —
 * herança da planilha que originou o sistema. As duas consequências disso são
 * as duas operações perigosas deste arquivo:
 *
 * - **renomear cascateia** (`atualizarUnidade` propaga o nome novo para
 *   policiais e escalas na mesma operação);
 * - **excluir é recusado enquanto houver vínculo** (`excluirUnidade` checa e
 *   devolve `{ ok: false }`). A checagem mora AQUI, não em quem chama: era
 *   responsabilidade do chamador antes, e o único chamador implementava só
 *   metade dela.
 */
import { eq, asc } from 'drizzle-orm';
import { unidades, policiais, escalas, giseSeccionais } from '../server/schema';
import type * as schema from '../server/schema';
import type { Database } from './core';

/** Campos editáveis de uma unidade (mesmo shape em criar e atualizar). */
type DadosUnidade = {
	nome: string;
	tipo: 'departamento' | 'sub_departamento' | 'seccional' | 'delegacia';
	seccional_id: number | null;
	tem_plantao: boolean;
	tem_expediente: boolean;
	tem_fds: boolean;
	cidade: string;
};

/**
 * Unidades ATIVAS, em ordem alfabética — é a lista de ESCOLHA (combo de nova
 * escala, lotação de policial, seccional da GISE).
 *
 * Desativada não aparece aqui de propósito: o objetivo de desativar é sumir das
 * opções sem deixar de existir. Para telas que precisam ver o histórico
 * completo — a própria gestão de unidades, e qualquer resolução de nome de
 * registro antigo — use `listarTodasUnidades`.
 */
export async function listarUnidades(db: Database): Promise<schema.Unidade[]> {
	return db.select().from(unidades).where(eq(unidades.ativo, true)).orderBy(asc(unidades.nome));
}

/** Todas as unidades, ativas e desativadas. Para a tela de gestão. */
export async function listarTodasUnidades(db: Database): Promise<schema.Unidade[]> {
	return db.select().from(unidades).orderBy(asc(unidades.nome));
}

/**
 * Cria a unidade. O `nome` é a chave real do modelo (é por ele que policiais e
 * escalas se ligam) e vai `trim()`ado por isso: espaço sobrando cria uma unidade
 * que parece existir mas não casa com nenhuma lotação.
 *
 * As flags `tem_*` definem quais tipos de escala a unidade aceita e são o que a
 * tela de nova escala consulta.
 */
export async function criarUnidade(db: Database, data: DadosUnidade) {
	return db.insert(unidades).values({
		nome: data.nome.trim(),
		tipo: data.tipo,
		tem_plantao: data.tem_plantao,
		tem_expediente: data.tem_expediente,
		tem_fds: data.tem_fds,
		cidade: data.cidade || '',
		seccional_id: data.seccional_id ?? null
	});
}

/**
 * Atualiza a unidade e, se o nome mudou, propaga a troca para `policiais.lotacao`
 * e `escalas.lotacao` — sem isso os vínculos por nome se perderiam em silêncio.
 * Devolve o nome anterior para o diff da auditoria.
 */
export async function atualizarUnidade(
	db: Database,
	id: number,
	data: DadosUnidade
): Promise<{ nomeAntigo: string }> {
	const unidade = await db
		.select({ nome: unidades.nome })
		.from(unidades)
		.where(eq(unidades.id, id))
		.get();
	if (!unidade) throw new Error('Unidade não encontrada');
	const nomeAntigo = unidade.nome;
	const nomeTrimmed = data.nome.trim();

	await db
		.update(unidades)
		.set({
			nome: nomeTrimmed,
			tipo: data.tipo,
			seccional_id: data.seccional_id,
			tem_plantao: data.tem_plantao,
			tem_expediente: data.tem_expediente,
			tem_fds: data.tem_fds,
			cidade: data.cidade || ''
		})
		.where(eq(unidades.id, id));

	// Cascata manual (não há FK): tudo que apontava para o nome antigo passa a
	// apontar para o novo.
	if (nomeTrimmed !== nomeAntigo) {
		await db
			.update(policiais)
			.set({ lotacao: nomeTrimmed })
			.where(eq(policiais.lotacao, nomeAntigo));
		await db.update(escalas).set({ lotacao: nomeTrimmed }).where(eq(escalas.lotacao, nomeAntigo));
	}

	return { nomeAntigo };
}

/**
 * Quantos registros ainda apontam para a unidade, por tipo de vínculo.
 *
 * São cinco caminhos, e eles NÃO se equivalem — dois ligam por nome (herança da
 * planilha) e três por id:
 *
 * | vínculo             | como liga                       |
 * | ------------------- | ------------------------------- |
 * | escalas             | `escalas.lotacao` = nome        |
 * | policiais lotados   | `policiais.lotacao` = nome      |
 * | policiais com papel | `policiais.papel_unidade_id`    |
 * | unidades filhas     | `unidades.seccional_id`         |
 * | GISE                | `gise_seccionais.seccional_id`  |
 *
 * O `nome` vem por parâmetro, e não relido daqui, porque quem chama já carregou
 * a linha para a auditoria — reler abriria janela para checar um nome e apagar
 * outro.
 */
async function contarVinculosUnidade(
	db: Database,
	id: number,
	nome: string
): Promise<VinculosUnidade> {
	const [escalasVinc, lotados, comPapel, filhas, gises] = await Promise.all([
		db.select({ id: escalas.id }).from(escalas).where(eq(escalas.lotacao, nome)),
		db.select({ id: policiais.id }).from(policiais).where(eq(policiais.lotacao, nome)),
		db.select({ id: policiais.id }).from(policiais).where(eq(policiais.papel_unidade_id, id)),
		db.select({ id: unidades.id }).from(unidades).where(eq(unidades.seccional_id, id)),
		db
			.select({ id: giseSeccionais.id })
			.from(giseSeccionais)
			.where(eq(giseSeccionais.seccional_id, id))
	]);
	return {
		escalas: escalasVinc.length,
		policiaisLotados: lotados.length,
		policiaisComPapel: comPapel.length,
		unidadesFilhas: filhas.length,
		gises: gises.length
	};
}

/** Contagem de registros que apontam para uma unidade, por tipo de vínculo. */
export interface VinculosUnidade {
	escalas: number;
	policiaisLotados: number;
	policiaisComPapel: number;
	unidadesFilhas: number;
	gises: number;
}

/**
 * Frase legível com TODOS os vínculos da unidade, ou `null` se não houver
 * nenhum. Pura, para que a matriz de casos seja testável sem banco.
 *
 * É INFORMAÇÃO, não bloqueio: desativar uma unidade é sempre permitido, e os
 * vínculos continuam válidos depois (é justamente o ponto de desativar em vez
 * de excluir). A frase existe para quem confirma saber o tamanho do que está
 * mexendo — e lista tudo de uma vez, não um item por tentativa.
 */
export function descreverVinculosUnidade(v: VinculosUnidade): string | null {
	const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;
	const partes: string[] = [];
	if (v.escalas) partes.push(plural(v.escalas, 'escala', 'escalas'));
	if (v.policiaisLotados)
		partes.push(plural(v.policiaisLotados, 'servidor lotado', 'servidores lotados'));
	if (v.policiaisComPapel)
		partes.push(
			plural(
				v.policiaisComPapel,
				'servidor com papel administrativo',
				'servidores com papel administrativo'
			)
		);
	if (v.unidadesFilhas)
		partes.push(plural(v.unidadesFilhas, 'unidade subordinada', 'unidades subordinadas'));
	if (v.gises) partes.push(plural(v.gises, 'GISE', 'GISEs'));
	if (partes.length === 0) return null;

	return partes.length === 1
		? partes[0]
		: `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

/**
 * Vínculos da unidade, para a tela de confirmação de desativação.
 *
 * Não impede nada — quem chama usa só para exibir. Ver
 * `descreverVinculosUnidade` para a frase pronta.
 */
export async function vinculosDaUnidade(db: Database, id: number): Promise<VinculosUnidade | null> {
	const unidade = await db
		.select({ nome: unidades.nome })
		.from(unidades)
		.where(eq(unidades.id, id))
		.get();
	if (!unidade) return null;
	return contarVinculosUnidade(db, id, unidade.nome);
}

/**
 * Desativa (ou reativa) a unidade. **Não existe exclusão de unidade** — este é
 * o substituto, e é irreversível apenas no sentido de precisar de outra ação
 * para voltar.
 *
 * Por que não há DELETE, e por que isso não é excesso de zelo: o D1 aplica
 * chave estrangeira de verdade (verificado empiricamente), e
 * `gise_assinaturas_relatorios.seccional_id` referencia `unidades(id)`. Apagar
 * uma unidade levava junto o registro do ato de assinar — nome do assinante,
 * CPF, rubrica, selfie, IP, GPS, hash do arquivo e a chave do PDF no R2 — e o
 * portal público `/validar` passava a responder "documento não encontrado" para
 * um papel que alguém já tinha em mãos, indistinguível de documento falso.
 *
 * Os outros dois vínculos (escala e lotação) são por NOME, sem FK: ali o DELETE
 * não daria erro nenhum, só deixaria registros apontando para um nome que não
 * existe mais, com o RBAC falhando fechado em silêncio.
 *
 * Unidade desativada some das listas de ESCOLHA (`listarUnidades`), mas continua
 * existindo para todo o resto: escala antiga, lotação de policial e assinatura
 * de relatório seguem resolvendo normalmente.
 */
export async function definirUnidadeAtiva(db: Database, id: number, ativo: boolean) {
	return db.update(unidades).set({ ativo }).where(eq(unidades.id, id));
}

/**
 * Usada pelo webhook de sincronização: cria ou atualiza pelo nome.
 *
 * Os regimes (`tem_*`) só entram na criação, com tudo habilitado; num conflito
 * eles são preservados, para não desfazer o que o Super Admin configurou na
 * tela a cada sincronização.
 */
export async function upsertUnidade(
	db: Database,
	data: {
		nome: string;
		tipo: 'departamento' | 'sub_departamento' | 'seccional' | 'delegacia';
		seccional_id: number | null;
		cidade: string;
	}
) {
	return db
		.insert(unidades)
		.values({
			nome: data.nome.trim(),
			tipo: data.tipo,
			seccional_id: data.seccional_id,
			cidade: data.cidade || '',
			tem_plantao: true,
			tem_expediente: true,
			tem_fds: true
		})
		.onConflictDoUpdate({
			target: unidades.nome,
			set: {
				tipo: data.tipo,
				seccional_id: data.seccional_id,
				cidade: data.cidade || ''
			}
		});
}

/**
 * Resolve nome → unidade, aplicando o mesmo `trim()` da gravação. É o caminho
 * usado para transformar a `lotacao` (texto) de um policial na unidade de
 * verdade; `null` significa lotação órfã — nome que não corresponde a nenhuma
 * unidade cadastrada, situação normal em registros vindos do sync.
 */
export async function buscarUnidadePorNome(db: Database, nome: string) {
	if (!nome) return null;
	const trimmedNome = nome.trim();
	return db.select().from(unidades).where(eq(unidades.nome, trimmedNome)).get();
}

/** Apenas as unidades do tipo seccional (montagem da GISE e vínculo de delegacias). */
export async function buscarSeccionaisUnidades(db: Database) {
	return db
		.select()
		.from(unidades)
		.where(eq(unidades.tipo, 'seccional'))
		.orderBy(asc(unidades.nome))
		.all();
}
