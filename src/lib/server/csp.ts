/**
 * Content-Security-Policy aplicada manualmente em respostas **não-HTML**
 * (`/api/...`, downloads, etc.) via `hooks.server.ts`.
 *
 * Para respostas HTML, a CSP é gerenciada nativamente pelo SvelteKit a partir
 * de `kit.csp` em `svelte.config.js`. Isso permite que o framework adicione
 * automaticamente nonces aos inline scripts que ele emite na hidratação,
 * tornando possível remover `'unsafe-inline'` de `script-src` (defesa anti-XSS).
 */
export function buildCSP(
	isHTML: boolean,
	_options: { isProduction: boolean }
): string | null {
	if (isHTML) {
		// HTML é tratado pelo SvelteKit; não setamos manualmente para evitar
		// sobrescrever os nonces que ele injeta automaticamente.
		return null;
	}
	return "default-src 'none'; base-uri 'none'; form-action 'none'";
}
