import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestCtx {
	requestId: string;
	userId: string;
	path: string;
}

export const requestStore = new AsyncLocalStorage<RequestCtx>();

/** Retorna o contexto da requisição atual, ou undefined fora de uma requisição. */
export const getRequestCtx = () => requestStore.getStore();
