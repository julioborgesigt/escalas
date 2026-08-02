/**
 * Cliente do endpoint leve `/api/sync/estado` — usado pelo poll de
 * `useInvalidateOnFocus` para só invalidar o `load` quando o carimbo muda.
 */
import { apiFetch } from '$lib/api-fetch';

export type SyncEstado = {
	recebidos?: { stamp: string; naoVistos: number };
	escalas?: { stamp: string; pendentes: number };
	gise?: { stamp: string };
	painel?: { stamp: string };
};

export async function fetchSyncEstado(opts?: { giseId?: number }): Promise<SyncEstado> {
	const q = opts?.giseId ? `?giseId=${opts.giseId}` : '';
	return apiFetch<SyncEstado>(`/api/sync/estado${q}`);
}
