/**
 * Utilitários para cálculo de rotação de plantão (1x3 e 2x6).
 *
 * Rotação 1x3: servidor trabalha 24h a cada 4 dias (1 dia de trabalho, 3 de folga).
 *   Exemplo: dias 1, 5, 9, 13, 17, 21, 25, 29
 *
 * Rotação 2x6: servidor trabalha 2 dias consecutivos a cada 8 dias (48h trabalho, 144h folga).
 *   Exemplo: dias 1, 2, 9, 10, 17, 18, 25, 26
 */

import { adicionarDias, isoData, diasNoMes } from './utils/datas';

type Rotacao = '1x3' | '2x6';

/**
 * Dias ENTRE duas datas — EXCLUSIVO. `01` → `05` devolve 4.
 *
 * Não confundir com `diffDiasInclusivo` de `$lib/utils/datas`, que conta quantos dias
 * o período TEM (`01` → `05` = 5). São perguntas diferentes, não duplicação: a
 * rotação precisa do intervalo entre plantões (1x3 = 4, 2x6 = 1 e 7), enquanto
 * a duração de um afastamento inclui as duas pontas.
 *
 * Privada de propósito. Exportar exigiria um nome que dissesse "exclusivo" no
 * call site, e o único consumidor é a detecção de padrão logo abaixo.
 */
function diffDias(a: string, b: string): number {
	const da = new Date(a + 'T00:00:00');
	const db = new Date(b + 'T00:00:00');
	return Math.round((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
}

// `addDias` era uma terceira cópia de `adicionarDias`, com o mesmo defeito de
// fuso das outras duas. Aliás local para não reescrever os ~10 call sites.
const addDias = adicionarDias;

/**
 * Detecta o tipo de rotação a partir de um array de datas ISO (data_plantao).
 * Retorna '1x3', '2x6' ou null se não for possível detectar.
 */
export function detectarRotacao(dias: string[]): Rotacao | null {
	if (dias.length < 2) return null;

	const sorted = [...dias].sort();
	const gaps: number[] = [];

	for (let i = 1; i < sorted.length; i++) {
		gaps.push(diffDias(sorted[i - 1], sorted[i]));
	}

	// 1x3: todos os intervalos são exatamente 4 dias
	if (gaps.every((g) => g === 4)) return '1x3';

	// 2x6: intervalos alternam entre 1 (par consecutivo) e 7 (folga entre pares)
	const todosUmOuSete = gaps.every((g) => g === 1 || g === 7);
	if (todosUmOuSete) {
		const alt1 = gaps.every((g, i) => (i % 2 === 0 ? g === 1 : g === 7));
		const alt7 = gaps.every((g, i) => (i % 2 === 0 ? g === 7 : g === 1));
		if (alt1 || alt7) return '2x6';
	}

	return null;
}

/**
 * Calcula os dias de plantão no próximo mês dado o padrão do mês atual.
 *
 * @param diasMesAtual - datas ISO dos dias de plantão no mês atual (data_plantao)
 * @param ano - ano do mês alvo
 * @param mes - mês alvo (1-based)
 * @returns { dias: string[], rotacao: Rotacao | null }
 */
export function calcularProximoMesDias(
	diasMesAtual: string[],
	ano: number,
	mes: number
): { dias: string[]; rotacao: Rotacao | null } {
	if (diasMesAtual.length === 0) return { dias: [], rotacao: null };

	const sorted = [...diasMesAtual].sort();
	const rotacao = detectarRotacao(sorted);
	if (!rotacao) return { dias: [], rotacao: null };

	const ultimoDia = sorted[sorted.length - 1];
	const result: string[] = [];

	function noMes(isoDate: string): boolean {
		const [y, m] = isoDate.split('-').map(Number);
		return y === ano && m === mes;
	}

	function aposOmes(isoDate: string): boolean {
		const [y, m] = isoDate.split('-').map(Number);
		return y > ano || (y === ano && m > mes);
	}

	if (rotacao === '1x3') {
		let proximo = addDias(ultimoDia, 4);

		// Avança até atingir o mês alvo (pode pular meses se o mês alvo for futuro)
		while (!noMes(proximo) && !aposOmes(proximo)) {
			proximo = addDias(proximo, 4);
		}

		while (noMes(proximo)) {
			result.push(proximo);
			proximo = addDias(proximo, 4);
		}
	} else {
		// 2x6: localiza o início do último par do mês atual
		let ultimoPairStart: string;

		if (sorted.length >= 2 && diffDias(sorted[sorted.length - 2], ultimoDia) === 1) {
			// O último e o penúltimo formam um par → o início do par é o penúltimo
			ultimoPairStart = sorted[sorted.length - 2];
		} else {
			// Caso isolado (último dia sem par detectado) → trata como início de par
			ultimoPairStart = ultimoDia;
		}

		let proximoPairStart = addDias(ultimoPairStart, 8);

		// Avança até atingir o mês alvo
		while (!noMes(proximoPairStart) && !aposOmes(proximoPairStart)) {
			proximoPairStart = addDias(proximoPairStart, 8);
		}

		while (noMes(proximoPairStart)) {
			result.push(proximoPairStart);
			const dia2 = addDias(proximoPairStart, 1);
			if (noMes(dia2)) result.push(dia2);
			proximoPairStart = addDias(proximoPairStart, 8);
		}
	}

	return { dias: result, rotacao };
}

/** Retorna o próximo mês (ano, mês 1-based) */
export function proximoMes(ano: number, mes: number): { ano: number; mes: number } {
	return mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 };
}

/** Retorna o primeiro dia de um mês no formato ISO (`mes` 1–12). */
export function primeiroDiaDoMes(ano: number, mes: number): string {
	return isoData(ano, mes, 1);
}

/**
 * Retorna o último dia de um mês no formato ISO (`mes` 1–12).
 *
 * Montado com `diasNoMes` + `isoData`, sem `toISOString()`. A versão anterior
 * era `new Date(ano, mes, 0).toISOString()`: construía a data em horário local
 * e a formatava em UTC, e por isso devolvia 30/07 em vez de 31/07 em qualquer
 * fuso positivo — um mês inteiro de escala deslocado, sem erro nenhum.
 */
export function ultimoDiaDoMes(ano: number, mes: number): string {
	return isoData(ano, mes, diasNoMes(ano, mes));
}

// Implementação única em $lib/utils/datas (achado D1 do antigo ARQUIVOS.md — ver docs/HISTORICO.md); re-export
// preserva os imports existentes `from '$lib/rotacao'`. Títulos oficiais de
// escala fazem `.toUpperCase()` no call site — a fonte é Title Case.
export { calcularDataSaida, MESES_PT } from './utils/datas';

/** Dias de plantão de um policial, agrupados para o cálculo de rotação. */
interface DiasPorPolicial {
	nome: string;
	dias: string[];
	equipe: string;
}

/**
 * Agrupa as linhas de plantão de uma escala por policial, acumulando as datas
 * de cada um. Usado como entrada para `calcularProximoMesDias` ao replicar uma
 * escala para o mês seguinte.
 */
export function agruparDiasPorPolicial(
	linhas: readonly {
		policial_id: number;
		nome: string;
		equipe?: string | null;
		data_plantao: string;
	}[]
): Map<number, DiasPorPolicial> {
	const porPolicial = new Map<number, DiasPorPolicial>();
	for (const p of linhas) {
		let entrada = porPolicial.get(p.policial_id);
		if (!entrada) {
			entrada = { nome: p.nome, dias: [], equipe: p.equipe || '' };
			porPolicial.set(p.policial_id, entrada);
		}
		entrada.dias.push(p.data_plantao);
	}
	return porPolicial;
}
