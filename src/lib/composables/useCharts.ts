/**
 * Composable para gerenciar gráficos Chart.js em componentes Svelte.
 * Cuida do lifecycle, destruição de instâncias stale e atualização.
 */

import type { TooltipItem } from 'chart.js';

export interface ChartQuestion {
	id: number;
	label: string;
	key: string;
	mappedKey: string;
	color: string;
	isBool: boolean;
	specialStore: string | null;
}

export function useCharts(Chart: any, data: any) {
	let chartInstances = new Map<number, any>();
	let canvasElements = $state<Record<number, HTMLCanvasElement>>({});

	function destroyStaleCharts(questionIds: Set<number>) {
		chartInstances.forEach((instance, id) => {
			if (!questionIds.has(id)) {
				instance.destroy();
				chartInstances.delete(id);
			}
		});
	}

	function updateCharts(
		questions: ChartQuestion[],
		list: any[],
		filterSeccional: string | number
	) {
		if (!Chart) return;

		const isShowingAll = !filterSeccional;
		const labels = isShowingAll
			? (data.seccionais ?? []).map((s: any) => s.nome.split(' do ')[0])
			: Array.from(new Set(list.map((i: any) => i.data_inicio))).sort();

		questions.forEach((q) => {
			const canvas = canvasElements[q.id];
			if (!canvas) return;

			// Destroy existing
			if (chartInstances.has(q.id)) {
				chartInstances.get(q.id).destroy();
			}

			// Process Data
			let chartData: number[] = [];

			if (isShowingAll) {
				chartData = (data.seccionais ?? []).map((sec: any) => {
					return list
						.filter((item: any) => item.seccional_id === sec.id)
						.reduce((acc: number, item: any) => {
							const res = item.respostasParsed ?? JSON.parse(item.respostas || '{}');
							if (q.isBool) return acc + (res[q.key] === 'Sim' ? 1 : 0);
							if (q.specialStore === 'drogasGeral') {
								let drogasTotal = 0;
								if (res.drogas_detalhe) {
									Object.entries(res.drogas_detalhe).forEach(([tipo, peso]) => {
										const unidade = (res.drogas_unidade && res.drogas_unidade[tipo]) || 'g';
										let pesoV = Number(peso) || 0;
										if (unidade === 'kg') pesoV *= 1000;
										drogasTotal += pesoV;
									});
								}
								return acc + drogasTotal;
							}
							return acc + (Number(res[q.mappedKey || q.key]) || 0);
						}, 0);
				});
			} else {
				chartData = labels.map((date: string) => {
					return list
						.filter((item: any) => item.data_inicio === date)
						.reduce((acc: number, item: any) => {
							const res = item.respostasParsed ?? JSON.parse(item.respostas || '{}');
							if (q.isBool) return acc + (res[q.key] === 'Sim' ? 1 : 0);
							if (q.specialStore === 'drogasGeral') {
								let drogasTotal = 0;
								if (res.drogas_detalhe) {
									Object.entries(res.drogas_detalhe).forEach(([tipo, peso]) => {
										const unidade = (res.drogas_unidade && res.drogas_unidade[tipo]) || 'g';
										let pesoV = Number(peso) || 0;
										if (unidade === 'kg') pesoV *= 1000;
										drogasTotal += pesoV;
									});
								}
								return acc + drogasTotal;
							}
							return acc + (Number(res[q.mappedKey || q.key]) || 0);
						}, 0);
				});
			}

			const instance = new Chart(canvas, {
				type: isShowingAll ? 'bar' : 'line',
				data: {
					labels: isShowingAll
						? labels
						: (labels as string[]).map((d: string) => d.split('-').reverse().join('/')),
					datasets: [
						{
							label: q.label,
							data: chartData,
							backgroundColor: q.color + (isShowingAll ? '80' : '20'),
							borderColor: q.color,
							borderWidth: 2,
							tension: 0.4,
							fill: !isShowingAll,
							borderRadius: isShowingAll ? 4 : 0,
							pointRadius: isShowingAll ? 0 : 3
						}
					]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					plugins: {
						legend: { display: false },
						tooltip: {
							callbacks: {
								label: (context: TooltipItem<'bar'>) => {
									let val = context.parsed.y ?? 0;
									if (q.specialStore === 'drogasGeral') return `${val.toLocaleString()}g`;
									return val.toLocaleString();
								}
							}
						}
					},
					scales: {
						x: {
							display: isShowingAll,
							grid: { display: false },
							ticks: {
								autoSkip: true,
								maxRotation: 0,
								font: { size: 10, weight: 'bold' }
							}
						},
						y: {
							beginAtZero: true,
							suggestedMax: 5,
							grid: { color: '#e2e8f010' },
							ticks: {
								display: true,
								stepSize: 1,
								font: { size: 9 }
							}
						}
					}
				}
			});
			chartInstances.set(q.id, instance);
		});
	}

	function destroyAll() {
		chartInstances.forEach((instance) => instance.destroy());
		chartInstances.clear();
	}

	return {
		get canvasElements() { return canvasElements; },
		updateCharts,
		destroyStaleCharts,
		destroyAll
	};
}
