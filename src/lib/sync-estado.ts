/**
 * Cliente do endpoint leve `/api/sync/estado` — usado pelo poll de
 * `useInvalidateOnFocus` para só invalidar o `load` quando o carimbo muda.
 */
import { apiFetch } from '$lib/api-fetch';

export type SyncEstado = {
	recebidos?: { stamp: string; naoVistos: number };
	escalas?: { stamp: string; pendentes: number };
	gise?: { stamp: string };
	giseList?: { stamp: string };
	painel?: { stamp: string };
	resGise?: { stamp: string };
	escala?: { stamp: string };
};

export async function fetchSyncEstado(opts?: {
	giseId?: number;
	escalaId?: number;
}): Promise<SyncEstado> {
	const q = new URLSearchParams();
	if (opts?.giseId) q.set('giseId', String(opts.giseId));
	if (opts?.escalaId) q.set('escalaId', String(opts.escalaId));
	const qs = q.toString();
	return apiFetch<SyncEstado>(`/api/sync/estado${qs ? `?${qs}` : ''}`);
}
