/**
 * Quantas MEIAS DIÁRIAS cada servidor já tem lançadas em cada mês.
 *
 * Existe para o teto do art. 13 do Decreto nº 35.922/2024 — 15 diárias por mês,
 * por agente público. Ninguém contava isso: `plano_equipes.diarias_meias` é da
 * EQUIPE, e a mesma quantidade vale para cada um dos seus membros, então a
 * contagem por pessoa só aparece cruzando as duas tabelas.
 *
 * ## A atribuição é por DATA, não pelo mês em que a missão começou
 *
 * Decisão da corporação, e é o que `meiasPorMes` implementa: uma missão de 28 de
 * setembro a 3 de outubro lança 3 diárias em setembro e 2,5 em outubro. Somar
 * tudo no mês de início deixaria passar um servidor que estoura outubro, e
 * barraria outro que não estoura setembro.
 *
 * Por isso a soma é feita em JS, e não com `GROUP BY substr(data, 1, 7)`: o SQL
 * agruparia pela data de início da equipe, que é justamente a conta errada.
 *
 * ## O que este módulo NÃO conta
 *
 * A futura aba de solicitação avulsa de diária. Quando ela existir, o total do
 * mês passa a ser a soma das duas fontes — e é aqui que a segunda entra, não num
 * segundo contador ao lado.
 */
import { and, eq, gt, inArray } from 'drizzle-orm';
import { planoEquipes, planoEquipeMembros, planosOperacionais } from '../../server/schema';
import { meiasPorMes } from '../../diarias/contagem';
import { janelaDaEquipe } from './equipes';
import type { Database } from '../core';

/** `Map<policial_id, Map<'YYYY-MM', meias>>`. */
export type LancamentosPorServidor = Map<number, Map<string, number>>;

/**
 * O extrato mensal dos servidores indicados, somando todo plano que já lhes
 * atribuiu diária.
 *
 * `ignorarPlanoId` exclui um plano do total — é o que permite perguntar "quanto
 * este servidor tem lançado FORA do plano que estou montando", sem a equipe
 * atual contar contra si mesma ao ser reavaliada.
 *
 * Devolve um mapa vazio para servidor sem lançamento nenhum; quem consulta
 * trata a ausência como zero.
 */
export async function lancamentosMensais(
	db: Database,
	policiaisIds: number[],
	ignorarPlanoId?: number
): Promise<LancamentosPorServidor> {
	const out: LancamentosPorServidor = new Map();
	if (policiaisIds.length === 0) return out;

	const linhas = await db
		.select({
			policial_id: planoEquipeMembros.policial_id,
			plano_id: planoEquipes.plano_id,
			meias: planoEquipes.diarias_meias,
			equipe_data_inicio: planoEquipes.data_inicio,
			equipe_hora_inicio: planoEquipes.hora_inicio,
			equipe_hora_fim: planoEquipes.hora_fim,
			plano_data_inicio: planosOperacionais.data_inicio,
			plano_hora_inicio: planosOperacionais.hora_inicio,
			plano_data_fim: planosOperacionais.data_fim,
			plano_hora_fim: planosOperacionais.hora_fim,
			plano_feriado: planosOperacionais.feriado
		})
		.from(planoEquipeMembros)
		.innerJoin(planoEquipes, eq(planoEquipeMembros.equipe_id, planoEquipes.id))
		.innerJoin(planosOperacionais, eq(planoEquipes.plano_id, planosOperacionais.id))
		.where(
			and(
				inArray(planoEquipeMembros.policial_id, policiaisIds),
				eq(planoEquipes.tipo_custo, 'diaria'),
				gt(planoEquipes.diarias_meias, 0)
			)
		)
		.all();

	for (const l of linhas) {
		if (ignorarPlanoId !== undefined && l.plano_id === ignorarPlanoId) continue;

		// A MESMA cascata que a tela e o PDF usam — a janela da equipe é quem sabe
		// se a missão virou o dia (equipe que sai às 23h da véspera).
		const janela = janelaDaEquipe(
			{
				data_inicio: l.equipe_data_inicio,
				hora_inicio: l.equipe_hora_inicio,
				hora_fim: l.equipe_hora_fim
			},
			{
				data_inicio: l.plano_data_inicio,
				hora_inicio: l.plano_hora_inicio,
				data_fim: l.plano_data_fim,
				hora_fim: l.plano_hora_fim,
				feriado: l.plano_feriado
			}
		);

		const porMes = meiasPorMes(janela.dataInicio, janela.dataFim ?? janela.dataInicio);
		// A quantidade GRAVADA é a que vale — o Admin Geral pode tê-la ajustado, e
		// é ela que virou dinheiro. `meiasPorMes` entra só para dizer o PESO de
		// cada mês; a soma é rateada por ele.
		const totalDaContagem = [...porMes.values()].reduce((a, b) => a + b, 0);
		if (totalDaContagem === 0) continue;

		const doServidor = out.get(l.policial_id) ?? new Map<string, number>();
		for (const [mes, peso] of porMes) {
			const parcela = Math.round((l.meias * peso) / totalDaContagem);
			doServidor.set(mes, (doServidor.get(mes) ?? 0) + parcela);
		}
		out.set(l.policial_id, doServidor);
	}

	return out;
}

/**
 * O MAIOR extrato entre os servidores indicados, mês a mês.
 *
 * É o recorte de que a equipe precisa: se um único membro estoura o teto, a
 * equipe inteira precisa ser conferida — a diária é a mesma para todos eles, e
 * não há como conceder a uns e não a outros dentro da mesma linha do Anexo II.
 */
export function piorExtratoDaEquipe(
	lancamentos: LancamentosPorServidor,
	policiaisIds: number[]
): Map<string, number> {
	const pior = new Map<string, number>();
	for (const id of policiaisIds) {
		for (const [mes, meias] of lancamentos.get(id) ?? []) {
			if (meias > (pior.get(mes) ?? 0)) pior.set(mes, meias);
		}
	}
	return pior;
}
