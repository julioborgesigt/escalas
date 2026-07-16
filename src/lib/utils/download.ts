/**
 * Helpers de download no navegador (client-only).
 *
 * Implementação ÚNICA do padrão "blob → âncora → click": os call sites
 * repetiam este bloco com pequenas variações e dois deles esqueciam o
 * `revokeObjectURL`, vazando o blob na memória até o unload da página.
 */

/** Dispara o download de um Blob e revoga o object URL ao final. */
export function baixarBlob(blob: Blob, nome: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = nome;
	a.rel = 'noopener';
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

/**
 * Extrai o filename de um header `Content-Disposition`, com suporte a
 * `filename*=UTF-8''…` (RFC 5987) e fallback quando o header falta ou é
 * malformado.
 */
export function nomeArquivoContentDisposition(cd: string | null, fallback: string): string {
	if (!cd) return fallback;
	const mStar = /filename\*=UTF-8''([^;\s]+)/i.exec(cd);
	if (mStar) {
		try {
			return decodeURIComponent(mStar[1].replace(/\+/g, ' '));
		} catch {
			return fallback;
		}
	}
	const m = /filename="([^"]+)"/i.exec(cd);
	if (m?.[1]) return m[1];
	return fallback;
}
