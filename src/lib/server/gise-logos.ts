/**
 * Carrega os dois logos institucionais GISE do R2 (best-effort):
 *  - `assets/logogise.jpg`  → canto superior esquerdo
 *  - `assets/logo_ceara.jpg` → canto superior direito
 *
 * Usado pelo PDF GISE e pelos relatórios de serviço extraordinário, nos
 * caminhos de assinatura, download e cópia de conferência.
 */

import { getR2 } from '$lib/server/platform';

async function carregar(
	platform: App.Platform | undefined,
	key: string
): Promise<Uint8Array | undefined> {
	try {
		const r2 = getR2(platform);
		if (!r2) return undefined;
		const obj = await r2.get(key);
		if (!obj) return undefined;
		return new Uint8Array(await obj.arrayBuffer());
	} catch {
		return undefined;
	}
}

export async function carregarLogosGise(
	platform: App.Platform | undefined
): Promise<{ esq?: Uint8Array; dir?: Uint8Array }> {
	const [esq, dir] = await Promise.all([
		carregar(platform, 'assets/logogise.jpg'),
		carregar(platform, 'assets/logo_ceara.jpg')
	]);
	return { esq, dir };
}
