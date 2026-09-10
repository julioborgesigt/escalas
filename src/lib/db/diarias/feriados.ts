/**
 * Calendário de feriados, do banco para o módulo de diárias.
 *
 * A tabela é semeada por `scripts/gerar-feriados.mjs` (hoje só o calendário
 * nacional; o cabeçalho do script diz o que entra e por quê). Este módulo só
 * LÊ: o calendário sugere, o solicitante confirma ou declara ponto facultativo
 * à mão, e o que vale para o pedido fica gravado no próprio pedido — atualizar
 * a tabela nunca muda pedido já feito.
 *
 * Primeiro arquivo de `db/diarias/`: o domínio do módulo de diárias, separado
 * de `db/planos/` (plano operacional) como `db/gise/` é separado de
 * `db/escalas`.
 */
import { and, between, eq, or } from 'drizzle-orm';
import { feriados } from '../../server/schema';
import type { Feriado } from '../../server/schema';
import type { Database } from '../core';

/**
 * Os feriados que caem entre `inicio` e `fim` (ISO `YYYY-MM-DD`, inclusivos):
 * os nacionais e, quando houver, os estaduais da `uf`. Em ordem de data.
 *
 * Dois pedidos de escopo diferente para a mesma data (nacional e estadual)
 * saem como duas linhas — quem consome monta o conjunto de datas.
 */
export async function feriadosNoIntervalo(
	db: Database,
	inicio: string,
	fim: string,
	uf = 'CE'
): Promise<Feriado[]> {
	return db
		.select()
		.from(feriados)
		.where(
			and(
				between(feriados.data, inicio, fim),
				or(eq(feriados.abrangencia, 'nacional'), eq(feriados.uf, uf))
			)
		)
		.orderBy(feriados.data)
		.all();
}
