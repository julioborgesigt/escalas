import { toaster } from '$lib/toast';
import { loading } from '$lib/loading.svelte';
import { page } from '$app/state';
import { goto, invalidateAll } from '$app/navigation';

export function useResGise(getData: () => any) {
	// --- Derived do Objeto de Dados (Reactive Root) ---
	const data = $derived(getData());

	// --- Estados de Interface ---
	let activeTab = $state('relatorios'); // relatorios | configurador
	let configTipo = $state<'operacional' | 'seint'>('operacional');
	let perguntasConfig = $state<any[]>([]);
	// --- Estados de Escala / Resposta ---
	let escalaSelecionada = $state<any>(null);
	let respostas = $state<any>({});
	let exibirRelatorio = $state(false);
	let capturandoRubrica = $state(false);

	// --- Filtros ---
	let statusFilterUrl = $state(page.url.searchParams.get('status') || '');
	let mesFilterUrl = $state(page.url.searchParams.get('mes') || '');
	let dataFilterUrl = $state(page.url.searchParams.get('data') || '');
	let seccionalFilter = $state('todas');

	// --- Efeitos de Sincronização ---
	$effect(() => {
		const source = configTipo === 'seint' ? data.modeloSeint : data.modeloOperacional;
		perguntasConfig = structuredClone(source);
	});

	$effect(() => {
		respostas = data.respostas ?? {};
	});

	// --- Derived ---
	const configJson = $derived(JSON.stringify(perguntasConfig));
	const respostasJson = $derived(JSON.stringify(respostas));

	const seccionaisUnicas = $derived(
		['todas', ...Array.from(new Set(data.listaAdmin?.map((e: any) => e.seccional_nome) || []))].sort(
			(a: any, b: any) => {
				if (a === 'todas') return -1;
				if (b === 'todas') return 1;
				return String(a).localeCompare(String(b));
			}
		)
	);

	const listaFiltrada = $derived(
		(data.listaAdmin || []).filter((e: any) => {
			return seccionalFilter === 'todas' || e.seccional_nome === seccionalFilter;
		})
	);

	const perguntasForm = $derived.by(() => {
		if (!escalaSelecionada) return [];
		const res =
			escalaSelecionada.equipe_tipo === 'seint' ? data.modeloSeint : data.modeloOperacional;
		return Array.isArray(res) ? res : [];
	});

	// --- Funções de Navegação e Filtro ---
	function navigateWithFilters(params: Record<string, string | null>) {
		const navUrl = new URL(page.url);
		Object.entries(params).forEach(([key, value]) => {
			if (value) navUrl.searchParams.set(key, value);
			else navUrl.searchParams.delete(key);
		});
		goto(navUrl.pathname + navUrl.search, { keepFocus: true, noScroll: true });
	}

	function changeStatusFilter(status: string) {
		statusFilterUrl = status;
		navigateWithFilters({ status });
	}

	function changeDateFilter(type: 'mes' | 'data', value: string) {
		if (type === 'mes') {
			mesFilterUrl = value;
			dataFilterUrl = '';
			navigateWithFilters({ mes: value, data: null });
		} else {
			dataFilterUrl = value;
			mesFilterUrl = '';
			navigateWithFilters({ data: value, mes: null });
		}
	}

	function limparFiltros() {
		statusFilterUrl = '';
		mesFilterUrl = '';
		dataFilterUrl = '';
		navigateWithFilters({ status: null, mes: null, data: null });
	}

	// --- Funções do Configurador ---
	function adicionarPergunta() {
		const id = Date.now();
		perguntasConfig = [
			...perguntasConfig,
			{ id, texto: '', tipo: 'texto', obrigatoria: false, key: `extra_${id}`, filhos: [] }
		];
	}

	function adicionarSubPergunta(pai: any) {
		const id = Date.now();
		pai.filhos = [
			...(pai.filhos || []),
			{ id, texto: '', tipo: 'texto', obrigatoria: false, key: `extra_${id}`, filhos: [] }
		];
		perguntasConfig = [...perguntasConfig];
	}

	function removerPergunta(id: number, lista = perguntasConfig) {
		const idx = lista.findIndex((p: any) => p.id === id);
		if (idx > -1) {
			lista.splice(idx, 1);
			perguntasConfig = [...perguntasConfig];
			return true;
		}
		for (const p of lista) {
			if (p.filhos && removerPergunta(id, p.filhos)) return true;
		}
		return false;
	}

	function handleSalvarModelo() {
		loading.show(`Salvando Modelo ${configTipo}...`);
		return async ({ result }: any) => {
			loading.hide();
			if (result.type === 'success') {
				toaster.success({ title: `Modelo ${configTipo} salvo com sucesso` });
				await invalidate(page.url.href);
			} else {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.error({ title: String(d?.error || 'Erro ao salvar modelo') });
			}
		};
	}

	// --- Funções de Escala ---
	async function selecionarEscala(escala: any, podeVerListaGeral: boolean) {
		const isSame =
			escalaSelecionada?.id === escala.id && escalaSelecionada?.equipe_id === escala.equipe_id;
		if (isSame) return;

		escalaSelecionada = escala;
		exibirRelatorio = podeVerListaGeral || !escala.equipeRespondida;
		respostas = {};

		const params = new URLSearchParams(page.url.searchParams);
		params.set('giseId', String(escala.id));
		if (escala.equipe_id) params.set('equipeId', String(escala.equipe_id));
		else params.delete('equipeId');

		await goto(`?${params}`, { keepFocus: true, noScroll: true });
	}

	function handleSalvarResposta(podeVerListaGeral: boolean) {
		return ({ cancel }: any) => {
			if (!escalaSelecionada) {
				cancel();
				return;
			}
			loading.show('Enviando relatório de produtividade...');
			return async ({ result }: any) => {
				loading.hide();
				if (result.type === 'success') {
					toaster.success({ title: 'Relatório salvo com sucesso' });
					// Atualiza imediatamente sem precisar de reload da página
					escalaSelecionada = { ...escalaSelecionada, equipeRespondida: true };
					if (!podeVerListaGeral) exibirRelatorio = false;
					await invalidateAll();
					const atualizada = data.minhasEscalas?.find(
						(e: any) => e.id === escalaSelecionada?.id && e.equipe_id === escalaSelecionada?.equipe_id
					);
					if (atualizada) escalaSelecionada = atualizada;
				} else {
					const d = result.data as Record<string, unknown> | undefined;
					toaster.error({ title: String(d?.error || 'Erro ao salvar resposta') });
				}
			};
		};
	}

	async function salvarEntrada(
		rubrica: string,
		latitude?: number,
		longitude?: number,
		selfieBase64?: string,
		codigoEmail?: string,
		desafioId?: string
	) {
		if (!escalaSelecionada) return;
		loading.show('Confirmando Entrada...');
		try {
			const fd = new FormData();
			fd.set('giseId', escalaSelecionada.id);
			fd.set('rubrica', rubrica);
			if (latitude !== undefined) fd.set('latitude', String(latitude));
			if (longitude !== undefined) fd.set('longitude', String(longitude));
			if (selfieBase64) fd.set('selfieBase64', selfieBase64);
			if (codigoEmail) fd.set('codigoEmail', codigoEmail);
			if (desafioId) fd.set('desafioId', desafioId);

			const resp = await fetch('?/salvarEntrada', { method: 'POST', body: fd });
			const result = (await resp.json()) as Record<string, unknown> | undefined;

			if (!resp.ok) throw new Error((result?.error as string) || 'Erro ao salvar entrada');

			toaster.success({ title: 'Entrada confirmada com sucesso' });
			capturandoRubrica = false;
			await invalidateAll();
			const atualizada = data.minhasEscalas?.find((e: any) => e.id === escalaSelecionada.id);
			if (atualizada) escalaSelecionada = atualizada;
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			loading.hide();
		}
	}

	// --- Getters / Utils ---
	const fmtDate = (iso: string) => {
		if (!iso) return '';
		const [y, m, d] = iso.split('-');
		return `${d}/${m}/${y}`;
	};

	const isHorarioLiberado = (escala: any, podeVerListaGeral: boolean) => {
		if (podeVerListaGeral) return true;
		if (!escala?.horarioPrevisto?.inicio) return true;
		const agora = new Date();
		const [h, min] = escala.horarioPrevisto.inicio.split(':');
		const dataInicioPrevista = new Date(
			escala.data_inicio + 'T' + h.padStart(2, '0') + ':' + (min || '00') + ':00'
		);
		return agora >= dataInicioPrevista;
	};

	const isSaidaLiberada = (escala: any, podeVerListaGeral: boolean) => {
		if (podeVerListaGeral) return true;
		if (!escala?.horarioPrevisto?.fim) return true;
		const agora = new Date();
		const [h, min] = escala.horarioPrevisto.fim.split(':');
		const dataFimPrevista = new Date(
			escala.data_inicio + 'T' + h.padStart(2, '0') + ':' + (min || '00') + ':00'
		);
		return agora >= dataFimPrevista;
	};

	async function salvarSaida(
		rubrica: string,
		latitude?: number,
		longitude?: number,
		selfieBase64?: string,
		codigoEmail?: string,
		desafioId?: string
	) {
		if (!escalaSelecionada) return;
		loading.show('Confirmando Saída...');
		try {
			const fd = new FormData();
			fd.set('giseId', escalaSelecionada.id);
			fd.set('rubrica', rubrica);
			if (latitude !== undefined) fd.set('latitude', String(latitude));
			if (longitude !== undefined) fd.set('longitude', String(longitude));
			if (selfieBase64) fd.set('selfieBase64', selfieBase64);
			if (codigoEmail) fd.set('codigoEmail', codigoEmail);
			if (desafioId) fd.set('desafioId', desafioId);

			const resp = await fetch('?/salvarSaida', { method: 'POST', body: fd });
			const result = (await resp.json()) as Record<string, unknown> | undefined;

			if (!resp.ok) throw new Error((result?.error as string) || 'Erro ao salvar saída');

			toaster.success({ title: 'Saída confirmada com sucesso' });
			capturandoRubrica = false;
			await invalidateAll();
			// After saving saída, the escala is filtered out of minhasEscalas (it's now 'finished').
			// Patch escalaSelecionada directly so the UI shows 'Saída Confirmada' without a page reload.
			const atualizada = data.minhasEscalas?.find((e: any) => e.id === escalaSelecionada.id);
			if (atualizada) {
				escalaSelecionada = atualizada;
			} else {
				escalaSelecionada = {
					...escalaSelecionada,
					presenca: {
						...(escalaSelecionada.presenca || {}),
						saida_timestamp: new Date().toISOString()
					}
				};
			}
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			loading.hide();
		}
	}

	async function baixarRelatorio(escala: any) {
		loading.show('Baixando Relatório de Produtividade...');
		try {
			const url = `/api/gise/${escala.id}/download?format=produtividade&seccionalId=${escala.seccional_id}&equipeType=${escala.equipe_tipo}`;
			const res = await fetch(url);
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.error || 'Erro ao baixar relatório');
			}
			const blob = await res.blob();
			const downloadUrl = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = downloadUrl;
			a.download = `relatorio_produtividade_${escala.seccional_nome}_${escala.data_inicio}.pdf`;
			document.body.appendChild(a);
			a.click();
			a.remove();
		} catch (e: any) {
			toaster.error({ title: 'Erro no Download', description: e.message });
		} finally {
			loading.hide();
		}
	}

	async function baixarRelatorioExtra(escala: any) {
		loading.show('Baixando Relatório Extraordinário...');
		try {
			const url = `/api/gise/${escala.id}/download?format=extraordinario&seccionalId=${escala.seccional_id}`;
			const res = await fetch(url);
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.error || 'Erro ao baixar relatório');
			}
			const blob = await res.blob();
			const downloadUrl = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = downloadUrl;
			a.download = `relatorio_extraordinario_${escala.seccional_nome}_${escala.data_inicio}.pdf`;
			document.body.appendChild(a);
			a.click();
			a.remove();
		} catch (e: any) {
			toaster.error({ title: 'Erro no Download', description: e.message });
		} finally {
			loading.hide();
		}
	}

	return {
		// Getters
		get activeTab() { return activeTab; },
		set activeTab(v) { activeTab = v; },
		get configTipo() { return configTipo; },
		set configTipo(v) { configTipo = v; },
		get perguntasConfig() { return perguntasConfig; },
		set perguntasConfig(v) { perguntasConfig = v; },
		get escalaSelecionada() { return escalaSelecionada; },
		set escalaSelecionada(v) { escalaSelecionada = v; },
		get respostas() { return respostas; },
		set respostas(v) { respostas = v; },
		get exibirRelatorio() { return exibirRelatorio; },
		set exibirRelatorio(v) { exibirRelatorio = v; },
		get capturandoRubrica() { return capturandoRubrica; },
		set capturandoRubrica(v) { capturandoRubrica = v; },
		get seccionalFilter() { return seccionalFilter; },
		set seccionalFilter(v) { seccionalFilter = v; },
		get baixandoProdutividade() { return loading.active; },
		get baixandoExtra() { return loading.active; },

		// Derived
		get configJson() { return configJson; },
		get respostasJson() { return respostasJson; },
		get seccionaisDisponiveis() { return seccionaisUnicas; },
		get listaFiltrada() { return listaFiltrada; },
		get perguntasForm() { return perguntasForm; },
		get statusFilterUrl() { return statusFilterUrl; },
		get mesFilterUrl() { return mesFilterUrl; },
		get dataFilterUrl() { return dataFilterUrl; },

		// Actions
		changeStatusFilter,
		changeDateFilter,
		limparFiltros,
		adicionarPergunta,
		adicionarSubPergunta,
		removerPergunta,
		handleSalvarModelo,
		selecionarEscala,
		handleSalvarResposta,
		salvarEntrada,
		salvarSaida,
		baixarRelatorio,
		baixarRelatorioExtra,
		fmtDate,
		isHorarioLiberado,
		isSaidaLiberada
	};
}
