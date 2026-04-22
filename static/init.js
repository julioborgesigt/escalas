/**
 * Boot script: roda síncrono no <head> antes da hidratação.
 *
 * Antes morava em <script> inline em app.html, o que exigia
 * `script-src 'unsafe-inline'` no CSP. Movido para um arquivo estático
 * (servido por `'self'`) para podermos remover o `unsafe-inline` global.
 *
 * Define a classe `.dark` em <html> conforme tema preferido (evita FOUC).
 */
(function () {
	try {
		var stored = localStorage.getItem('color-theme');
		var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		if (stored === 'light' || (!stored && !prefersDark)) {
			document.documentElement.classList.remove('dark');
		} else {
			document.documentElement.classList.add('dark');
		}
	} catch (_) {
		// localStorage pode estar bloqueado (modo privado, sandbox, etc.)
	}
})();
