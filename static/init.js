/**
 * Boot script: roda síncrono no <head> antes da hidratação.
 *
 * Antes morava em <script> inline em app.html, o que exigia
 * `script-src 'unsafe-inline'` no CSP. Movido para um arquivo estático
 * (servido por `'self'`) para podermos remover o `unsafe-inline` global.
 *
 * Faz duas coisas:
 *  1. Define a classe `.dark` em <html> conforme tema preferido (evita FOUC).
 *  2. Promove `<link rel="preload" as="style" data-font-preload>` para
 *     `<link rel="stylesheet">` quando o CSS chega — truque non-blocking
 *     que substitui o antigo `onload="this.rel='stylesheet'"` inline.
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

	var links = document.querySelectorAll('link[data-font-preload]');
	for (var i = 0; i < links.length; i++) {
		var link = links[i];
		if (link.rel !== 'preload') continue;
		// Se o CSS já chegou (cache hit), promove imediatamente.
		// Caso contrário, espera o evento `load` e promove no callback.
		if (link.sheet) {
			link.rel = 'stylesheet';
		} else {
			link.addEventListener(
				'load',
				(function (l) {
					return function () {
						l.rel = 'stylesheet';
					};
				})(link),
				{ once: true }
			);
		}
	}
})();
