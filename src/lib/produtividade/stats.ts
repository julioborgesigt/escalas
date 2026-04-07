/**
 * Cálculo de estatísticas agregadas a partir das respostas de produtividade.
 */

import type { Question } from './questions';

export interface StatsResult {
	drogasGeral: number;
	drogasPorTipo: Record<string, number>;
	apreensoes_armas: number;
	armasPorTipo: Record<string, number>;
	prisaoFlagrante: number;
	prisaoMandado: number;
	[key: string]: unknown;
}

/**
 * Agrega estatísticas a partir dos dados filtrados.
 */
export function calculateStats(
	filteredData: any[],
	questions: Question[],
	armasKey: string
): StatsResult {
	const s: StatsResult = {
		drogasGeral: 0,
		drogasPorTipo: {},
		apreensoes_armas: 0,
		armasPorTipo: {},
		prisaoFlagrante: 0,
		prisaoMandado: 0
	};

	// Initialize dynamic keys
	questions.forEach((q) => {
		if (typeof s[q.key] !== 'number') s[q.key] = 0;
	});

	filteredData.forEach((item) => {
		const res = JSON.parse(item.respostas || '{}');

		// Dynamic Aggregation for all Numeric/Boolean/Smart Questions
		questions.forEach((q) => {
			const val = res[q.mappedKey || q.key];
			if (q.isBool) {
				if (val === 'Sim') s[q.key] = (s[q.key] as number || 0) + 1;
			} else {
				s[q.key] = (s[q.key] as number || 0) + (Number(val) || 0);
			}
		});

		// P10: Drugs
		if (res.drogas_detalhe) {
			Object.entries(res.drogas_detalhe).forEach(([tipo, peso]) => {
				const unid = (res.drogas_unidade && res.drogas_unidade[tipo]) || 'g';
				let pNorm = Number(peso) || 0;
				if (unid === 'kg') pNorm *= 1000;
				s.drogasPorTipo[tipo] = (s.drogasPorTipo[tipo] || 0) + pNorm;
				s.drogasGeral += pNorm;
			});
		}

		// P11: Weapons
		if (res[armasKey] === 'Sim' && res.armas_detalhe) {
			Object.entries(res.armas_detalhe).forEach(([tipo, qtd]) => {
				const n = Number(qtd) || 0;
				s.apreensoes_armas += n;
				s.armasPorTipo[tipo] = (s.armasPorTipo[tipo] || 0) + n;
			});
		}

		// P4 & P5: Prisons
		if (res.procedimentos_flagrante_bool === 'Sim') {
			s.prisaoFlagrante += Number(res.prisoes_qtd) || 0;
		}
		s.prisaoMandado += Number(res.mandados_qtd) || 0;
	});

	return s;
}

export interface RankingItem {
	nome: string;
	total: number;
}

/**
 * Calcula ranking genérico por seccional.
 */
export function calculateRanking(
	seccionais: any[],
	filteredData: any[],
	extractValue: (res: Record<string, any>) => number
): RankingItem[] {
	const r = new Map<number, RankingItem>();
	(seccionais ?? []).forEach((s: any) => r.set(s.id, { nome: s.nome, total: 0 }));

	filteredData.forEach((item) => {
		const res = JSON.parse(item.respostas || '{}');
		const val = extractValue(res);
		const entry = r.get(item.seccional_id);
		if (entry) entry.total += val;
	});
	return Array.from(r.values()).sort((a, b) => b.total - a.total);
}
