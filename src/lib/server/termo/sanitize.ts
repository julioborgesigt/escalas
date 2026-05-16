/**
 * Sanitizador server-side para o HTML do termo de uso.
 *
 * O conteúdo é versionado em código (`termo-vigente.ts`) — assumimos que
 * passa por code review. Esta função é defesa em camadas: mesmo que um
 * commit malicioso (ou typo) introduza tags perigosas, elas são removidas
 * antes de chegar ao `{@html}` do cliente.
 *
 * Limitações:
 * - Regex-based, intencionalmente conservador. Aceita apenas a whitelist
 *   de tags/atributos abaixo. Qualquer construção fora dela é removida.
 * - Não substitui um parser HTML completo (a runtime do Cloudflare Workers
 *   não suporta jsdom/DOMPurify de forma trivial), mas cobre os vetores
 *   citados na auditoria: <script>, <style>, <iframe>, on*=, javascript:.
 */

/** Tags permitidas no termo. */
const ALLOWED_TAGS = new Set([
	'h2', 'h3', 'h4',
	'p', 'br',
	'ul', 'ol', 'li',
	'strong', 'em', 'b', 'i', 'u',
	'code',
	'a',
	'span', 'div'
]);

/** Atributos permitidos por tag. `href` em `<a>` é validado adicionalmente. */
const ALLOWED_ATTRS: Record<string, ReadonlySet<string>> = {
	a: new Set(['href', 'title']),
	p: new Set(['class']),
	span: new Set(['class']),
	div: new Set(['class']),
	code: new Set(['class']),
	ul: new Set(['class']),
	li: new Set(['class'])
};

/** Schemes seguros para href. Bloqueia javascript:, data:, vbscript:, file:, etc. */
const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#)/i;

/**
 * Sanitiza o HTML do termo. Retorna string segura para `{@html}`.
 *
 * Estratégia:
 *  1. Remove blocos inteiros de tags perigosas (com conteúdo).
 *  2. Para cada tag remanescente, valida nome e atributos.
 *  3. Strip de eventos inline (on*=), de URIs perigosas e de quaisquer
 *     atributos fora da allowlist.
 */
export function sanitizeTermoHtml(input: string): string {
	// 1. Remove blocos perigosos COM conteúdo (caso o atacante feche corretamente)
	const dangerousBlocks = /<(script|style|iframe|object|embed|svg|math|form|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
	let html = input.replace(dangerousBlocks, '');

	// 2. Remove tags perigosas sem fechamento ou self-closing
	const dangerousVoid = /<\/?(script|style|iframe|object|embed|link|meta|base|svg|math|form|input|button|textarea|select|template|noscript)\b[^>]*\/?>/gi;
	html = html.replace(dangerousVoid, '');

	// 3. Processa cada tag remanescente individualmente
	html = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)\/?>/g, (match, rawTag: string, rawAttrs: string) => {
		const tag = rawTag.toLowerCase();
		if (!ALLOWED_TAGS.has(tag)) return '';

		// Tag de fechamento — emite sem atributos
		if (match.startsWith('</')) return `</${tag}>`;

		const allowed = ALLOWED_ATTRS[tag] ?? new Set<string>();
		const safeAttrs: string[] = [];

		// 3a. Itera sobre cada atributo (suporta valor entre aspas duplas, simples ou sem aspas)
		const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
		let attrMatch: RegExpExecArray | null;
		while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
			const name = attrMatch[1].toLowerCase();
			const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';

			// Bloqueia event handlers (onclick, onload, onerror, ...)
			if (name.startsWith('on')) continue;
			// Bloqueia atributos fora da allowlist desta tag
			if (!allowed.has(name)) continue;

			// Validação extra para href
			if (name === 'href') {
				if (!SAFE_HREF.test(value)) continue;
			}

			// Re-escape de aspas e <
			const escaped = value
				.replace(/&/g, '&amp;')
				.replace(/"/g, '&quot;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;');
			safeAttrs.push(`${name}="${escaped}"`);
		}

		const attrStr = safeAttrs.length > 0 ? ' ' + safeAttrs.join(' ') : '';
		const selfClosing = match.endsWith('/>') || tag === 'br';
		return selfClosing ? `<${tag}${attrStr} />` : `<${tag}${attrStr}>`;
	});

	return html;
}
