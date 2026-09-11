/**
 * A matriz de tempo de trajeto, do banco para o módulo de diárias.
 *
 * Semeada por `scripts/gerar-tempos.mjs` (OSRM/OpenStreetMap sobre as sedes da
 * migração 0072); o cabeçalho dele explica por que é uma tabela separada da
 * matriz de distâncias e como a medição é conferida contra ela.
 *
 * Só PRÉ-PREENCHE a estimativa de jornada (`$lib/diarias/jornada`, entrada
 * `minutosIda`). O que vale para um pedido fica gravado no pedido; atualizar a
 * matriz nunca reescreve pedido já feito — a mesma decisão de
 * `distancias_municipios` e de `custo_parametros`.
 */
import { and, eq } from 'drizzle-orm';
import { temposMunicipios, temposMedicao } from '../../server/schema';
import type { Database } from '../core';

/** Quando a matriz foi medida e de onde veio — para a tela mostrar ao lado do número. */
export type ProcedenciaTempos = { fonte: string; medido_em: string } | null;

/**
 * Minutos de trajeto entre dois municípios, ou `null` quando o par não está
 * na matriz (município fora do Ceará, por exemplo — a viagem interestadual
 * pede o tempo à mão).
 *
 * Mesma cidade é ZERO, e não ausência: a matriz não guarda o par consigo
 * mesmo, mas quem sai e chega na mesma cidade levou zero minutos — é uma
 * medida, não a falta dela. A ordem dos códigos não importa: a linha é uma só,
 * com o menor código primeiro.
 */
export async function minutosEntreMunicipios(
	db: Database,
	a: string,
	b: string
): Promise<number | null> {
	if (!a || !b) return null;
	if (a === b) return 0;
	const [origem, destino] = a < b ? [a, b] : [b, a];
	const linha = await db
		.select({ minutos: temposMunicipios.minutos })
		.from(temposMunicipios)
		.where(
			and(eq(temposMunicipios.origem_ibge, origem), eq(temposMunicipios.destino_ibge, destino))
		)
		.get();
	return linha?.minutos ?? null;
}

/** A procedência da matriz gravada, ou `null` quando ela ainda não foi semeada. */
export async function procedenciaDosTempos(db: Database): Promise<ProcedenciaTempos> {
	const linha = await db
		.select({ fonte: temposMedicao.fonte, medido_em: temposMedicao.medido_em })
		.from(temposMedicao)
		.orderBy(temposMedicao.id)
		.get();
	return linha ?? null;
}
