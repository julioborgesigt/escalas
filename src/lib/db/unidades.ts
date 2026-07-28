import { eq, asc } from 'drizzle-orm';
import { unidades, policiais, escalas } from '../server/schema';
import type * as schema from '../server/schema';
import type { Database } from './core';

/**
 * Unidades (departamentos, seccionais e delegacias).
 *
 * Ponto central do modelo: policiais e escalas referenciam a unidade pelo
 * NOME (`policiais.lotacao`, `escalas.lotacao`), não por chave estrangeira —
 * herança da planilha que originou o sistema. Por isso renomear cascateia
 * (ver `atualizarUnidade`) e excluir exige checar vínculos antes.
 */

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

/** Exclusão crua — quem chama precisa checar escalas/policiais vinculados antes. */
export async function excluirUnidade(db: Database, id: number) {
	return db.delete(unidades).where(eq(unidades.id, id));
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
