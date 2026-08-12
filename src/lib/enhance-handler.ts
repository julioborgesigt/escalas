/**
 * Tratamento do resultado de um form action do SvelteKit no cliente.
 *
 * Dois níveis, porque os dois domínios pedem coisas diferentes:
 *
 * - `makeEnhanceHandler` — a fábrica COMPLETA de `SubmitFunction` (flag de
 *   progresso + invalidação + toast + callbacks), usada pela página de GISE,
 *   onde ~30 actions seguem exatamente o mesmo roteiro;
 * - `mostrarErroDeResultado` — só o ramo de ERRO. É o que serve ao domínio de
 *   escalas, onde cada handler faz uma atualização otimista própria no sucesso
 *   (aplicar a lista devolvida, limpar seleção, fechar modal) e portanto não
 *   cabe na fábrica, mas trata a falha de forma idêntica.
 */

import { invalidateShared } from '$lib/cross-tab-invalidate';
import { toaster } from '$lib/toast';
import type { ActionResult, SubmitFunction } from '@sveltejs/kit';

/**
 * Toast de erro para um `ActionResult` que não é `success`.
 *
 * Distingue os dois motivos, que não são a mesma coisa para quem está na tela:
 * `error` é falha de REDE/exceção não tratada — não adianta mostrar detalhe
 * técnico, o usuário precisa é tentar de novo; `failure` é recusa do servidor,
 * e aí a mensagem dele (`data.error`) é a informação útil. `fallback` só entra
 * quando a action falhou sem dizer por quê.
 *
 * Estava copiado em 11 handlers de escalas/perfil/solicitações, cada um com sua
 * versão do `as Record<string, unknown>`.
 */
export function mostrarErroDeResultado(result: ActionResult, fallback: string): void {
	if (result.type === 'error') {
		toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
		return;
	}
	const d =
		result.type === 'failure' ? (result.data as Record<string, unknown> | undefined) : undefined;
	toaster.create({ title: String(d?.error || fallback), type: 'error' });
}

type ResultData = Record<string, unknown>;

interface MakeEnhanceHandlerOptions<D extends ResultData = ResultData> {
	/** Setter do flag de progresso (geralmente `pendingCrud`). Chamado com `true` antes do submit e `false` ao final. */
	setPending: (pending: boolean) => void;
	/** Validação pré-submit. Retornar `false` aborta o submit. */
	beforeSubmit?: () => boolean;
	/** Chave(s) passadas para `invalidateShared`. `false` desliga. Default: detalhe + lista GISE. */
	invalidateKey?: string | string[] | false;
	/** Título do toast de sucesso. Pode depender do `result.data`. Se omitido ou retornar `null`, nenhum toast é mostrado. */
	successTitle?: string | ((data: D) => string | null | undefined);
	/** Descrição opcional do toast de sucesso. */
	successDescription?: string | ((data: D) => string | undefined);
	/** Título fallback do toast de erro quando `result.data.error` não existe. */
	errorTitle?: string;
	/** Callback executado após sucesso (antes do toast e depois da invalidação). Útil para fechar modais, limpar selects, navegar. */
	onSuccess?: (data: D) => void | Promise<void>;
	/** Callback executado após falha. */
	onError?: (data: ResultData | undefined) => void | Promise<void>;
}

/**
 * Fábrica de `SubmitFunction` para o domínio GISE, onde ~30 actions seguem o
 * mesmo roteiro (flag de progresso + invalidação + toast + callbacks).
 *
 * Não serve ao domínio de escalas: lá cada handler faz atualização otimista
 * própria no sucesso. Para só o ramo de erro, use `mostrarErroDeResultado`.
 */
export function makeEnhanceHandler<D extends ResultData = ResultData>(
	options: MakeEnhanceHandlerOptions<D>
): SubmitFunction {
	const {
		setPending,
		beforeSubmit,
		invalidateKey = ['gise:detail', 'app:gise-list'],
		successTitle,
		successDescription,
		errorTitle = 'Erro',
		onSuccess,
		onError
	} = options;

	return (input) => {
		if (beforeSubmit && !beforeSubmit()) {
			input.cancel();
			return;
		}
		setPending(true);
		return async ({ result }) => {
			try {
				if (result.type === 'success') {
					const data = (result.data ?? {}) as D;
					if (invalidateKey !== false) {
						const keys = Array.isArray(invalidateKey) ? invalidateKey : [invalidateKey];
						await invalidateShared(...keys);
					}
					await onSuccess?.(data);
					const title = typeof successTitle === 'function' ? successTitle(data) : successTitle;
					if (title) {
						const description =
							typeof successDescription === 'function'
								? successDescription(data)
								: successDescription;
						toaster.success({
							title,
							...(description ? { description } : {})
						});
					}
				} else {
					const d = 'data' in result ? (result.data as ResultData | undefined) : undefined;
					toaster.error({ title: (d?.error as string) || errorTitle });
					await onError?.(d);
				}
			} finally {
				setPending(false);
			}
		};
	};
}
