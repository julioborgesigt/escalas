/**
 * O motor dos filtros de listagem: persiste, navega e RESETA a página.
 *
 * O reset é a razão de existir. Filtro que muda sem voltar à página 1 leva o
 * usuário para uma página que talvez não exista mais no novo recorte — a tela
 * fica vazia e parece que o filtro não achou nada, quando na verdade achou e a
 * paginação é que ficou para trás.
 *
 * A `assinatura` é explícita, e não "todos os filtros", porque nem todo filtro
 * deve ir ao servidor: busca textual tem debounce próprio e recorte de
 * dropdown (a seccional, em `/escalas`) só afeta o cliente. Incluí-los aqui
 * dispararia consulta a cada tecla ou a cada troca de recorte local.
 */
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { untrack } from 'svelte';

interface FiltrosPaginadosAuto {
	/**
	 * Deps reativas cuja mudança dispara a navegação para a página 1.
	 * Só as leituras feitas aqui são observadas — inclua apenas os filtros
	 * que devem re-consultar o servidor (ex.: exclua uma busca textual que
	 * já tem debounce próprio, ou um filtro que só afeta o cliente).
	 */
	assinatura: () => readonly unknown[];
	/**
	 * Retorna, em ms, quanto esperar antes de navegar quando a assinatura
	 * muda. `0` (ou ausência) navega imediatamente. Útil para adiar a ida
	 * ao servidor enquanto o usuário digita num campo de texto.
	 */
	debounce?: (anterior: readonly unknown[], atual: readonly unknown[]) => number;
}

export interface FiltrosPaginadosOpcoes<T extends Record<string, unknown>> {
	/** Chave do localStorage onde o snapshot dos filtros é persistido. */
	chave: string;
	/** Snapshot reativo dos filtros (lê os `$state`) — persistido a cada mudança. */
	snapshot: () => T;
	/**
	 * Monta os parâmetros da query para a página desejada. Omitir quando a
	 * página apenas persiste filtros e filtra no cliente (sem navegação).
	 * O caller decide quais sentinelas ('todas', '', 0…) devem ser omitidas.
	 */
	query?: (pagina: number) => URLSearchParams;
	/** Destino quando a query fica vazia (default: pathname atual). */
	destinoVazio?: () => string;
	/** Liga a navegação automática ao mudar filtros (requer `query`). */
	auto?: FiltrosPaginadosAuto;
}

export interface FiltrosPaginados {
	/** Navega aplicando os filtros atuais (default: página 1). */
	navegar(pagina?: number, opcoes?: { replace?: boolean }): void;
	/** Atalho para navegar até uma página específica mantendo os filtros. */
	irParaPagina(pagina: number): void;
}

/**
 * Consolida o padrão repetido nas páginas de listagem: persistir os filtros
 * no localStorage, montar a query e navegar (`goto`) mantendo foco/scroll, e —
 * opcionalmente — re-navegar automaticamente quando um filtro muda, sem os
 * `let prev*` + comparação manual espalhados por cada página.
 *
 * Não é dono do estado dos filtros: a página mantém seus `$state` e passa
 * getters (`snapshot`, `query`, `auto.assinatura`), o que evita reescrever os
 * `bind:value` do template.
 *
 * @example
 * // Persistência + navegação + auto-nav
 * const filtros = useFiltrosPaginados({
 *   chave: 'filtros_escalas',
 *   snapshot: () => ({ lotacao: filtroLotacao, mes: filtroMes, ... }),
 *   query: (p) => {
 *     const params = new URLSearchParams();
 *     if (filtroLotacao) params.set('lotacao', filtroLotacao);
 *     params.set('page', String(p));
 *     return params;
 *   },
 *   auto: { assinatura: () => [filtroLotacao, filtroMes, filtroSeccional] }
 * });
 * // ...no template: onPageChange={filtros.irParaPagina}
 */
export function useFiltrosPaginados<T extends Record<string, unknown>>(
	opcoes: FiltrosPaginadosOpcoes<T>
): FiltrosPaginados {
	const auto = opcoes.auto;
	let autoMontado = false;
	let autoAnterior: readonly unknown[] = [];
	let autoTimer: ReturnType<typeof setTimeout> | undefined;

	// Persiste o snapshot a cada mudança dos filtros observados por `snapshot()`.
	$effect(() => {
		const snap = opcoes.snapshot();
		if (browser) localStorage.setItem(opcoes.chave, JSON.stringify(snap));
	});

	function navegar(pagina = 1, { replace = false }: { replace?: boolean } = {}) {
		if (!opcoes.query) return;
		const qs = opcoes.query(pagina).toString();
		const destino = qs ? `?${qs}` : (opcoes.destinoVazio?.() ?? page.url.pathname);
		goto(destino, { keepFocus: true, noScroll: true, replaceState: replace });
		// Uma navegação explícita já reflete o estado atual: re-sincroniza a
		// baseline do auto-nav para não disparar outra logo em seguida
		// (equivale ao antigo `prev = novo` antes de navegar).
		if (auto) {
			autoAnterior = auto.assinatura();
			clearTimeout(autoTimer);
		}
	}

	function irParaPagina(pagina: number) {
		navegar(pagina);
	}

	// Navegação automática: detecta a mudança comparando a assinatura anterior
	// com a atual, dispensando os `let prev*` manuais. O primeiro run apenas
	// registra o estado inicial (equivale ao guard `if (!mounted)`).
	if (auto) {
		$effect(() => {
			const atual = auto.assinatura();
			if (!autoMontado) {
				autoMontado = true;
				autoAnterior = atual;
				return;
			}
			const igual =
				atual.length === autoAnterior.length && atual.every((v, i) => v === autoAnterior[i]);
			if (igual) return;

			const espera = auto.debounce?.(autoAnterior, atual) ?? 0;
			autoAnterior = atual;
			clearTimeout(autoTimer);
			// `navegar` lê filtros/URL — untrack para não virar dep deste efeito.
			if (espera > 0) {
				autoTimer = setTimeout(() => navegar(1), espera);
			} else {
				untrack(() => navegar(1));
			}
		});

		// Efeito separado (sem deps) só para limpar o timer pendente ao destruir —
		// não pode ficar no efeito acima, que re-executa a cada mudança.
		$effect(() => () => clearTimeout(autoTimer));
	}

	return { navegar, irParaPagina };
}
