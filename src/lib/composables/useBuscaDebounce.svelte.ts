/**
 * Busca remota com debounce + cancelamento.
 *
 * Encapsula a máquina que se repetia em toda busca assíncrona de UI:
 * timer de debounce, AbortController da requisição em voo (resultado
 * velho nunca sobrescreve busca mais nova), flags de loading/erro e o
 * marcador `buscou` para diferençar "nunca buscou" de "buscou e veio
 * vazio". Usada pelo SearchableSelect e pela busca de destinatário do
 * DialogSolicitarAssinatura.
 */
export function useBuscaDebounce<T>(opts: {
	/** Executa a busca em si (tipicamente via `apiFetch`, repassando o signal). */
	buscar: (termo: string, signal: AbortSignal) => Promise<T[]>;
	/** Aceita função para props reativas (lidas a cada busca). */
	debounceMs?: number | (() => number);
	/** Mínimo de caracteres (após trim) para disparar a busca. */
	minChars?: number | (() => number);
	/** Quando definida, vira `erro` se a busca concluir sem resultados. */
	mensagemVazia?: string;
}) {
	const resolver = (v: number | (() => number) | undefined, padrao: number) =>
		typeof v === 'function' ? v() : (v ?? padrao);

	let resultados = $state<T[]>([]);
	let buscando = $state(false);
	let erro = $state('');
	let buscou = $state(false);

	let timer: ReturnType<typeof setTimeout> | null = null;
	let controller: AbortController | null = null;

	/** Interrompe timer e requisição em voo sem mexer nos resultados. */
	function cancelar() {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		controller?.abort();
		controller = null;
		buscando = false;
	}

	/** Cancela e zera resultados/erro (fechar diálogo, trocar seleção...). */
	function limpar() {
		cancelar();
		resultados = [];
		erro = '';
		buscou = false;
	}

	function buscar(termo: string) {
		if (timer) clearTimeout(timer);
		controller?.abort();
		if (termo.trim().length < resolver(opts.minChars, 1)) {
			limpar();
			return;
		}
		// Feedback imediato enquanto digita — sem isto o spinner só aparece
		// após debounce + rede e, em conexão lenta, parece que nada acontece.
		buscando = true;
		erro = '';
		timer = setTimeout(
			async () => {
				const c = new AbortController();
				controller = c;
				try {
					const r = await opts.buscar(termo, c.signal);
					if (c.signal.aborted) return; // substituída por busca mais nova
					resultados = r;
					buscou = true;
					if (r.length === 0 && opts.mensagemVazia) erro = opts.mensagemVazia;
				} catch (e: unknown) {
					if (c.signal.aborted) return;
					resultados = [];
					buscou = true;
					erro = e instanceof Error ? e.message : 'Erro na busca';
				} finally {
					if (!c.signal.aborted) buscando = false;
				}
			},
			resolver(opts.debounceMs, 300)
		);
	}

	// Aborta timer/requisição quando o componente dono do hook é destruído.
	$effect(() => cancelar);

	return {
		get resultados() {
			return resultados;
		},
		set resultados(v: T[]) {
			resultados = v;
		},
		get buscando() {
			return buscando;
		},
		get erro() {
			return erro;
		},
		set erro(v: string) {
			erro = v;
		},
		get buscou() {
			return buscou;
		},
		buscar,
		limpar,
		cancelar
	};
}
