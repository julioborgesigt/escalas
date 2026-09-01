/**
 * A matriz de distâncias rodoviárias, do banco para a tela.
 *
 * As tabelas (`municipios`, `distancias_municipios`, `distancias_medicao`) são
 * semeadas por `scripts/gerar-distancias.mjs`; o cabeçalho dele explica as
 * fontes e por que a atualização é sob demanda e revisada.
 *
 * ## A matriz que sobe para a tela é a do PLANO, não a inteira
 *
 * São 16.836 pares no banco e 3 a 8 cidades num plano. `matrizDoPlano` devolve
 * só os pares entre os municípios que aquele plano referencia — algumas dezenas
 * de números. É o que permite o card recalcular a distância enquanto o admin
 * troca os seletores, sem ida ao servidor a cada clique, e sem despejar meio
 * megabyte de matriz em toda abertura de página.
 */
import { and, eq, inArray, or } from 'drizzle-orm';
import {
	municipios,
	distanciasMunicipios,
	distanciasMedicao,
	planoOpcoes
} from '../../server/schema';
import type { Municipio } from '../../server/schema';
import { chaveDoPar } from '../../planos/distancia';
import type { Database } from '../core';

/** Quando a matriz foi medida e de onde veio — a tela mostra ao lado do número. */
export type ProcedenciaMedicao = { fonte: string; medido_em: string } | null;

/** Os municípios de uma UF, em ordem alfabética — alimenta os seletores. */
export async function listarMunicipios(db: Database, uf = 'CE'): Promise<Municipio[]> {
	return db.select().from(municipios).where(eq(municipios.uf, uf)).orderBy(municipios.nome).all();
}

/**
 * Os pares de distância entre os municípios que ESTE plano referencia.
 *
 * A chave é a de `chaveDoPar` (menor código primeiro), a mesma que
 * `distanciaDoTrajeto` consulta — se as duas divergissem, a tela mediria tudo
 * como "não encontrado" sem erro nenhum.
 */
export async function matrizDoPlano(db: Database, planoId: number): Promise<Map<string, number>> {
	const linhas = await db
		.select({ ibge: planoOpcoes.municipio_ibge })
		.from(planoOpcoes)
		.where(eq(planoOpcoes.plano_id, planoId))
		.all();

	const codigos = [...new Set(linhas.map((l) => l.ibge).filter((c): c is string => !!c))];
	// Menos de dois municípios não formam par nenhum — e um `inArray` vazio é SQL
	// inválido em alguns dialetos, então a saída antecipada também protege disso.
	if (codigos.length < 2) return new Map();

	const pares = await db
		.select()
		.from(distanciasMunicipios)
		.where(
			and(
				inArray(distanciasMunicipios.origem_ibge, codigos),
				inArray(distanciasMunicipios.destino_ibge, codigos)
			)
		)
		.all();

	const matriz = new Map<string, number>();
	for (const p of pares) matriz.set(chaveDoPar(p.origem_ibge, p.destino_ibge), p.km);
	return matriz;
}

/**
 * Distância entre dois municípios quaisquer, direto do banco.
 *
 * Usada pelo SERVIDOR ao gravar a equipe, para recalcular o trajeto sem confiar
 * no que o cliente mandou. A tela usa `matrizDoPlano`; esta função existe para o
 * caminho em que o par pode estar fora das opções do plano.
 */
export async function distanciaEntreMunicipios(
	db: Database,
	codigos: string[]
): Promise<Map<string, number>> {
	const unicos = [...new Set(codigos.filter(Boolean))];
	if (unicos.length < 2) return new Map();

	const pares = await db
		.select()
		.from(distanciasMunicipios)
		.where(
			or(
				...unicos.flatMap((a) =>
					unicos
						.filter((b) => b > a)
						.map((b) =>
							and(
								eq(distanciasMunicipios.origem_ibge, a < b ? a : b),
								eq(distanciasMunicipios.destino_ibge, a < b ? b : a)
							)
						)
				)
			)
		)
		.all();

	const matriz = new Map<string, number>();
	for (const p of pares) matriz.set(chaveDoPar(p.origem_ibge, p.destino_ibge), p.km);
	return matriz;
}

/** A procedência da matriz gravada, ou `null` quando ela ainda não foi semeada. */
export async function procedenciaDaMedicao(db: Database): Promise<ProcedenciaMedicao> {
	const linha = await db
		.select({ fonte: distanciasMedicao.fonte, medido_em: distanciasMedicao.medido_em })
		.from(distanciasMedicao)
		.orderBy(distanciasMedicao.id)
		.get();
	return linha ?? null;
}
