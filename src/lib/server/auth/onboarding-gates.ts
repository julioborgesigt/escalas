/**
 * Allowlists do onboarding usadas pelo `hooks.server.ts`.
 *
 * Extraídas do Handle para a regra ser testável sem montar o middleware: o
 * `primeiro_acesso` e o Termo de Uso recusam o resto da API, e um prefixo
 * largo (`/api/auth/*`) já liberou o que não deveria (assinatura, troca de
 * modo) e bloqueou o que o onboarding precisa (verificar e-mail pessoal).
 *
 * O match é com delimitador — `startsWith('/api/auth/logout')` sem isso
 * liberaria uma rota futura `/api/auth/logout-tudo`.
 */

/** `/login` cobre `/login` e `/login/...`, mas não `/loginXyz`. */
export function pathnameNoEscopo(pathname: string, rota: string): boolean {
	return pathname === rota || pathname.startsWith(rota + '/');
}

const LIVRES_PRIMEIRO_ACESSO = [
	'/alterar-senha',
	'/api/auth/logout',
	// O form de `/alterar-senha` exige e-mail pessoal verificado ANTES de
	// gravar a senha nova. Sem estas duas, o gate FLW-AUT-019 trava o
	// onboarding: a tela pede o OTP e a API responde 403 (SEC-01).
	'/api/auth/solicitar-verificacao-email-pessoal',
	'/api/auth/confirmar-verificacao-email-pessoal'
] as const;

const LIVRES_TERMO = [
	'/aceitar-termo',
	// Primeiro acesso resolve a senha antes do termo; sem isto, loop
	// /alterar-senha ⇄ /aceitar-termo.
	'/alterar-senha',
	'/termo',
	'/api/termos',
	'/api/auth/logout'
] as const;

/** Rotas que um usuário em `primeiro_acesso` ainda pode alcançar. */
export function pathnameLivreEmPrimeiroAcesso(pathname: string): boolean {
	return LIVRES_PRIMEIRO_ACESSO.some((rota) => pathnameNoEscopo(pathname, rota));
}

/**
 * Rotas que um usuário autenticado sem aceite do Termo vigente ainda pode
 * alcançar. Não inclui o prefixo `/api/auth/` inteiro: depois da senha
 * definida, `alternar-acesso` / códigos de assinatura não são onboarding
 * (SEC-05).
 */
export function pathnameLivreDoTermo(pathname: string): boolean {
	return LIVRES_TERMO.some((rota) => pathnameNoEscopo(pathname, rota));
}
