/**
 * O que uma sessão de COLABORADOR alcança — lista FECHADA, conferida no
 * `hooks.server.ts` antes de qualquer rota rodar.
 *
 * A terceira identidade falha fechado por construção nos ~160 pontos que
 * perguntam `tipo === 'admin'` ou `tipo === 'policial'`. Mas há rotas que só
 * exigem SESSÃO (`requireAuth`, `if (!locals.usuario)`) e mostrariam a um
 * colaborador a tela de um policial sem papel — a lista de escalas, o perfil,
 * o painel de presença. Em vez de revisar cada uma, o portão inverte a regra:
 * colaborador entra SÓ no que está aqui; todo o resto responde 403 (API) ou
 * volta para a área dele.
 *
 * Acrescentar rota aqui é decisão de acesso, não conveniência: é o único
 * lugar em que o alcance do colaborador cresce. O módulo de diárias vai
 * ampliar esta lista com as telas das funções designadas (protocolo, analista).
 */
import { pathnameNoEscopo } from './onboarding-gates';

const ROTAS_DO_COLABORADOR = [
	// A área dele: boas-vindas (hoje, uma tela vazia — plano, seção 12).
	'/colaborador',
	// Onboarding e higiene de conta — os mesmos portões dos demais.
	'/alterar-senha',
	'/aceitar-termo',
	'/termo',
	'/api/termos',
	'/api/auth/logout'
] as const;

/** `true` quando a rota está na lista fechada do colaborador. */
export function colaboradorPodeAcessarRota(pathname: string): boolean {
	return ROTAS_DO_COLABORADOR.some((rota) => pathnameNoEscopo(pathname, rota));
}
