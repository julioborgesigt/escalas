/**
 * Os servidores alocados às equipes do plano.
 *
 * ## Quem decide é a gravação
 *
 * As duas regras que uma corrida quebraria — um servidor por plano, um chefe
 * por equipe — são índices ÚNICOS no banco, não consultas prévias. Entre um
 * `SELECT` de conferência e o `INSERT` cabe outra requisição, e o resultado
 * seria a mesma pessoa contada duas vezes no Anexo II (custo inflado) ou duas
 * chefias na mesma equipe. É a lição já registrada em `adicionarGiseMembro`
 * (FLW-GISE-009): a consulta explica, a escrita decide.
 *
 * Por isso `adicionarMembro` não pergunta antes: tenta gravar e traduz a
 * violação de UNIQUE no motivo. `ehViolacaoUnique` (`$lib/server/db-errors`) é
 * quem reconhece o erro do driver — nunca `message.includes('UNIQUE')` à mão,
 * que é a duplicação que o `CLAUDE.md` cataloga.
 *
 * ## O snapshot de cargo e classe
 *
 * `cargo_snapshot`/`classe_snapshot` são copiados do cadastro no INSERT porque
 * são a BASE DE CÁLCULO do custo. Nome, matrícula, lotação e telefone continuam
 * saindo vivos do join com `policiais` — são identificação e contato, e o
 * documento deve trazer o dado atual. Uma promoção de classe muda o que a
 * pessoa recebe daqui para a frente; não muda o que já foi orçado.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { planoEquipes, planoEquipeMembros, policiais } from '../../server/schema';
import { ehViolacaoUnique } from '../../server/db-errors';
import { linhasAfetadas, type Database } from '../core';

/** Um membro com os dados do cadastro que o Anexo I imprime. */
export interface MembroDoPlano {
	id: number;
	equipe_id: number;
	policial_id: number;
	chefe: boolean;
	/** Congelados na alocação — a base de cálculo do custo. */
	cargo_snapshot: string;
	classe_snapshot: string;
	// ---- Vivos do cadastro ----
	nome: string;
	matricula: string;
	lotacao: string;
	telefone: string | null;
	/** Cargo e classe ATUAIS: divergem do snapshot quando houve promoção. */
	cargo_atual: string;
	classe_atual: string;
}

/** Por que a alocação não entrou. `ok` = entrou. */
export type ResultadoAlocacao =
	| { ok: true; id: number }
	| { ok: false; motivo: 'equipe_inexistente' | 'policial_inexistente' | 'ja_no_plano' };

/**
 * Aloca o policial na equipe, copiando cargo e classe do cadastro.
 *
 * O `plano_id` sai da PRÓPRIA equipe (subconsulta no INSERT), não de um
 * parâmetro: passá-lo de fora abriria a porta para gravar um membro com
 * `plano_id` de um plano e `equipe_id` de outro, que é justamente o estado que
 * o índice de exclusividade não conseguiria detectar.
 */
export async function adicionarMembro(
	db: Database,
	equipeId: number,
	policialId: number
): Promise<ResultadoAlocacao> {
	const equipe = await db
		.select({ plano_id: planoEquipes.plano_id })
		.from(planoEquipes)
		.where(eq(planoEquipes.id, equipeId))
		.get();
	if (!equipe) return { ok: false, motivo: 'equipe_inexistente' };

	const pol = await db
		.select({ cargo: policiais.cargo, classe: policiais.classe })
		.from(policiais)
		.where(eq(policiais.id, policialId))
		.get();
	if (!pol) return { ok: false, motivo: 'policial_inexistente' };

	try {
		const [row] = await db
			.insert(planoEquipeMembros)
			.values({
				equipe_id: equipeId,
				plano_id: equipe.plano_id,
				policial_id: policialId,
				cargo_snapshot: pol.cargo,
				classe_snapshot: pol.classe,
				chefe: false
			})
			.returning({ id: planoEquipeMembros.id });
		return { ok: true, id: row.id };
	} catch (e) {
		// `uq_plano_membros_plano_policial`: a pessoa já está em alguma equipe
		// deste plano. É a única violação de UNIQUE possível neste INSERT —
		// `chefe` entra sempre `false`, então o índice parcial do chefe não colide.
		if (ehViolacaoUnique(e)) return { ok: false, motivo: 'ja_no_plano' };
		throw e;
	}
}

/** Remove o membro. Devolve `false` se ele não existia. */
export async function removerMembro(db: Database, membroId: number): Promise<boolean> {
	const r = await db.delete(planoEquipeMembros).where(eq(planoEquipeMembros.id, membroId));
	return linhasAfetadas(r) > 0;
}

/**
 * Define o chefe da equipe, tirando a chefia de quem a tinha.
 *
 * Os dois UPDATEs vão num `batch` porque a ordem importa e o estado
 * intermediário é inválido: se o "limpa" falhasse depois do "marca", a equipe
 * ficaria com dois chefes — e o índice parcial recusaria o segundo, deixando a
 * operação pela metade com o erro vindo do lugar errado. Limpar ANTES e no
 * mesmo lote evita as duas coisas.
 */
export async function definirChefe(
	db: Database,
	equipeId: number,
	membroId: number
): Promise<boolean> {
	const membro = await db
		.select({ id: planoEquipeMembros.id })
		.from(planoEquipeMembros)
		.where(and(eq(planoEquipeMembros.id, membroId), eq(planoEquipeMembros.equipe_id, equipeId)))
		.get();
	// Membro de outra equipe não vira chefe desta: o id vem do formulário, e sem
	// esta conferência um POST direto marcaria como chefe alguém que a equipe
	// nem tem (o índice parcial não impede isso — ele só conta chefes por
	// equipe).
	if (!membro) return false;

	await db.batch([
		db
			.update(planoEquipeMembros)
			.set({ chefe: false })
			.where(eq(planoEquipeMembros.equipe_id, equipeId)),
		db.update(planoEquipeMembros).set({ chefe: true }).where(eq(planoEquipeMembros.id, membroId))
	]);
	return true;
}

/** Tira a chefia da equipe, sem designar outro. */
export async function limparChefe(db: Database, equipeId: number): Promise<void> {
	await db
		.update(planoEquipeMembros)
		.set({ chefe: false })
		.where(eq(planoEquipeMembros.equipe_id, equipeId));
}

/** Colunas do join, reaproveitadas pelas duas consultas abaixo. */
const COLUNAS_MEMBRO = {
	id: planoEquipeMembros.id,
	equipe_id: planoEquipeMembros.equipe_id,
	policial_id: planoEquipeMembros.policial_id,
	chefe: planoEquipeMembros.chefe,
	cargo_snapshot: planoEquipeMembros.cargo_snapshot,
	classe_snapshot: planoEquipeMembros.classe_snapshot,
	nome: policiais.nome,
	matricula: policiais.matricula,
	lotacao: policiais.lotacao,
	telefone: policiais.telefone,
	cargo_atual: policiais.cargo,
	classe_atual: policiais.classe
} as const;

/**
 * Os membros de UM plano inteiro, com os dados do cadastro.
 *
 * Uma consulta só para o plano todo, e não uma por equipe: o Anexo I precisa de
 * todas as equipes de uma vez, e N+1 consultas num Worker custam N+1 idas ao
 * D1. Quem separa por equipe é `agruparPorEquipe`.
 *
 * O chefe vem primeiro dentro de cada equipe — é como o documento o apresenta.
 */
export async function listarMembrosDoPlano(
	db: Database,
	planoId: number
): Promise<MembroDoPlano[]> {
	const linhas = await db
		.select(COLUNAS_MEMBRO)
		.from(planoEquipeMembros)
		.innerJoin(policiais, eq(policiais.id, planoEquipeMembros.policial_id))
		.where(eq(planoEquipeMembros.plano_id, planoId))
		.orderBy(
			asc(planoEquipeMembros.equipe_id),
			// `chefe` é 0/1 no SQLite: DESC coloca o 1 na frente.
			sql`${planoEquipeMembros.chefe} DESC`,
			asc(policiais.nome)
		)
		.all();
	return linhas.map((l) => ({ ...l, chefe: !!l.chefe }));
}

/** Agrupa por `equipe_id`, preservando a ordem em que os membros vieram. */
export function agruparPorEquipe(membros: MembroDoPlano[]): Map<number, MembroDoPlano[]> {
	const mapa = new Map<number, MembroDoPlano[]>();
	for (const m of membros) {
		const atual = mapa.get(m.equipe_id);
		if (atual) atual.push(m);
		else mapa.set(m.equipe_id, [m]);
	}
	return mapa;
}

/**
 * Reaplica cargo e classe ATUAIS do cadastro aos membros do plano.
 *
 * O snapshot congela a base de cálculo de propósito, mas há um caso em que
 * congelar é o erro: o servidor foi alocado ANTES de alguém corrigir a classe
 * que faltava no cadastro. Aí o snapshot guarda o vazio, o plano continua
 * bloqueado, e corrigir o cadastro sozinho não desbloqueia nada.
 *
 * Esta função é a saída para isso, e é EXPLÍCITA — um botão que o admin aperta,
 * nunca automática. Automática, ela desfaria a decisão de congelar: uma
 * promoção qualquer reescreveria em silêncio o custo de um plano já conferido.
 */
export async function ressincronizarSnapshots(db: Database, planoId: number): Promise<number> {
	// Tabelas qualificadas À MÃO nas subconsultas, e não por interpolação do
	// drizzle: com uma tabela no FROM ele emite a coluna sem prefixo, e num
	// subselect correlacionado isso muda a que tabela ela pertence — o SQL
	// continua válido e passa a atualizar a linha errada, sem erro. Foi assim que
	// a contagem de equipes de `listarPlanos` saiu 1 no lugar de 3.
	const r = await db.run(sql`
		UPDATE plano_equipe_membros
		SET cargo_snapshot = (SELECT policiais.cargo FROM policiais WHERE policiais.id = plano_equipe_membros.policial_id),
		    classe_snapshot = (SELECT policiais.classe FROM policiais WHERE policiais.id = plano_equipe_membros.policial_id)
		WHERE plano_equipe_membros.plano_id = ${planoId}
	`);
	return linhasAfetadas(r);
}
