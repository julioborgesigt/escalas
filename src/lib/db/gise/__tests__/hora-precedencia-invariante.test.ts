/**
 * A premissa que faz as QUATRO cópias da precedência de horário GISE
 * concordarem — e o dia em que ela cair.
 *
 * `equipe → seccional → escala` está escrita em quatro lugares, com alias
 * diferente em cada consulta (o JSDoc de `horaEfetivaGiseMembro`, em
 * `server/escalas/conflict.ts`, lista os quatro). Duas variantes terminam a
 * cadeia sem fallback e devolvem `null`; a de `participacao.ts` fecha com
 * `?? '08:00'`.
 *
 * Elas concordam hoje **porque o último elo nunca é nulo**:
 * `gise_escalas.hora_entrada`/`hora_saida` são `NOT NULL DEFAULT`. Tornar
 * essas colunas nullable faria `participacao.ts` seguir devolvendo horário
 * enquanto os outros três passam a devolver `null` — e `conflict.ts` trata
 * `null` como "sem conflito", ou seja, deixaria de barrar sobreposição.
 *
 * Este teste é o que transforma esse aviso em obstáculo: comentário protege
 * quem lê o arquivo, teste protege quem não sabe que ele existe.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { bancoMigrado } from '../../__tests__/sqlite-migrado';

let sqlite: DatabaseSync;

type ColunaInfo = { name: string; notnull: number; dflt_value: string | null };

function coluna(tabela: string, nome: string): ColunaInfo | undefined {
	return (sqlite.prepare(`PRAGMA table_info(${tabela})`).all() as ColunaInfo[]).find(
		(c) => c.name === nome
	);
}

beforeEach(() => {
	sqlite = bancoMigrado();
});

describe('precedência de horário GISE — a premissa das quatro cópias', () => {
	it('gise_escalas.hora_entrada/hora_saida são NOT NULL — o último elo da cadeia', () => {
		for (const nome of ['hora_entrada', 'hora_saida']) {
			const c = coluna('gise_escalas', nome);
			expect(c, `gise_escalas.${nome} sumiu`).toBeDefined();
			expect(
				c!.notnull,
				`gise_escalas.${nome} virou NULLABLE — as quatro cópias da precedência ` +
					`equipe→seccional→escala passam a divergir, e conflict.ts deixa de ` +
					`barrar sobreposição (null = "sem conflito"). Ver o JSDoc de ` +
					`horaEfetivaGiseMembro em server/escalas/conflict.ts.`
			).toBe(1);
		}
	});

	it('e têm DEFAULT, para a linha nascer com horário mesmo sem o chamador informar', () => {
		expect(coluna('gise_escalas', 'hora_entrada')!.dflt_value).toContain('08:00');
		expect(coluna('gise_escalas', 'hora_saida')!.dflt_value).toContain('16:00');
	});

	it('seccional e equipe SÃO nullable — é o que dá sentido à precedência', () => {
		// Se os três níveis fossem NOT NULL, o `??` nunca cairia para o próximo e
		// a precedência seria decoração: a equipe venceria sempre.
		for (const [tabela, nome] of [
			['gise_seccionais', 'hora_entrada'],
			['gise_seccionais', 'hora_saida'],
			['gise_equipes', 'hora_entrada'],
			['gise_equipes', 'hora_saida']
		]) {
			expect(coluna(tabela, nome)!.notnull, `${tabela}.${nome}`).toBe(0);
		}
	});
});
