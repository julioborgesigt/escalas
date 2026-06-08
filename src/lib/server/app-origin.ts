/**
 * Resolve a origem canônica para montar links de e-mail (redefinição de senha,
 * primeiro acesso).
 *
 * Por padrão usa `url.origin` da requisição — que deriva do header `Host`. No
 * Cloudflare Pages o Host é validado pelo roteamento, então isso é seguro na
 * prática; ainda assim, definir `APP_ORIGIN` no ambiente fixa a origem e fecha,
 * em camadas, qualquer host-header injection (link de reset apontando para
 * domínio do atacante).
 */
export function resolverAppOrigin(
	requestUrl: URL,
	platform: App.Platform | undefined
): string {
	const env = platform?.env as Record<string, string | undefined> | undefined;
	const configurada = env?.APP_ORIGIN?.trim();
	if (configurada) {
		try {
			const u = new URL(configurada);
			if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
		} catch {
			// APP_ORIGIN malformada — ignora e cai no fallback de `url.origin`.
		}
	}
	return requestUrl.origin;
}
