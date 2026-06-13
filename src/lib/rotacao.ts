/**
 * Utilitários para cálculo de rotação de plantão (1x3 e 2x6).
 *
 * Rotação 1x3: servidor trabalha 24h a cada 4 dias (1 dia de trabalho, 3 de folga).
 *   Exemplo: dias 1, 5, 9, 13, 17, 21, 25, 29
 *
 * Rotação 2x6: servidor trabalha 2 dias consecutivos a cada 8 dias (48h trabalho, 144h folga).
 *   Exemplo: dias 1, 2, 9, 10, 17, 18, 25, 26
 */

export const MESES_PT = [
	'JANEIRO',
	'FEVEREIRO',
	'MARÇO',
	'ABRIL',
	'MAIO',
	'JUNHO',
	'JULHO',
	'AGOSTO',
	'SETEMBRO',
	'OUTUBRO',
	'NOVEMBRO',
	'DEZEMBRO'
];

type Rotacao = '1x3' | '2x6';

function diffDias(a: string, b: string): number {
	const da = new Date(a + 'T00:00:00');
	const db = new Date(b + 'T00:00:00');
	return Math.round((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
}

function addDias(isoDate: string, n: number): string {
	const d = new Date(isoDate + 'T00:00:00');
	d.setDate(d.getDate() + n);
	return d.toISOString().split('T')[0];
}

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

/** Retorna o primeiro dia de um mês no formato ISO */
export function primeiroDiaDoMes(ano: number, mes: number): string {
	return `${ano}-${String(mes).padStart(2, '0')}-01`;
}

/** Retorna o último dia de um mês no formato ISO */
export function ultimoDiaDoMes(ano: number, mes: number): string {
	return new Date(ano, mes, 0).toISOString().split('T')[0];
}

/** Calcula data_saida de uma entrada dado hora de entrada e saída */
export function calcularDataSaida(
	dataPlantao: string,
	horaEntrada: string,
	horaSaida: string
): string {
	const he = Number((horaEntrada || '00').split(':')[0]);
	const hs = Number((horaSaida || '00').split(':')[0]);
	if (!horaEntrada && !horaSaida) {
		return dataPlantao;
	}
	if (hs <= he) {
		return addDias(dataPlantao, 1);
	}
	return dataPlantao;
}

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
