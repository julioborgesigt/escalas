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
 * O EIXO X é sempre a UNIDADE, e quais unidades entram é decisão de fora: o
 * painel passa `grupos` e `chave`, montados por `$lib/produtividade/agrupamento`
 * a partir do seletor "Visualizar por". É o mesmo par que os cards de ranking
 * consomem, para que as duas seções nunca discordem sobre quem entra na conta.
 *
 * Até ago/2026 havia um segundo modo aqui: com uma seccional escolhida no
 * filtro, o eixo virava a DATA e o gráfico virava linha. O filtro de seccional
 * saiu quando o painel ganhou "Visualizar por", e o ramo saiu com ele — não há
 * mais como chegar nele.
 *
 * O construtor `Chart` chega por função (`getChart`) porque a biblioteca é
 * carregada sob demanda — o composable é montado antes de ela existir e
 * simplesmente não desenha até chegar.
 */

import type { Chart, TooltipItem } from 'chart.js';
import { SvelteMap } from 'svelte/reactivity';

type ChartConstructor = typeof Chart;
type ChartInstance = InstanceType<ChartConstructor>;

interface ListItem {
	seccional_id?: number | null;
	/** `COALESCE(slot, unidade_operacional, seccional)` — ver `listarTodasRespostasGise`. */
	unidade_id?: number | null;
	data_inicio: string;
	respostasParsed?: Record<string, unknown>;
	respostas?: string;
}

/** Uma unidade no eixo X. Vem de `gruposDaVisualizacao`. */
interface GrupoItem {
	id: number;
	nome: string;
	/** Nome encurtado para o eixo; o completo vai no tooltip. */
	curto?: string;
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

/**
 * O valor de UMA resposta para UMA pergunta.
 *
 * Três formas, decididas pelo tipo: booleana CONTA ocorrências (cada `'Sim'`
 * vale 1), drogas somam PESO normalizado em gramas (`kg` × 1000 — senão 2 kg e
 * 2 g virariam o mesmo 2), e o resto soma o número. A leitura usa `mappedKey`,
 * não `key`, porque nos tipos compostos a resposta mora em outra chave do blob.
 */
function valorDaResposta(res: Record<string, unknown>, q: ChartQuestion): number {
	if (q.isBool) return res[q.key] === 'Sim' ? 1 : 0;
	if (q.specialStore === 'drogasGeral') {
		let total = 0;
		if (res.drogas_detalhe && typeof res.drogas_detalhe === 'object') {
			Object.entries(res.drogas_detalhe as Record<string, unknown>).forEach(([tipo, peso]) => {
				const drogasUnidade = res.drogas_unidade as Record<string, string> | undefined;
				const unidade = (drogasUnidade && drogasUnidade[tipo]) || 'g';
				let pesoV = Number(peso) || 0;
				if (unidade === 'kg') pesoV *= 1000;
				total += pesoV;
			});
		}
		return total;
	}
	return Number(res[q.mappedKey || q.key]) || 0;
}

export function useCharts(getChart: () => ChartConstructor | null) {
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

	/**
	 * Redesenha um gráfico por pergunta, com uma barra por unidade.
	 *
	 * `grupos` é o universo do eixo X — inclusive quem não produziu, que aparece
	 * com barra zero. `chave` diz de qual campo da linha sai o grupo (seccional ou
	 * delegacia). Os dois vêm de `$lib/produtividade/agrupamento`.
	 *
	 * `recortar` aplica ordem e Top-N, e é chamado POR PERGUNTA, depois da soma:
	 * o "top 5" de prisões não é o mesmo conjunto que o de apreensões, e recortar
	 * uma vez só, antes, daria a cinco perguntas o ranking de uma delas. O preço
	 * é o eixo variar de card para card — que é justamente o que "as 5 unidades
	 * que mais X" significa.
	 */
	function updateCharts(
		questions: ChartQuestion[],
		list: ListItem[],
		grupos: ReadonlyArray<GrupoItem>,
		chave: (item: ListItem) => number | null,
		recortar: (itens: Array<GrupoItem & { total: number }>) => Array<GrupoItem & { total: number }>
	) {
		const Chart = getChart();
		if (!Chart) return;

		questions.forEach((q) => {
			const canvas = canvasElements[q.id];
			if (!canvas) return;

			if (chartInstances.has(q.id)) {
				chartInstances.get(q.id)!.destroy();
			}

			// Acumulador local do redesenho, descartado no fim da iteração — não é
			// estado reativo, e um SvelteMap aqui só custaria proxy à toa.
			// Somar num mapa e não com `filter` por grupo: uma passada pela lista por
			// pergunta, em vez de O(perguntas × unidades × respostas).
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- acumulador efêmero
			const porGrupo = new Map<number, number>(grupos.map((g) => [g.id, 0]));
			for (const item of list) {
				const id = chave(item);
				if (id == null || !porGrupo.has(id)) continue;
				const res: Record<string, unknown> =
					item.respostasParsed ?? JSON.parse(item.respostas || '{}');
				porGrupo.set(id, (porGrupo.get(id) ?? 0) + valorDaResposta(res, q));
			}

			const visiveis = recortar(grupos.map((g) => ({ ...g, total: porGrupo.get(g.id) ?? 0 })));
			const labels = visiveis.map((g) => g.curto ?? g.nome);
			const chartData = visiveis.map((g) => g.total);

			const instance = new Chart(canvas, {
				type: 'bar',
				data: {
					labels,
					datasets: [
						{
							label: q.label,
							data: chartData,
							backgroundColor: q.color + '80',
							borderColor: q.color,
							borderWidth: 2,
							borderRadius: 4
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
								// O rótulo do eixo é encurtado para caber; o tooltip mostra o
								// nome inteiro, senão duas delegacias do mesmo município ficam
								// indistinguíveis.
								title: (itens: TooltipItem<'bar'>[]) =>
									visiveis[itens[0]?.dataIndex ?? 0]?.nome ?? '',
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
							display: true,
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
