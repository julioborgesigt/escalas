/**
 * Content-Security-Policy por tipo de resposta.
 * Em desenvolvimento (HTML), retorna null — extensões de browser podem
 * modificar o header CSP e quebrar a hidratação do SvelteKit.
 */
export function buildCSP(
	isHTML: boolean,
	options: { isProduction: boolean }
): string | null {
	if (!isHTML) {
		return "default-src 'none'; base-uri 'none'; form-action 'none'";
	}

	if (!options.isProduction) {
		return null;
	}

	const connectExtra = '';

	const serproWS = [
		'wss://assinador-desktop.serpro.gov.br:65166',
		'wss://assinador-desktop.serpro.gov.br:65156',
		'wss://assinador-desktop.serpro.gov.br:65500',
		'wss://127.0.0.1:65166',
		'wss://127.0.0.1:65156',
		'wss://127.0.0.1:65500',
		'ws://127.0.0.1:65166',
		'ws://127.0.0.1:65156',
		'ws://127.0.0.1:65500'
	].join(' ');

	return [
		`default-src 'self'`,
		`script-src 'self' 'unsafe-inline'`,
		`style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
		`img-src 'self' data: blob: https://fonts.gstatic.com`,
		`font-src 'self' data: https://fonts.gstatic.com`,
		`connect-src 'self' ${serproWS}${connectExtra} https://cdn.jsdelivr.net`,
		`frame-src 'none'`,
		`object-src 'none'`,
		`base-uri 'self'`,
		`form-action 'self'`,
		`upgrade-insecure-requests`,
		`block-all-mixed-content`
	].join('; ');
}
