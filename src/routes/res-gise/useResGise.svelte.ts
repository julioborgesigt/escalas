import { toaster } from '$lib/toast';
import { fmtDate } from '$lib/gise/gise-formatters';
import { loading } from '$lib/loading.svelte';
import { page } from '$app/state';
import { goto, invalidateAll } from '$app/navigation';
import type { ActionResult } from '@sveltejs/kit';
import type {
	GiseModeloPerguntaConfig,
	ResGiseEscalaSelecionavel,
	ResGisePageData
} from '$lib/types';
import type { GisePresenca } from '$lib/server/schema';
import type { SignaturePadConfirmPayload } from '$lib/components/SignaturePad.svelte';

function messageFromUnknown(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** Filtro de escalas na URL (`?status=ativas|finalizadas`); admin não usa mais lista nesta rota. */
function resolveStatusFilterFromUrl(
	usuario: { tipo?: string } | null | undefined,
	url: URL
): string {
	const q = url.searchParams.get('status');
	if (q === 'ativas' || q === 'finalizadas') return q;
	if (usuario?.tipo === 'admin') return '';
	return '';
}

export function useResGise(getData: () => ResGisePageData) {
	// --- Derived do Objeto de Dados (Reactive Root) ---
	const data = $derived(getData());

	// --- Estados de Interface ---
	let configTipo = $state<'operacional' | 'seint'>('operacional');
	let perguntasConfig = $state<GiseModeloPerguntaConfig[]>([]);
	// --- Estados de Escala / Resposta ---
	let escalaSelecionada = $state<ResGiseEscalaSelecionavel | null>(null);
	let respostas = $state<Record<string, unknown>>({});
	let exibirRelatorio = $state(false);
	let capturandoRubrica = $state(false);

	// --- Filtros ---
	let statusFilterUrl = $state(resolveStatusFilterFromUrl(page.data.usuario, page.url));
	let mesFilterUrl = $state(page.url.searchParams.get('mes') || '');
	let dataFilterUrl = $state(page.url.searchParams.get('data') || '');

	// --- Efeitos de Sincronização ---
	$effect(() => {
		const source = configTipo === 'seint' ? data.modeloSeint : data.modeloOperacional;
		perguntasConfig = structuredClone(source);
	});

	$effect(() => {
		respostas = data.respostas ?? {};
	});

	/** Sincroniza com a URL quando `?status=` está presente (evita sobrescrever antes do `goto`). */
	$effect(() => {
		const q = page.url.searchParams.get('status');
		if (q === 'ativas' || q === 'finalizadas') {
			if (q !== statusFilterUrl) statusFilterUrl = q;
		}
	});

	// --- Derived ---
	const configJson = $derived(JSON.stringify(perguntasConfig));
	const respostasJson = $derived(JSON.stringify(respostas));

	const perguntasForm = $derived.by(() => {
		if (!escalaSelecionada) return [];
		const res =
			escalaSelecionada.equipe_tipo === 'seint' ? data.modeloSeint : data.modeloOperacional;
		return Array.isArray(res) ? res : [];
	});

	// --- Funções de Navegação e Filtro ---
	function navigateWithFilters(params: Record<string, string | null>) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
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

	function adicionarSubPergunta(pai: GiseModeloPerguntaConfig) {
		const id = Date.now();
		pai.filhos = [
			...(pai.filhos || []),
			{ id, texto: '', tipo: 'texto', obrigatoria: false, key: `extra_${id}`, filhos: [] }
		];
		perguntasConfig = [...perguntasConfig];
	}

	function removerPergunta(id: number, lista = perguntasConfig) {
		const idx = lista.findIndex((p) => p.id === id);
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
		return async ({ result }: { result: ActionResult }) => {
			loading.hide();
			if (result.type === 'success') {
				toaster.success({ title: `Modelo ${configTipo} salvo com sucesso` });
				await invalidateAll();
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.error({ title: String(d?.error || 'Erro ao salvar modelo') });
			}
		};
	}

	// --- Funções de Escala ---
	async function selecionarEscala(escala: ResGiseEscalaSelecionavel, isAdminGeral: boolean) {
		const isSame =
			escalaSelecionada?.id === escala.id && escalaSelecionada?.equipe_id === escala.equipe_id;
		if (isSame) return;

		escalaSelecionada = escala;
		exibirRelatorio = isAdminGeral || !escala.equipeRespondida;
		respostas = {};

		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const params = new URLSearchParams(page.url.searchParams);
		params.set('giseId', String(escala.id));
		if (escala.equipe_id) params.set('equipeId', String(escala.equipe_id));
		else params.delete('equipeId');

		await goto(`?${params}`, { keepFocus: true, noScroll: true });
	}

	function handleSalvarResposta(isAdminGeral: boolean) {
		return ({ cancel }: { cancel: () => void }) => {
			const sel = escalaSelecionada;
			if (!sel) {
				cancel();
				return;
			}
			loading.show('Enviando relatório de produtividade...');
			return async ({ result }: { result: ActionResult }) => {
				loading.hide();
				if (result.type === 'success') {
					toaster.success({ title: 'Relatório salvo com sucesso' });
					// Atualiza imediatamente sem precisar de reload da página
					escalaSelecionada = { ...sel, equipeRespondida: true } as ResGiseEscalaSelecionavel;
					if (!isAdminGeral) exibirRelatorio = false;
					await invalidateAll();
					const atualizada = data.minhasEscalas?.find(
						(e) => e.id === sel.id && e.equipe_id === sel.equipe_id
					);
					if (atualizada) escalaSelecionada = atualizada;
				} else if (result.type === 'failure') {
					const d = result.data as Record<string, unknown> | undefined;
					toaster.error({ title: String(d?.error || 'Erro ao salvar resposta') });
				}
			};
		};
	}

	async function salvarEntrada(payload: SignaturePadConfirmPayload) {
		const {
			rubrica,
			lat: latitude,
			lng: longitude,
			selfie: selfieBase64,
			codigoEmail,
			desafioId
		} = payload;
		if (!escalaSelecionada) return;
		const giseAlvoId = escalaSelecionada.id;
		loading.show('Confirmando Entrada...');
		try {
			const fd = new FormData();
			fd.set('giseId', String(giseAlvoId));
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
			const eqIdEnt = escalaSelecionada?.equipe_id;
			const atualizada = data.minhasEscalas?.find(
				(e) => e.id === giseAlvoId && e.equipe_id === eqIdEnt
			);
			if (atualizada) escalaSelecionada = atualizada;
		} catch (e: unknown) {
			toaster.error({ title: 'Erro', description: messageFromUnknown(e) });
		} finally {
			loading.hide();
		}
	}

	// --- Getters / Utils ---
	const isHorarioLiberado = (escala: ResGiseEscalaSelecionavel, isAdminGeral: boolean) => {
		if (isAdminGeral) return true;
		if (!escala?.horarioPrevisto?.inicio) return true;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const agora = new Date();
		const [h, min] = escala.horarioPrevisto.inicio.split(':');
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const dataInicioPrevista = new Date(
			escala.data_inicio + 'T' + h.padStart(2, '0') + ':' + (min || '00') + ':00'
		);
		return agora >= dataInicioPrevista;
	};

	const isSaidaLiberada = (escala: ResGiseEscalaSelecionavel, isAdminGeral: boolean) => {
		if (isAdminGeral) return true;
		if (!escala?.horarioPrevisto?.fim) return true;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const agora = new Date();
		const [h, min] = escala.horarioPrevisto.fim.split(':');
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const dataFimPrevista = new Date(
			escala.data_inicio + 'T' + h.padStart(2, '0') + ':' + (min || '00') + ':00'
		);
		return agora >= dataFimPrevista;
	};

	async function salvarSaida(payload: SignaturePadConfirmPayload) {
		const {
			rubrica,
			lat: latitude,
			lng: longitude,
			selfie: selfieBase64,
			codigoEmail,
			desafioId
		} = payload;
		if (!escalaSelecionada) return;
		const giseAlvoIdSaida = escalaSelecionada.id;
		loading.show('Confirmando Saída...');
		try {
			const fd = new FormData();
			fd.set('giseId', String(giseAlvoIdSaida));
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
			const eqId = escalaSelecionada?.equipe_id;
			const atualizada = data.minhasEscalas?.find(
				(e) => e.id === giseAlvoIdSaida && e.equipe_id === eqId
			);
			if (atualizada) {
				escalaSelecionada = atualizada;
			} else {
				const sel = escalaSelecionada;
				const prev = 'presenca' in sel && sel.presenca ? sel.presenca : undefined;
				escalaSelecionada = {
					...sel,
					// eslint-disable-next-line svelte/prefer-svelte-reactivity
				presenca: { ...prev, saida_timestamp: new Date().toISOString() } as GisePresenca
				} as ResGiseEscalaSelecionavel;
			}
		} catch (e: unknown) {
			toaster.error({ title: 'Erro', description: messageFromUnknown(e) });
		} finally {
			loading.hide();
		}
	}

	async function baixarRelatorio(escala: ResGiseEscalaSelecionavel) {
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
			window.URL.revokeObjectURL(downloadUrl);
		} catch (e: unknown) {
			toaster.error({ title: 'Erro no Download', description: messageFromUnknown(e) });
		} finally {
			loading.hide();
		}
	}

	async function baixarRelatorioExtra(escala: ResGiseEscalaSelecionavel) {
		loading.show('Baixando Relatório Extraordinário...');
		try {
			const secId =
				escala.seccional_id === 0 && data.supervisaoExtraUnidadeId != null
					? data.supervisaoExtraUnidadeId
					: escala.seccional_id;
			const url = `/api/gise/${escala.id}/download?format=extraordinario&seccionalId=${secId}`;
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
			window.URL.revokeObjectURL(downloadUrl);
		} catch (e: unknown) {
			toaster.error({ title: 'Erro no Download', description: messageFromUnknown(e) });
		} finally {
			loading.hide();
		}
	}

	return {
		// Getters
		get configTipo() {
			return configTipo;
		},
		set configTipo(v) {
			configTipo = v;
		},
		get perguntasConfig() {
			return perguntasConfig;
		},
		set perguntasConfig(v) {
			perguntasConfig = v;
		},
		get escalaSelecionada() {
			return escalaSelecionada;
		},
		set escalaSelecionada(v) {
			escalaSelecionada = v;
		},
		get respostas() {
			return respostas;
		},
		set respostas(v) {
			respostas = v;
		},
		get exibirRelatorio() {
			return exibirRelatorio;
		},
		set exibirRelatorio(v) {
			exibirRelatorio = v;
		},
		get capturandoRubrica() {
			return capturandoRubrica;
		},
		set capturandoRubrica(v) {
			capturandoRubrica = v;
		},
		get baixandoProdutividade() {
			return loading.active;
		},
		get baixandoExtra() {
			return loading.active;
		},

		// Derived
		get configJson() {
			return configJson;
		},
		get respostasJson() {
			return respostasJson;
		},
		get perguntasForm() {
			return perguntasForm;
		},
		get statusFilterUrl() {
			return statusFilterUrl;
		},
		get mesFilterUrl() {
			return mesFilterUrl;
		},
		get dataFilterUrl() {
			return dataFilterUrl;
		},

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
