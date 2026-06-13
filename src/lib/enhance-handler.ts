/**
 * Fábrica para construir `SubmitFunction`s de `use:enhance` seguindo o padrão
 *   - marca um flag de "em progresso" no início
 *   - invalida dependências ao sucesso
 *   - mostra toast de sucesso/erro
 *   - executa callback de reset/side-effect ao sucesso
 * Evita repetir ~30 vezes a mesma boilerplate na página de GISE.
 */

import { invalidate } from '$app/navigation';
import { toaster } from '$lib/toast';
import type { SubmitFunction } from '@sveltejs/kit';

type ResultData = Record<string, unknown>;

interface MakeEnhanceHandlerOptions<D extends ResultData = ResultData> {
	/** Setter do flag de progresso (geralmente `pendingCrud`). Chamado com `true` antes do submit e `false` ao final. */
	setPending: (pending: boolean) => void;
	/** Validação pré-submit. Retornar `false` aborta o submit. */
	beforeSubmit?: () => boolean;
	/** Chave passada para `invalidate`. `false` desliga a invalidação. Default: `'gise:detail'`. */
	invalidateKey?: string | false;
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

export function makeEnhanceHandler<D extends ResultData = ResultData>(
	options: MakeEnhanceHandlerOptions<D>
): SubmitFunction {
	const {
		setPending,
		beforeSubmit,
		invalidateKey = 'gise:detail',
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
						await invalidate(invalidateKey);
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
