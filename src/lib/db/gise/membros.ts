/**
 * Escalar e desescalar policial em equipe de GISE — mais as checagens de
 * conflito que impedem escalar a mesma pessoa duas vezes.
 *
 * **Quem decide é a gravação; as checagens explicam.** Até ago/2026 era o
 * contrário: `adicionarGiseMembro` era um INSERT cru e a proteção inteira vinha
 * de consultas feitas ANTES dele. Entre a consulta e a gravação cabe outra
 * requisição — dois admins de seccionais diferentes alocavam o mesmo policial
 * ao mesmo tempo e os dois viam vaga livre (FLW-GISE-009). O resultado é uma
 * pessoa escalada em dois lugares no mesmo dia, que o termo de presença e o
 * relatório de extra depois atestam.
 *
 * Agora as duas regras que a corrida quebrava estão na própria escrita:
 *   - **exclusividade por GISE** — índice único `(gise_id, policial_id)`, com o
 *     `gise_id` derivado da equipe no próprio INSERT (migração 0044);
 *   - **capacidade da equipe** — `INSERT ... SELECT ... WHERE ocupados < limite`,
 *     que não pode ser constraint porque compara uma contagem com um limite
 *     guardado em OUTRA tabela.
 *
 * As funções `verificarConflito*` continuam existindo, e a mudança é de papel:
 * viraram DIAGNÓSTICO. Elas não decidem mais nada — servem para dizer ao
 * usuário POR QUE a gravação foi recusada, já que "zero linhas afetadas" não
 * conta qual das duas regras barrou. Se alguma delas divergir da SQL, o pior
 * caso passou a ser uma mensagem confusa, nunca uma escrita errada.
 *
 * A exceção é `verificarConflitoHorarioPolicial` (choque com OUTRA escala, GISE
 * ou comum): essa continua sendo pré-checagem de verdade, porque a sobreposição
 * de horário entre escalas não cabe na mesma escrita — e é conflito entre
 * escalas, não disputa pela mesma vaga.
 *
 * O horário efetivo é uma CASCATA de três níveis — equipe → seccional → GISE,
 * com o primeiro não-nulo vencendo. Comparar direto `giseEscalas.hora_entrada`
 * ignora a equipe que tem horário próprio, que é exatamente o caso em que o
 * conflito aparece.
 */
import { eq, and, or, ne, sql } from 'drizzle-orm';
import { ehViolacaoUnique } from '../../server/db-errors';
import { verificarConflitoEscalasNaoGise } from '../../server/escalas/conflict';
import {
	giseEscalas,
	giseSeccionais,
	giseEquipes,
	giseMembros,
	unidades
} from '../../server/schema';
import { linhasAfetadas, type Database } from '../core';
import { seOverlapam } from '../../gise/horarios';

/** Por que a alocação não entrou. `ok` = entrou. */
export type ResultadoAlocacao =
	{ ok: true } | { ok: false; motivo: 'equipe_inexistente' | 'sem_vaga' | 'ja_escalado' };

/**
 * Escala o policial na equipe — ou não escala, ATOMICAMENTE.
 *
 * Uma escrita só decide as duas coisas que a corrida quebrava:
 *
 * - o `WHERE` compara a ocupação ATUAL da equipe (no cargo do policial) com o
 *   limite da própria equipe. Duas requisições simultâneas não podem os dois ver
 *   vaga: o SQLite serializa as escritas, e a segunda reavalia a contagem já com
 *   a linha da primeira;
 * - o `gise_id` sai derivado do join `equipe → seccional`, e o índice único
 *   `(gise_id, policial_id)` recusa o segundo insert do mesmo policial na mesma
 *   GISE. Deriva-lo aqui é o que impede a coluna denormalizada de divergir.
 *
 * Zero linhas afetadas significa "a condição não valia mais" — sem vaga, ou equipe
 * inexistente. A violação do índice único vira `ja_escalado`. Nenhum dos dois é
 * exceção para o chamador: são respostas.
 */
export async function adicionarGiseMembro(
	db: Database,
	equipeId: number,
	policialId: number
): Promise<ResultadoAlocacao> {
	try {
		const r = await db.run(sql`
			INSERT INTO gise_membros (equipe_id, policial_id, gise_id)
			SELECT ${equipeId}, ${policialId}, s.gise_id
			FROM gise_equipes e
			JOIN gise_seccionais s ON e.gise_seccional_id = s.id
			WHERE e.id = ${equipeId}
			  AND (
				SELECT COUNT(*)
				FROM gise_membros m
				JOIN policiais p ON m.policial_id = p.id
				WHERE m.equipe_id = e.id
				  AND p.cargo = (SELECT cargo FROM policiais WHERE id = ${policialId})
			  ) < (
				CASE
					WHEN (SELECT cargo FROM policiais WHERE id = ${policialId}) = 'DPC'
					THEN e.slots_dpc
					ELSE e.slots_oip
				END
			  )
		`);

		if (linhasAfetadas(r) > 0) return { ok: true };

		// Zero linhas: ou a equipe não existe, ou a vaga acabou entre a tela e o
		// POST. Distinguir importa — "equipe não encontrada" e "vagas esgotadas"
		// levam o usuário a ações diferentes.
		const equipe = await db
			.select({ id: giseEquipes.id })
			.from(giseEquipes)
			.where(eq(giseEquipes.id, equipeId))
			.get();
		return { ok: false, motivo: equipe ? 'sem_vaga' : 'equipe_inexistente' };
	} catch (err) {
		// O índice único `(gise_id, policial_id)` — o policial já ocupa uma vaga
		// nesta GISE. É resposta esperada, não falha.
		if (ehViolacaoUnique(err)) return { ok: false, motivo: 'ja_escalado' };
		throw err;
	}
}

/**
 * Desescala o policial pelo id da LINHA de `gise_membros` (não pelo id do
 * policial): o mesmo policial pode ter mais de uma linha, e remover a errada
 * tiraria a pessoa da equipe errada.
 *
 * A presença já registrada (`gise_presencas`) NÃO é apagada — ela é vinculada à
 * GISE e ao policial, não à equipe. Quem remove alguém que já confirmou entrada
 * precisa tratar isso à parte.
 */
export async function removerGiseMembro(db: Database, id: number) {
	return db.delete(giseMembros).where(eq(giseMembros.id, id));
}

/**
 * O policial já está escalado nesta GISE, em qualquer seccional? Devolve
 * `{ ok: false, motivo }` com a seccional em que ele está, para a mensagem de
 * erro dizer ONDE — sem isso o admin que recebe "já escalado" não sabe onde
 * procurar.
 *
 * Regra: um policial serve em UMA equipe por GISE. É checagem de aplicação, não
 * do banco (não há unique em `(gise_id, policial_id)`, que teria de atravessar
 * duas tabelas).
 */
export async function verificarConflitoMembroGise(
	db: Database,
	giseId: number,
	policialId: number
): Promise<{ ok: boolean; motivo?: string }> {
	const membros = await db
		.select({ id: giseMembros.id, equipe_id: giseMembros.equipe_id, seccional_nome: unidades.nome })
		.from(giseMembros)
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(unidades, eq(giseSeccionais.seccional_id, unidades.id))
		.where(and(eq(giseMembros.policial_id, policialId), eq(giseSeccionais.gise_id, giseId)));

	if (membros.length > 0) {
		return {
			ok: false,
			motivo: `Policial já escalado nesta GISE na seccional ${membros[0].seccional_nome}`
		};
	}

	return { ok: true };
}

/**
 * O policial já está comprometido, naquele dia e horário, em outro lugar?
 *
 * Cobre as três formas de estar escalado, nesta ordem:
 *   1. escala não-GISE (plantão, expediente, FDS), via `escalas/conflict`;
 *   2. membro de equipe de OUTRA GISE;
 *   3. quadro de supervisão (supervisor/assessor/SEINT) de outra GISE.
 *
 * GISE `finalizada` não conta — já encerrou, não há sobreposição real. E a
 * própria GISE de destino é excluída por `giseIdExcluir`: sem isso, mover um
 * membro dentro da mesma escala colidiria consigo mesmo.
 *
 * O horário de um membro é resolvido em cascata — equipe → seccional → GISE —,
 * e é por isso que as queries trazem os três pares: o primeiro preenchido vence.
 *
 * Existe como função única porque as duas checagens públicas abaixo (entrar numa
 * equipe × assumir o quadro de supervisão) diferem apenas em COMO descobrem a
 * data e o horário de destino. Daqui para baixo eram ~70 linhas idênticas
 * duplicadas, nas duas portas que impedem o mesmo policial de estar em dois
 * lugares ao mesmo tempo.
 */
async function conflitoEmOutrasGises(
	db: Database,
	policialId: number,
	data: string,
	entrada: string,
	saida: string,
	giseIdExcluir: number
): Promise<{ ok: boolean; motivo?: string }> {
	const naoGiseCheck = await verificarConflitoEscalasNaoGise(db, policialId, data, entrada, saida);
	if (!naoGiseCheck.ok) return naoGiseCheck;

	const outraGiseNoMesmoDia = [
		ne(giseEscalas.id, giseIdExcluir),
		ne(giseEscalas.status, 'finalizada'),
		eq(giseEscalas.data_inicio, data)
	];

	const [membrosExistentes, supervisorGises] = await Promise.all([
		db
			.select({
				gise_hora_entrada: giseEscalas.hora_entrada,
				gise_hora_saida: giseEscalas.hora_saida,
				sec_hora_entrada: giseSeccionais.hora_entrada,
				sec_hora_saida: giseSeccionais.hora_saida,
				eq_hora_entrada: giseEquipes.hora_entrada,
				eq_hora_saida: giseEquipes.hora_saida
			})
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
			.where(and(eq(giseMembros.policial_id, policialId), ...outraGiseNoMesmoDia))
			.all(),
		db
			.select({
				gise_hora_entrada: giseEscalas.hora_entrada,
				gise_hora_saida: giseEscalas.hora_saida
			})
			.from(giseEscalas)
			.where(
				and(
					or(
						eq(giseEscalas.supervisor_id, policialId),
						eq(giseEscalas.assessor_id, policialId),
						eq(giseEscalas.seint1_id, policialId),
						eq(giseEscalas.seint2_id, policialId)
					),
					...outraGiseNoMesmoDia
				)
			)
			.all()
	]);

	for (const e of membrosExistentes) {
		const existenteEntrada = e.eq_hora_entrada ?? e.sec_hora_entrada ?? e.gise_hora_entrada;
		const existenteSaida = e.eq_hora_saida ?? e.sec_hora_saida ?? e.gise_hora_saida;
		if (seOverlapam(entrada, saida, existenteEntrada, existenteSaida)) {
			return {
				ok: false,
				motivo: `Policial já escalado como membro em outra GISE neste dia com horário conflitante (${existenteEntrada}–${existenteSaida})`
			};
		}
	}

	for (const g of supervisorGises) {
		if (seOverlapam(entrada, saida, g.gise_hora_entrada, g.gise_hora_saida)) {
			return {
				ok: false,
				motivo: `Policial já escalado como supervisor/SEINT em outra GISE neste dia com horário conflitante (${g.gise_hora_entrada}–${g.gise_hora_saida})`
			};
		}
	}

	return { ok: true };
}

/**
 * Verifica se o policial tem choque de horário em outra GISE (como membro)
 * no mesmo dia da equipe alvo.
 */
export async function verificarConflitoHorarioPolicial(
	db: Database,
	equipeId: number,
	policialId: number
): Promise<{ ok: boolean; motivo?: string }> {
	const target = await db
		.select({
			gise_id: giseEscalas.id,
			data_inicio: giseEscalas.data_inicio,
			gise_hora_entrada: giseEscalas.hora_entrada,
			gise_hora_saida: giseEscalas.hora_saida,
			sec_hora_entrada: giseSeccionais.hora_entrada,
			sec_hora_saida: giseSeccionais.hora_saida,
			eq_hora_entrada: giseEquipes.hora_entrada,
			eq_hora_saida: giseEquipes.hora_saida
		})
		.from(giseEquipes)
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(giseEscalas, eq(giseSeccionais.gise_id, giseEscalas.id))
		.where(eq(giseEquipes.id, equipeId))
		.get();

	if (!target) return { ok: false, motivo: 'Equipe não encontrada' };

	// Horário do membro: equipe → seccional → GISE, o primeiro preenchido vence.
	const novaEntrada = target.eq_hora_entrada ?? target.sec_hora_entrada ?? target.gise_hora_entrada;
	const novaSaida = target.eq_hora_saida ?? target.sec_hora_saida ?? target.gise_hora_saida;

	return conflitoEmOutrasGises(
		db,
		policialId,
		target.data_inicio,
		novaEntrada,
		novaSaida,
		target.gise_id
	);
}

/**
 * Verifica se o policial tem choque de horário ao ser atribuído como supervisor/assessor/seint
 * em uma GISE — verifica conflito com outras GISEs ativas no mesmo dia.
 */
export async function verificarConflitoHorarioPorGise(
	db: Database,
	giseId: number,
	policialId: number
): Promise<{ ok: boolean; motivo?: string }> {
	const gise = await db
		.select({
			data_inicio: giseEscalas.data_inicio,
			hora_entrada: giseEscalas.hora_entrada,
			hora_saida: giseEscalas.hora_saida
		})
		.from(giseEscalas)
		.where(eq(giseEscalas.id, giseId))
		.get();

	if (!gise) return { ok: false, motivo: 'GISE não encontrada' };

	// O quadro de supervisão não pertence a equipe nenhuma: o horário é o da
	// própria GISE, sem a cascata equipe → seccional.
	return conflitoEmOutrasGises(
		db,
		policialId,
		gise.data_inicio,
		gise.hora_entrada,
		gise.hora_saida,
		giseId
	);
}
