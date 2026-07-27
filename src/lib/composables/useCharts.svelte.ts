/**
 * Ciclo de vida dos gráficos Chart.js no painel de produtividade.
 *
 * Chart.js não é reativo: ele desenha num `<canvas>` e mantém a instância viva
 * por conta própria. Isso conflita com Svelte de dois jeitos, e o composable
 * existe para resolver os dois:
 *
 * - **instância órfã** — recriar um gráfico sobre um canvas que já tem um sem
 *   `destroy()` deixa o antigo escutando eventos e vazando memória. Todo
 *   redesenho destrói o anterior primeiro;
 * - **gráfico obsoleto** — as perguntas vêm do modelo do formulário e podem
 *   sumir quando o filtro muda de tipo de equipe. `destroyStaleCharts` remove os
 *   que não estão mais na lista; sem isso, ficariam gráficos de perguntas que a
 *   tela não mostra mais.
 *
 * O EIXO X muda com o filtro, e é essa a única regra de negócio aqui: sem
 * seccional escolhida, cada barra é uma SECCIONAL (comparação entre elas); com
 * uma seccional escolhida, cada barra é uma DATA (evolução daquela seccional).
 *
 * O construtor `Chart` chega por função (`getChart`) porque a biblioteca é
 * carregada sob demanda — o composable é montado antes de ela existir e
 * simplesmente não desenha até chegar.
 */

import type { Chart, TooltipItem } from 'chart.js';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';

type ChartConstructor = typeof Chart;
type ChartInstance = InstanceType<ChartConstructor>;

interface ListItem {
	seccional_id: number;
	data_inicio: string;
	respostasParsed?: Record<string, unknown>;
	respostas?: string;
}

interface SeccionalItem {
	id: number;
	nome: string;
}

interface ChartQuestion {
	id: number;
	label: string;
	key: string;
	mappedKey: string;
	color: string;
	isBool: boolean;
	specialStore: string | null;
}

export function useCharts(
	getChart: () => ChartConstructor | null,
	getData: () => { seccionais?: SeccionalItem[] } & Record<string, unknown>
) {
	const chartInstances = new SvelteMap<number, ChartInstance>();
	const canvasElements = $state<Record<number, HTMLCanvasElement>>({});

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
		list: ListItem[],
		filterSeccional: string | number
	) {
		const Chart = getChart();
		if (!Chart) return;

		const isShowingAll = !filterSeccional;
		const labels = isShowingAll
			? (getData().seccionais ?? []).map((s: SeccionalItem) => s.nome.split(' do ')[0])
			: Array.from(new SvelteSet(list.map((i: ListItem) => i.data_inicio))).sort();

		questions.forEach((q) => {
			const canvas = canvasElements[q.id];
			if (!canvas) return;

			// Destroy existing
			if (chartInstances.has(q.id)) {
				chartInstances.get(q.id)!.destroy();
			}

			// Process Data
			let chartData: number[];

			if (isShowingAll) {
				chartData = (getData().seccionais ?? []).map((sec: SeccionalItem) => {
					return list
						.filter((item: ListItem) => item.seccional_id === sec.id)
						.reduce((acc: number, item: ListItem) => {
							const res: Record<string, unknown> =
								item.respostasParsed ?? JSON.parse(item.respostas || '{}');
							if (q.isBool) return acc + (res[q.key] === 'Sim' ? 1 : 0);
							if (q.specialStore === 'drogasGeral') {
								let drogasTotal = 0;
								if (res.drogas_detalhe && typeof res.drogas_detalhe === 'object') {
									Object.entries(res.drogas_detalhe as Record<string, unknown>).forEach(
										([tipo, peso]) => {
											const drogasUnidade = res.drogas_unidade as
												Record<string, string> | undefined;
											const unidade = (drogasUnidade && drogasUnidade[tipo]) || 'g';
											let pesoV = Number(peso) || 0;
											if (unidade === 'kg') pesoV *= 1000;
											drogasTotal += pesoV;
										}
									);
								}
								return acc + drogasTotal;
							}
							return acc + (Number(res[q.mappedKey || q.key]) || 0);
						}, 0);
				});
			} else {
				chartData = labels.map((date: string) => {
					return list
						.filter((item: ListItem) => item.data_inicio === date)
						.reduce((acc: number, item: ListItem) => {
							const res: Record<string, unknown> =
								item.respostasParsed ?? JSON.parse(item.respostas || '{}');
							if (q.isBool) return acc + (res[q.key] === 'Sim' ? 1 : 0);
							if (q.specialStore === 'drogasGeral') {
								let drogasTotal = 0;
								if (res.drogas_detalhe && typeof res.drogas_detalhe === 'object') {
									Object.entries(res.drogas_detalhe as Record<string, unknown>).forEach(
										([tipo, peso]) => {
											const drogasUnidade = res.drogas_unidade as
												Record<string, string> | undefined;
											const unidade = (drogasUnidade && drogasUnidade[tipo]) || 'g';
											let pesoV = Number(peso) || 0;
											if (unidade === 'kg') pesoV *= 1000;
											drogasTotal += pesoV;
										}
									);
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
									const val = context.parsed.y ?? 0;
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
		get canvasElements() {
			return canvasElements;
		},
		updateCharts,
		destroyStaleCharts,
		destroyAll
	};
}
