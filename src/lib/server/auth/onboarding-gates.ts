/**
 * Allowlists do onboarding usadas pelo `hooks.server.ts`.
 *
 * Extraídas do Handle para a regra ser testável sem montar o middleware: o
 * `primeiro_acesso` e o Termo de Uso recusam o resto da API, e um prefixo
 * largo (`/api/auth/*`) já liberou o que não deveria (assinatura, troca de
 * modo) e bloqueou o que o onboarding precisa (verificar e-mail pessoal).
 *
 * A ORDEM dos dois portões é fase, não empilhamento: `primeiro_acesso`
 * primeiro (senha + e-mail pessoal), Termo depois. `impoeAceiteDoTermo` é
 * quem escreve isso.
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
	// Troca VOLUNTÁRIA de senha com um termo novo pendente: sem isto, loop
	// /alterar-senha ⇄ /aceitar-termo. O primeiro acesso não depende desta
	// linha — ele nem chega ao portão do termo (ver `impoeAceiteDoTermo`).
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

/**
 * O aceite do Termo deve ser IMPOSTO nesta requisição?
 *
 * Os dois portões do onboarding são FASES, não filtros simultâneos: enquanto
 * `primeiro_acesso` está pendente ele já reduziu a superfície alcançável a
 * `LIVRES_PRIMEIRO_ACESSO` — quatro rotas, todas de onboarding —, e o Termo
 * não tem o que acrescentar ali. Aceitar vem DEPOIS de definir a senha e
 * confirmar o e-mail pessoal.
 *
 * Impor os dois ao mesmo tempo travava a fase 1 e essa era a forma do bug: a
 * tela `/alterar-senha` estava livre do termo, mas as DUAS APIs que ela chama
 * para o OTP do e-mail pessoal não estavam. Quem abria o primeiro acesso via a
 * tela normalmente e, ao clicar em "Enviar código", recebia
 * "Aceite o Termo de Uso vigente antes de continuar" — um aceite que nem
 * naquela tela nem em `/aceitar-termo` ele conseguia dar, porque o portão de
 * `primeiro_acesso` roda ANTES e devolve todo mundo para `/alterar-senha`.
 *
 * Casar a lista por rota resolveria o sintoma e deixaria a armadilha de pé
 * para a próxima rota de onboarding. A fase é a regra.
 */
export function impoeAceiteDoTermo(pathname: string, primeiroAcessoPendente: boolean): boolean {
	if (primeiroAcessoPendente) return false;
	return !pathnameLivreDoTermo(pathname);
}
