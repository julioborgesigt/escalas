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

/** Todas as unidades em ordem alfabética — não há filtro de ativo/inativo. */
export async function listarUnidades(db: Database): Promise<schema.Unidade[]> {
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

/** Contagem de registros que impedem a exclusão de uma unidade. */
export interface VinculosUnidade {
	escalas: number;
	policiaisLotados: number;
	policiaisComPapel: number;
	unidadesFilhas: number;
	gises: number;
}

/**
 * Mensagem de bloqueio para os vínculos encontrados, ou `null` se a unidade
 * pode ser excluída. Pura, para que a matriz de casos seja testável sem banco.
 *
 * Lista TODOS os vínculos de uma vez, não o primeiro que encontra: quem está
 * desativando uma unidade precisa saber o tamanho do trabalho antes de começar,
 * e descobrir uma pendência por vez a cada tentativa é o que faz alguém
 * desistir no meio e deixar a base inconsistente.
 */
export function descreverBloqueioUnidade(v: VinculosUnidade): string | null {
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

	const lista =
		partes.length === 1
			? partes[0]
			: `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
	return `Não é possível excluir: esta unidade ainda tem ${lista}. Transfira ou remova esses vínculos antes.`;
}

/**
 * Exclui a unidade, RECUSANDO se ainda houver qualquer vínculo apontando para
 * ela. Devolve `{ ok: false, motivo }` em vez de lançar — o chamador transforma
 * em 409.
 *
 * A checagem mora aqui, e não na action, porque nada no banco a substitui: os
 * dois vínculos mais comuns (escala e lotação de policial) são por NOME, sem
 * chave estrangeira, e apagar a unidade os deixaria apontando para um nome
 * inexistente sem erro nenhum. O RBAC até falha fechado nesse estado (o admin
 * simplesmente perde o escopo), o que torna o estrago silencioso — que é pior.
 *
 * `gise_seccionais` é o único com FK `ON DELETE RESTRICT`: ali o banco já
 * bloquearia, mas como erro de constraint, que chegaria ao usuário como 500 com
 * SQL cru. Checar antes troca isso por uma frase que diz o que fazer.
 */
export async function excluirUnidade(
	db: Database,
	id: number
): Promise<{ ok: true } | { ok: false; motivo: string }> {
	const unidade = await db
		.select({ nome: unidades.nome })
		.from(unidades)
		.where(eq(unidades.id, id))
		.get();
	if (!unidade) return { ok: false, motivo: 'Unidade não encontrada' };

	const motivo = descreverBloqueioUnidade(await contarVinculosUnidade(db, id, unidade.nome));
	if (motivo) return { ok: false, motivo };

	await db.delete(unidades).where(eq(unidades.id, id));
	return { ok: true };
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
