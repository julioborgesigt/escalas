/**
 * Invalidação compartilhada entre abas do mesmo browser (BroadcastChannel)
 * e wrappers que invalidam + notificam as demais abas.
 *
 * Não é push multi-usuário: só sincroniza abas da mesma origem no mesmo
 * navegador. O poll/`visibilitychange` de `useInvalidateOnFocus` cobre o
 * restante (outra sessão / outro aparelho).
 */
import { browser } from '$app/environment';
import { invalidate, invalidateAll } from '$app/navigation';

const CHANNEL = 'escalas:invalidate';

type Mensagem = { chaves: string[] };

/** Canal único por aba — evita open/close a cada notify/subscribe. */
let canalSingleton: BroadcastChannel | null | undefined;

function canal(): BroadcastChannel | null {
	if (!browser || typeof BroadcastChannel === 'undefined') return null;
	if (canalSingleton !== undefined) return canalSingleton;
	try {
		canalSingleton = new BroadcastChannel(CHANNEL);
	} catch {
		canalSingleton = null;
	}
	return canalSingleton;
}

/** Avisa outras abas que estas chaves de `depends(...)` ficaram stale. */
function notifyInvalidate(...chaves: string[]) {
	if (chaves.length === 0) return;
	const ch = canal();
	if (!ch) return;
	const msg: Mensagem = { chaves };
	ch.postMessage(msg);
}

/** Equivalente a `notifyInvalidate('*')` — listeners invalidam a própria chave. */
function notifyInvalidateAll() {
	notifyInvalidate('*');
}

/** Invalida uma ou mais chaves de `depends(...)` e notifica as outras abas. */
export async function invalidateShared(...chaves: string[]) {
	if (chaves.length === 0) return;
	await Promise.all(chaves.map((c) => invalidate(c)));
	notifyInvalidate(...chaves);
}

export async function invalidateAllShared() {
	await invalidateAll();
	notifyInvalidateAll();
}

/**
 * Escuta notificações de outras abas. `interesse` é a chave local (ex.
 * `'gise:detail'`); `'*'` na mensagem faz match com qualquer interesse.
 */
export function subscribeInvalidate(interesse: string, onMatch: () => void): () => void {
	const ch = canal();
	if (!ch) return () => {};

	function handler(ev: MessageEvent<Mensagem>) {
		const chaves = ev.data?.chaves;
		if (!Array.isArray(chaves)) return;
		if (chaves.includes('*') || chaves.includes(interesse)) onMatch();
	}

	ch.addEventListener('message', handler);
	return () => {
		ch.removeEventListener('message', handler);
	};
}
