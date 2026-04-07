<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { TooltipItem } from 'chart.js';

	// Chart.js loaded lazily to save ~200KB on initial bundle
	let Chart: any = null;
	let chartLoaded = $state(false);

	async function loadChart() {
		if (!Chart) {
			Chart = (await import('chart.js/auto')).default;
			chartLoaded = true;
		}
	}

	interface RankingItem {
		nome: string;
		total: number;
	}

	let { data } = $props();

	// Filters
	let filterTipo = $state('operacional');
	let filterSeccional = $state('');
	let filterInicio = $state('');
	let filterFim = $state('');

	// Export Selection
	let selectedCharts = $state<(number | string)[]>([]);
	const TOP_IDS = [
		'rank-prisoes',
		'detail-prisoes',
		'rank-drogas',
		'detail-drogas',
		'rank-armas',
		'detail-armas'
	];

	const toggleChartSelection = (id: number | string) => {
		if (selectedCharts.includes(id)) {
			selectedCharts = selectedCharts.filter((i) => i !== id);
		} else {
			selectedCharts = [...selectedCharts, id];
		}
	};
	// Dynamic Questions Mapping (P4 to P18+)
	const palette = [
		'#3b82f6',
		'#10b981',
		'#f59e0b',
		'#f43f5e',
		'#06b6d4',
		'#8b5cf6',
		'#ef4444',
		'#6366f1',
		'#14b8a6',
		'#d946ef',
		'#f97316',
		'#ec4899',
		'#64748b',
		'#94a3b8',
		'#a855f7'
	];

	let QUESTIONS = $derived.by(() => {
		const base = filterTipo === 'seint' ? data.modeloSeint : data.modeloOperacional;
		if (!base || base.length === 0) return [];

		return base
			.filter((q: any) =>
				[
					'numero',
					'select_99',
					'select_999',
					'sim_nao',
					'celulares_complex',
					'analise_complex',
					'relatorios_seint_complex',
					'foragidos_complex',
					'operacoes_seint_complex',
					'operacoes_seint_pura'
				].includes(q.tipo)
			)
			.map((q: any, idx: number) => {
				let mappedKey = q.key;
				if (q.tipo === 'celulares_complex') mappedKey = 'celulares_qtd';
				else if (q.tipo === 'analise_complex') mappedKey = 'analise_qtd';
				else if (q.tipo === 'relatorios_seint_complex') mappedKey = 'relatorios_seint_qtd';
				else if (q.tipo === 'foragidos_complex') mappedKey = 'foragidos_qtd';
				else if (q.tipo === 'operacoes_seint_complex' || q.tipo === 'operacoes_seint_pura')
					mappedKey = 'operacoes_seint_qtd';

				return {
					id: q.id,
					label: q.texto,
					key: q.key,
					mappedKey: mappedKey,
					color: palette[idx % palette.length],
					isBool: q.tipo === 'sim_nao',
					specialStore: q.key === 'apreensoes_drogas' ? 'drogasGeral' : null // Map legacy/special
				};
			});
	});

	const selectAllCharts = () => {
		const allIds = [...QUESTIONS.map((q: any) => q.id), ...TOP_IDS];
		if (selectedCharts.length >= allIds.length) {
			selectedCharts = [];
		} else {
			selectedCharts = allIds;
		}
	};
	const allChartsCount = $derived(QUESTIONS.length + TOP_IDS.length);

	// Derive armas key dynamically from the model (fallback to default if model wasn't customized)
	const armasKey = $derived.by(() => {
		const q = (data.modeloOperacional || []).find((q: any) => q.tipo === 'armas_complex');
		return q?.key ?? 'apreensoes_armas_bool';
	});

	// Default to current year if no dates set
	const currentYear = new Date().getFullYear();
	const defaultStart = `${currentYear}-01-01`;
	const defaultEnd = `${currentYear}-12-31`;

	// Derived Data (Exclusive to "Operacional" teams)
	let filteredData = $derived(
		(data.lista || []).filter((item: any) => {
			const date = item.data_inicio;
			const tipo = (item.equipe_tipo || 'operacional').toLowerCase();
			if (tipo !== filterTipo) return false;
			if (filterSeccional && item.seccional_id !== Number(filterSeccional)) return false;

			const start = filterInicio || defaultStart;
			const end = filterFim || defaultEnd;

			if (date < start) return false;
			if (date > end) return false;
			return true;
		})
	);

	// Stats Calculation (Auto-Aggregated)
	let stats = $derived.by(() => {
		const s: any = {
			drogasGeral: 0,
			drogasPorTipo: {},
			apreensoes_armas: 0,
			armasPorTipo: {},
			prisaoFlagrante: 0,
			prisaoMandado: 0
		};

		// Initialize dynamic keys
		QUESTIONS.forEach((q: any) => {
			if (!s[q.key]) s[q.key] = 0;
		});

		filteredData.forEach((item: any) => {
			const res = JSON.parse(item.respostas || '{}');

			// Dynamic Aggregation for all Numeric/Boolean/Smart Questions
			QUESTIONS.forEach((q: any) => {
				const val = res[q.mappedKey || q.key];
				if (q.isBool) {
					if (val === 'Sim') s[q.key] = (s[q.key] || 0) + 1;
				} else {
					s[q.key] = (s[q.key] || 0) + (Number(val) || 0);
				}
			});

			// Complex Operational Highlights (Top Rows)
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

			// P4 & P5: Prisons (stats auxiliares para totais do detalhamento)
			if (res.procedimentos_flagrante_bool === 'Sim') {
				s.prisaoFlagrante += Number(res.prisoes_qtd) || 0;
			}
			s.prisaoMandado += Number(res.mandados_qtd) || 0;
		});

		return s;
	});

	// Rankings
	let rankingPrisoes = $derived.by(() => {
		const r = new Map<number, { nome: string; total: number }>();
		(data.seccionais ?? []).forEach((s: any) => r.set(s.id, { nome: s.nome, total: 0 }));

		filteredData.forEach((item: any) => {
			const res = JSON.parse(item.respostas || '{}');
			const val = Number(res.prisoes_apreensoes_flagrante) || 0;
			const entry = r.get(item.seccional_id);
			if (entry) entry.total += val;
		});
		return Array.from(r.values()).sort((a, b) => b.total - a.total);
	});

	let rankingDrogasPeso = $derived.by(() => {
		const r = new Map<number, { nome: string; total: number }>();
		(data.seccionais ?? []).forEach((s: any) => r.set(s.id, { nome: s.nome, total: 0 }));

		filteredData.forEach((item: any) => {
			const res = JSON.parse(item.respostas || '{}');
			if (res.drogas_detalhe) {
				Object.entries(res.drogas_detalhe).forEach(([tipo, peso]) => {
					const unidade = (res.drogas_unidade && res.drogas_unidade[tipo]) || 'g';
					let p = Number(peso) || 0;
					if (unidade === 'kg') p *= 1000;
					const entry = r.get(item.seccional_id);
					if (entry) entry.total += p;
				});
			}
		});
		return Array.from(r.values()).sort((a, b) => b.total - a.total);
	});

	let rankingArmas = $derived.by(() => {
		const r = new Map<number, { nome: string; total: number }>();
		(data.seccionais ?? []).forEach((s: any) => r.set(s.id, { nome: s.nome, total: 0 }));

		filteredData.forEach((item: any) => {
			const res = JSON.parse(item.respostas || '{}');
			let val = 0;
			if (res[armasKey] === 'Sim' && res.armas_detalhe) {
				Object.values(res.armas_detalhe).forEach((q) => (val += Number(q) || 0));
			}
			const entry = r.get(item.seccional_id);
			if (entry) entry.total += val;
		});
		return Array.from(r.values()).sort((a, b) => b.total - a.total);
	});

	// Charts references
	let chartInstances = new Map<number, any>();
	let canvasElements = $state<Record<number, HTMLCanvasElement>>({});

	// Destroy all stale chart instances when question set changes (e.g. filterTipo switch)
	$effect(() => {
		const currentIds = new Set(QUESTIONS.map((q: any) => q.id));
		chartInstances.forEach((instance, id) => {
			if (!currentIds.has(id)) {
				instance.destroy();
				chartInstances.delete(id);
			}
		});
	});

	async function updateCharts(list: any[]) {
		// Lazy load Chart.js on first use
		await loadChart();

		const isShowingAll = !filterSeccional;
		const labels = isShowingAll
			? (data.seccionais ?? []).map((s) => s.nome.split(' do ')[0])
			: Array.from(new Set(list.map((i) => i.data_inicio))).sort();

		QUESTIONS.forEach((q: any) => {
			const canvas = canvasElements[q.id];
			if (!canvas) return;

			// Destroy existing
			if (chartInstances.has(q.id)) {
				chartInstances.get(q.id).destroy();
			}

			// Process Data
			let chartData: number[] = [];

			if (isShowingAll) {
				// Compare Seccionais
				chartData = (data.seccionais ?? []).map((sec: any) => {
					return list
						.filter((item) => item.seccional_id === sec.id)
						.reduce((acc, item) => {
							const res = JSON.parse(item.respostas || '{}');
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
				// Trend for one Seccional
				chartData = labels.map((date) => {
					return list
						.filter((item) => item.data_inicio === date)
						.reduce((acc, item) => {
							const res = JSON.parse(item.respostas || '{}');
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
						: (labels as string[]).map((d) => d.split('-').reverse().join('/')),
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

	import { tick } from 'svelte';

	$effect(() => {
		// Track filteredData and whether all current QUESTIONS have live canvas refs
		const _data = filteredData;
		const allCanvasesReady =
			QUESTIONS.length > 0 && QUESTIONS.every((q: any) => !!canvasElements[q.id]);

		if (_data && allCanvasesReady) {
			tick().then(() => updateCharts(_data));
		}
	});

	onMount(async () => {
		// Initial check
		const allReady = QUESTIONS.length > 0 && QUESTIONS.every((q: any) => !!canvasElements[q.id]);
		if (filteredData.length > 0 && allReady) {
			await updateCharts(filteredData);
		}
	});

	async function exportChartsAsImages() {
		if (selectedCharts.length === 0) return;

		const seccionalName =
			data.seccionais?.find((s: any) => s.id === Number(filterSeccional))?.nome ||
			'Todas as Seccionais';
		const start = filterInicio || defaultStart;
		const end = filterFim || defaultEnd;
		const periodText = `${start.split('-').reverse().join('/')} a ${end.split('-').reverse().join('/')}`;

		for (const id of selectedCharts) {
			let qLabel = '';
			let qColor = '#6366f1';
			let sourceCanvas: HTMLCanvasElement | null = null;
			let isVirtual = typeof id === 'string';

			if (!isVirtual) {
				const q = QUESTIONS.find((qi: any) => qi.id === id);
				if (!q) continue;
				qLabel = q.label;
				qColor = q.color;
				sourceCanvas = canvasElements[id as number];
			} else {
				// Virtual IDs mapping
				if (id === 'rank-prisoes') {
					qLabel = 'Ranking de Prisões (P7)';
					qColor = '#f43f5e';
				} else if (id === 'detail-prisoes') {
					qLabel = 'Detalhamento de Prisões';
					qColor = '#f43f5e';
				} else if (id === 'rank-drogas') {
					qLabel = 'Ranking de Drogas (P10)';
					qColor = '#ef4444';
				} else if (id === 'detail-drogas') {
					qLabel = 'Detalhamento de Substâncias';
					qColor = '#ef4444';
				} else if (id === 'rank-armas') {
					qLabel = 'Ranking de Armas (P11)';
					qColor = '#6366f1';
				} else if (id === 'detail-armas') {
					qLabel = 'Detalhamento de Armas';
					qColor = '#6366f1';
				}
			}

			// Create off-screen canvas
			const exportCanvas = document.createElement('canvas');
			const ctx = exportCanvas.getContext('2d')!;
			const padding = 40;
			const headerHeight = 120;
			const footerHeight = 40;

			if (!isVirtual && sourceCanvas) {
				exportCanvas.width = sourceCanvas.width + padding * 2;
				exportCanvas.height = sourceCanvas.height + headerHeight + footerHeight;
			} else {
				exportCanvas.width = 800; // Standard for rank/details
				exportCanvas.height = 600;
			}

			// Background
			ctx.fillStyle = 'white';
			ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

			// Header
			ctx.fillStyle = qColor;
			ctx.font = 'bold 24px Inter, sans-serif, Arial';
			ctx.fillText(qLabel.toUpperCase(), padding, 50);
			ctx.fillStyle = '#64748b';
			ctx.font = 'bold 14px Inter, sans-serif, Arial';
			ctx.fillText(`SECCIONAL: ${seccionalName.toUpperCase()}`, padding, 80);
			ctx.fillText(`PERÍODO: ${periodText}`, padding, 100);
			ctx.strokeStyle = '#e2e8f0';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(padding, headerHeight - 10);
			ctx.lineTo(exportCanvas.width - padding, headerHeight - 10);
			ctx.stroke();

			if (!isVirtual && sourceCanvas) {
				ctx.drawImage(sourceCanvas, padding, headerHeight);
			} else {
				// MANUAL DRAWING FOR RANK/DETAIL
				if (id.toString().startsWith('rank')) {
					let list: any[] = [];
					let unit = '';
					if (id === 'rank-prisoes') {
						list = rankingPrisoes;
						unit = '';
					} else if (id === 'rank-drogas') {
						list = rankingDrogasPeso;
						unit = 'kg';
					} else if (id === 'rank-armas') {
						list = rankingArmas;
						unit = '';
					}

					let y = headerHeight + 20;
					list.slice(0, 10).forEach((item, idx) => {
						ctx.beginPath();
						ctx.fillStyle = '#f8fafc';
						if (ctx.roundRect) {
							ctx.roundRect(padding, y, exportCanvas.width - padding * 2, 40, 8);
						} else {
							ctx.rect(padding, y, exportCanvas.width - padding * 2, 40);
						}
						ctx.fill();

						ctx.fillStyle = '#94a3b8';
						ctx.font = 'italic bold 16px Inter';
						ctx.fillText(`#${idx + 1}`, padding + 15, y + 26);
						ctx.fillStyle = '#1e293b';
						ctx.font = 'bold 14px Inter';
						ctx.fillText(item.nome.toUpperCase(), padding + 60, y + 26);
						ctx.textAlign = 'right';
						ctx.fillStyle = qColor;
						ctx.font = 'black 18px Inter';
						let val = unit === 'kg' ? (item.total / 1000).toFixed(1) : item.total;
						ctx.fillText(`${val}${unit}`, exportCanvas.width - padding - 15, y + 26);
						ctx.textAlign = 'left';
						y += 45;
					});
				} else {
					let details: [string, number][] = [];
					let total = 0;
					let unit = '';
					if (id === 'detail-prisoes') {
						details = [
							['Flagrantes (P4)', stats.prisaoFlagrante],
							['Mandados (P5)', stats.prisaoMandado],
							['Total de Presos (P7)', stats['prisoes_apreensoes_flagrante'] || 0]
						];
						total = Math.max(
							stats['prisoes_apreensoes_flagrante'] || 0,
							stats.prisaoFlagrante,
							stats.prisaoMandado
						);
					} else if (id === 'detail-drogas') {
						details = (Object.entries(stats.drogasPorTipo) as [string, number][])
							.sort((a: [string, number], b: [string, number]) => b[1] - a[1])
							.slice(0, 8);
						total = stats.drogasGeral;
						unit = 'g';
					} else if (id === 'detail-armas') {
						details = (Object.entries(stats.armasPorTipo) as [string, number][])
							.sort((a: [string, number], b: [string, number]) => b[1] - a[1])
							.slice(0, 8);
						total = stats.apreensoes_armas;
					}

					let y = headerHeight + 20;
					details.forEach(([label, val]) => {
						ctx.fillStyle = '#64748b';
						ctx.font = 'bold 12px Inter';
						ctx.fillText(label.toUpperCase(), padding, y);
						ctx.textAlign = 'right';
						ctx.fillStyle = qColor;
						let displayVal =
							unit === 'g' && val >= 1000 ? `${(val / 1000).toFixed(1)}kg` : `${val}${unit}`;
						ctx.fillText(displayVal, exportCanvas.width - padding, y);
						ctx.textAlign = 'left';

						ctx.fillStyle = '#f1f5f9';
						ctx.beginPath();
						if (ctx.roundRect) {
							ctx.roundRect(padding, y + 10, exportCanvas.width - padding * 2, 12, 6);
						} else {
							ctx.rect(padding, y + 10, exportCanvas.width - padding * 2, 12);
						}
						ctx.fill();

						ctx.fillStyle = qColor;
						ctx.beginPath();
						let w = (val / (total || 1)) * (exportCanvas.width - padding * 2);
						if (ctx.roundRect) {
							ctx.roundRect(padding, y + 10, Math.max(w, 4), 12, 6);
						} else {
							ctx.rect(padding, y + 10, Math.max(w, 4), 12);
						}
						ctx.fill();
						y += 50;
					});
				}
			}

			// Footer
			ctx.textAlign = 'right';
			ctx.fillStyle = '#94a3b8';
			ctx.font = 'bold 10px Inter';
			ctx.fillText(
				'GISE - DASHBOARD DE PRODUTIVIDADE',
				exportCanvas.width - padding,
				exportCanvas.height - 15
			);

			// Download
			const link = document.createElement('a');
			link.download = `GISE_${qLabel.replace(/\s+/g, '_')}.png`;
			link.href = exportCanvas.toDataURL('image/png');
			link.click();
			await new Promise((r) => setTimeout(r, 100));
		}
	}
</script>

{#snippet subRanking(
	id: string,
	title: string,
	ranking: any[],
	color: string,
	icon: any,
	labelUnit: string
)}
	<div
		class="card relative p-6 bg-white dark:bg-surface-950 text-surface-900 dark:text-white border-2 transition-all {selectedCharts.includes(
			id
		)
			? 'selected-for-export border-primary-500 shadow-xl shadow-primary-500/10'
			: 'border-surface-200 dark:border-surface-800 shadow-xl'} rounded-3xl flex flex-col h-full"
	>
		<!-- Selection Badge -->
		<button
			onclick={() => toggleChartSelection(id)}
			class="absolute top-2 right-2 md:top-3 md:right-3 w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl flex items-center justify-center transition-all {selectedCharts.includes(
				id
			)
				? 'bg-primary-500 text-white scale-110 shadow-lg'
				: 'bg-surface-100 dark:bg-surface-800 text-surface-500 hover:scale-105'}"
		>
			{#if selectedCharts.includes(id)}
				<svg class="w-4 h-4 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="4"
						d="M5 13l4 4L19 7"
					/></svg
				>
			{:else}
				<svg
					class="w-3 h-3 md:w-5 md:h-5 opacity-40"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="3"
						d="M12 6v6m0 0v6m0-6h6m-6 0H6"
					/></svg
				>
			{/if}
		</button>

		<div class="flex items-center gap-3 mb-6">
			<div class="p-2 rounded-lg" style="background: {color}20">
				{@render icon(color)}
			</div>
			<h3 class="text-lg font-black uppercase tracking-tighter">
				{title}
			</h3>
		</div>
		<div class="space-y-2 overflow-y-auto pr-2 custom-scrollbar flex-1">
			{#each ranking as item, idx}
				<div
					class="flex items-center gap-4 p-3 rounded-2xl bg-surface-50 dark:bg-white/5 border border-surface-100 dark:border-white/10 group transition-all hover:bg-surface-100 dark:hover:bg-white/10"
				>
					<span class="text-lg font-black text-surface-400 dark:text-surface-500 w-6 italic"
						>#{idx + 1}</span
					>
					<div class="flex-1">
						<p class="text-[0.6rem] font-black uppercase text-surface-400 leading-none mb-1">
							Seccional
						</p>
						<p class="text-xs font-bold leading-tight line-clamp-1">
							{item.nome.split(' do ')[0]}
						</p>
					</div>
					<div class="text-right">
						<p class="text-xl font-black" style="color: {color}">
							{labelUnit === 'kg' ? (item.total / 1000).toFixed(1) : item.total}<span
								class="text-[0.6rem] ml-0.5 opacity-50">{labelUnit}</span
							>
						</p>
						<p class="text-[0.5rem] font-bold uppercase opacity-50">Produção</p>
					</div>
				</div>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet subDetailing(
	id: string,
	title: string,
	details: [string, number][],
	total: number,
	color: string,
	unit: string
)}
	<div
		class="card relative p-6 bg-white dark:bg-surface-900 border-2 transition-all {selectedCharts.includes(
			id
		)
			? 'selected-for-export border-primary-500 shadow-xl shadow-primary-500/10'
			: 'border-surface-200 dark:border-surface-800 shadow-sm'} rounded-3xl flex flex-col h-full"
	>
		<!-- Selection Badge -->
		<button
			onclick={() => toggleChartSelection(id)}
			class="absolute top-2 right-2 md:top-3 md:right-3 w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl flex items-center justify-center transition-all {selectedCharts.includes(
				id
			)
				? 'bg-primary-500 text-white scale-110 shadow-lg'
				: 'bg-surface-100 dark:bg-surface-800 text-surface-500 hover:scale-105'}"
		>
			{#if selectedCharts.includes(id)}
				<svg class="w-4 h-4 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="4"
						d="M5 13l4 4L19 7"
					/></svg
				>
			{:else}
				<svg
					class="w-3 h-3 md:w-5 md:h-5 opacity-40"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="3"
						d="M12 6v6m0 0v6m0-6h6m-6 0H6"
					/></svg
				>
			{/if}
		</button>

		<div class="flex items-center gap-3 mb-6">
			<div class="p-2 rounded-lg" style="background: {color}10">
				<svg
					class="w-5 h-5"
					style="color: {color}"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
					/></svg
				>
			</div>
			<h3
				class="text-lg font-black uppercase tracking-tighter text-surface-900 dark:text-surface-50"
			>
				{title}
			</h3>
		</div>
		<div class="space-y-4 flex-1">
			{#each details as [tipo, valor]}
				<div class="space-y-1">
					<div class="flex justify-between text-[0.6rem] font-black uppercase">
						<span class="text-surface-500">{tipo}</span>
						<span style="color: {color}"
							>{unit === 'kg' ? (valor / 1000).toFixed(1) : valor.toLocaleString()}{unit}</span
						>
					</div>
					<div class="h-2 w-full bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
						<div
							class="h-full transition-all duration-1000"
							style="background: {color}; width: {(valor / (total || 1)) * 100}%"
						></div>
					</div>
				</div>
			{:else}
				<p class="text-center text-xs text-surface-400 italic py-8">Sem registros no período.</p>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet iconPrison(color: string)}
	<svg class="w-5 h-5" style="color: {color}" fill="none" stroke="currentColor" viewBox="0 0 24 24"
		><path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
		/></svg
	>
{/snippet}
{#snippet iconDrug(color: string)}
	<svg class="w-5 h-5" style="color: {color}" fill="none" stroke="currentColor" viewBox="0 0 24 24"
		><path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
		/></svg
	>
{/snippet}
{#snippet iconWeapon(color: string)}
	<svg class="w-5 h-5" style="color: {color}" fill="none" stroke="currentColor" viewBox="0 0 24 24"
		><path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
		/></svg
	>
{/snippet}

<div class="space-y-8 pb-12 {selectedCharts.length > 0 ? 'has-selections' : ''}">
	<header class="flex flex-col md:flex-row md:items-center justify-between gap-6">
		<div class="space-y-1">
			<h1
				class="text-2xl sm:text-4xl font-black text-surface-900 dark:text-surface-50 uppercase tracking-tighter"
			>
				Produção {filterTipo === 'seint' ? 'Inteligência' : 'Operacional'} GISE
			</h1>
			<p class="text-surface-500 font-medium">
				Análise filtrada e segmentada dos resultados reais {filterTipo === 'seint'
					? '(SEINT)'
					: '(P4-P19)'}
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-3">
			{#if allChartsCount > 0}
				<button
					class="btn text-[0.6rem] font-black uppercase tracking-widest px-4 py-2 rounded-xl transition-colors {selectedCharts.length >=
					allChartsCount
						? 'bg-surface-900 dark:bg-surface-50 text-white dark:text-surface-950 shadow-lg'
						: 'bg-surface-200/60 dark:bg-surface-800/60 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700'}"
					onclick={selectAllCharts}
				>
					{selectedCharts.length >= allChartsCount
						? 'Desmarcar Todos'
						: `Selecionar Todos (${allChartsCount})`}
				</button>
			{/if}

			<button
				class="btn {selectedCharts.length > 0
					? 'bg-rose-600 hover:bg-rose-700 shadow-rose-500/20 text-white'
					: 'bg-surface-200/80 dark:bg-surface-800/80 text-surface-500 dark:text-surface-400 cursor-not-allowed'} shadow-xl text-[0.65rem] font-black uppercase py-2 px-6 rounded-xl transition-all {selectedCharts.length >
				0
					? 'hover:scale-105 active:scale-95'
					: ''} flex items-center gap-2"
				onclick={exportChartsAsImages}
				disabled={selectedCharts.length === 0}
			>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="3"
						d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
					/></svg
				>
				Baixar PNGs {selectedCharts.length > 0 ? `(${selectedCharts.length})` : ''}
			</button>

			<button
				class="export-btn btn {selectedCharts.length > 0
					? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/20 text-white'
					: 'bg-surface-200/80 dark:bg-surface-800/80 text-surface-500 dark:text-surface-400 cursor-not-allowed'} shadow-xl text-[0.65rem] font-black uppercase py-2 px-6 rounded-xl transition-all {selectedCharts.length >
				0
					? 'hover:scale-105 active:scale-95'
					: ''} flex items-center gap-2"
				onclick={() => window.print()}
				disabled={selectedCharts.length === 0}
			>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="3"
						d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
					/></svg
				>
				Exportar PDF {selectedCharts.length > 0 ? `(${selectedCharts.length})` : ''}
			</button>
		</div>
	</header>

	<section
		class="card p-6 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm"
	>
		<div class="grid grid-cols-1 md:grid-cols-4 gap-6">
			<div class="space-y-1.5">
				<label
					for="f-tipo"
					class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest pl-1"
					>Tipo de Equipe</label
				>
				<select
					id="f-tipo"
					bind:value={filterTipo}
					class="w-full px-4 py-3 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold"
				>
					<option value="operacional">Operacional</option>
					<option value="seint">Inteligência (SEINT)</option>
				</select>
			</div>
			<div class="space-y-1.5">
				<label
					for="f-sec"
					class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest pl-1"
					>Seccional</label
				>
				<select
					id="f-sec"
					bind:value={filterSeccional}
					class="w-full px-4 py-3 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold"
				>
					<option value="">Todas as Seccionais</option>
					{#each data.seccionais ?? [] as sec}
						<option value={sec.id}>{sec.nome}</option>
					{/each}
				</select>
			</div>
			<div class="space-y-1.5">
				<label
					for="f-ini"
					class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest pl-1">De</label
				>
				<input
					id="f-ini"
					type="date"
					bind:value={filterInicio}
					class="w-full px-4 py-3 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold"
				/>
			</div>
			<div class="space-y-1.5">
				<label
					for="f-fim"
					class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest pl-1"
					>Até</label
				>
				<input
					id="f-fim"
					type="date"
					bind:value={filterFim}
					class="w-full px-4 py-3 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold"
				/>
			</div>
		</div>
	</section>

	<!-- Highlights Analytics: 3 Strategic Rows [Ranking | Detailing] -->
	{#if filterTipo === 'operacional'}
		<div class="space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
			<!-- ROW 1: PRISONS -->
			<section class="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{@render subRanking(
					'rank-prisoes',
					'Ranking de Prisões (P7)',
					rankingPrisoes,
					'#f43f5e',
					iconPrison,
					''
				)}
				{@render subDetailing(
					'detail-prisoes',
					'Detalhamento de Prisões',
					[
						['Flagrantes (P4)', stats.prisaoFlagrante],
						['Mandados (P5)', stats.prisaoMandado],
						['Total de Presos (P7)', stats['prisoes_apreensoes_flagrante'] || 0]
					],
					Math.max(
						stats['prisoes_apreensoes_flagrante'] || 0,
						stats.prisaoFlagrante,
						stats.prisaoMandado
					),
					'#f43f5e',
					''
				)}
			</section>

			<!-- ROW 2: DRUGS -->
			<section class="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{@render subRanking(
					'rank-drogas',
					'Ranking de Drogas (P10)',
					rankingDrogasPeso,
					'#ef4444',
					iconDrug,
					'kg'
				)}
				{@render subDetailing(
					'detail-drogas',
					'Detalhamento de Substâncias',
					(Object.entries(stats.drogasPorTipo) as [string, number][])
						.sort((a, b) => b[1] - a[1])
						.slice(0, 8),
					stats.drogasGeral,
					'#ef4444',
					'g'
				)}
			</section>

			<!-- ROW 3: WEAPONS -->
			<section class="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{@render subRanking(
					'rank-armas',
					'Ranking de Armas (P11)',
					rankingArmas,
					'#6366f1',
					iconWeapon,
					''
				)}
				{@render subDetailing(
					'detail-armas',
					'Detalhamento de Armas',
					(Object.entries(stats.armasPorTipo) as [string, number][])
						.sort((a, b) => b[1] - a[1])
						.slice(0, 8),
					stats.apreensoes_armas,
					'#6366f1',
					''
				)}
			</section>
		</div>
	{/if}

	<!-- Summary Display & Charts Grid (Single Column for better clarity with many regionals) -->
	<section class="space-y-8">
		{#each QUESTIONS as q (q.id)}
			<div
				class="card relative p-8 bg-white dark:bg-surface-900 border-2 transition-all {selectedCharts.includes(
					q.id
				)
					? 'selected-for-export border-primary-500 shadow-xl shadow-primary-500/10'
					: 'border-surface-100 dark:border-surface-800 shadow-sm'} rounded-3xl overflow-hidden flex flex-col md:flex-row gap-4"
			>
				<button
					onclick={() => toggleChartSelection(q.id)}
					class="absolute top-2 right-2 md:top-3 md:right-3 w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl flex items-center justify-center transition-all {selectedCharts.includes(
						q.id
					)
						? 'bg-primary-500 text-white scale-110 shadow-lg'
						: 'bg-surface-100 dark:bg-surface-800 text-surface-500 hover:scale-105'}"
				>
					{#if selectedCharts.includes(q.id)}
						<svg class="w-4 h-4 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="4"
								d="M5 13l4 4L19 7"
							/></svg
						>
					{:else}
						<svg
							class="w-3 h-3 md:w-5 md:h-5 opacity-40"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							><path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="3"
								d="M12 6v6m0 0v6m0-6h6m-6 0H6"
							/></svg
						>
					{/if}
				</button>
				<div class="md:w-1/6 flex flex-col justify-center">
					<p class="text-[0.6rem] font-black text-surface-400 uppercase tracking-widest mb-1">
						{q.label}
					</p>
					<h3 class="text-5xl font-black" style="color: {q.color}">
						{#if q.specialStore === 'drogasGeral'}
							{(stats.drogasGeral / 1000).toFixed(2)}<span class="text-sm ml-1 opacity-60">kg</span>
						{:else if q.isBool}
							{filteredData.filter((i) => JSON.parse(i.respostas || '{}')[q.key] === 'Sim').length}
						{:else}
							{stats[q.key as keyof typeof stats] ??
								filteredData.reduce(
									(acc, i) => acc + (Number(JSON.parse(i.respostas || '{}')[q.key]) || 0),
									0
								)}
						{/if}
					</h3>
					<div class="mt-4 flex gap-2">
						<span
							class="text-[0.5rem] font-bold px-2 py-1 rounded uppercase bg-surface-100 dark:bg-surface-800 text-surface-500"
						>
							{filterSeccional ? 'Tendência' : 'Comparação Seccional'}
						</span>
					</div>
				</div>
				<div class="flex-1 min-h-[250px] w-full">
					<canvas bind:this={canvasElements[q.id]}></canvas>
				</div>
			</div>
		{/each}
	</section>
</div>

<style>
	@media print {
		.card {
			break-inside: avoid !important;
			page-break-inside: avoid !important;
			box-shadow: none !important;
			border-color: #e2e8f0 !important;
		}

		/* If selections exist, hide everything except selected cards */
		:global(.has-selections) .card:not(.selected-for-export) {
			display: none !important;
		}

		/* Also hide filters and extra texts if selection is active */
		:global(.has-selections) section:first-of-type,
		:global(.has-selections) header p {
			display: none !important;
		}

		.export-btn,
		header p {
			display: none !important;
		}

		:global(body) {
			background: white !important;
		}
	}

	.custom-scrollbar::-webkit-scrollbar {
		width: 4px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background: #64748b30;
		border-radius: 10px;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background: #64748b60;
	}
</style>
