/**
 * CSRF protection via double-submit cookie pattern.
 *
 * For state-changing API requests (POST/PUT/PATCH/DELETE), the client must send
 * the value of the `__csrf` cookie back in the `x-csrf-token` header.
 * Because a cross-origin attacker cannot read the cookie value (SameSite=Lax),
 * this proves the request originated from our own frontend.
 */

import { gerarTokenOpaco } from '$lib/crypto/token';

export { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../../csrf';

/** Generate a cryptographically random CSRF token (hex string). */
export const generateCsrfToken = gerarTokenOpaco;
