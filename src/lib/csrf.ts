/**
 * Client-side CSRF helpers.
 *
 * Reads the double-submit CSRF cookie and builds the header object
 * that must be included in every state-changing fetch() to /api/*.
 */

export const CSRF_COOKIE_NAME = '__csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

/** Read the CSRF token from the cookie set by the server. */
export function getCsrfToken(): string {
	if (typeof document === 'undefined') return '';
	const match = document.cookie
		.split('; ')
		.find((row) => row.startsWith(`${CSRF_COOKIE_NAME}=`));
	return match ? match.slice(match.indexOf('=') + 1) : '';
}

/** Return a headers object containing the CSRF token, ready to spread into fetch options. */
export function csrfHeaders(): Record<string, string> {
	const token = getCsrfToken();
	return token ? { [CSRF_HEADER_NAME]: token } : {};
}
