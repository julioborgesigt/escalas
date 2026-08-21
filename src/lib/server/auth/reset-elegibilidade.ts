/**
 * Quem pode se autoatender no reset de senha por e-mail pessoal.
 *
 * O reset manda um OTP para `email_pessoal` e, com ele confirmado, entrega um
 * link que redefine a senha. O OTP prova **controle da caixa** — só isso. Não
 * prova que o titular vinculou aquele endereço de propósito, e os dois não são
 * a mesma coisa: `email_pessoal` pode ter sido digitado errado no cadastro ou
 * gravado por quem administra a ficha. Sem esta checagem, o primeiro reset
 * transformava um endereço nunca confirmado em endereço **verificado** com
 * poder de redefinir a senha daquele policial (SEC-29).
 *
 * O ato de vincular tem caminho próprio e exige sessão:
 * `/api/auth/solicitar-verificacao-email-pessoal` + `confirmar-…` (as duas
 * rotas que o SEC-01 desbloqueou no primeiro acesso). Quem nunca passou por
 * lá não tem autoatendimento de reset — precisa verificar o e-mail logado, ou
 * de um admin.
 *
 * As DUAS rotas do fluxo perguntam a esta função. `solicitar-redefinicao` é
 * quem recusa cedo; `confirmar-redefinicao` repete porque um desafio criado
 * antes desta regra ainda estaria vivo, e porque gate de reset em cópia única
 * é o que a auditoria de ago/2026 achou repetido em cinco rotas de assinatura.
 */

/** Campos que as duas rotas do reset já carregam. */
export type UsuarioElegibilidadeReset = {
	email_pessoal: string | null;
	email_pessoal_verificado: number;
};

/**
 * `true` só quando há e-mail pessoal **e** ele foi verificado pelo titular.
 *
 * Chamador recusa com a resposta genérica de anti-enumeração — nunca com uma
 * mensagem que distinga "não verificado" de "não existe", senão a rota vira
 * oráculo de quais matrículas têm o quê.
 *
 * É **type guard** de propósito: estreita `usuario` para não-nulo e
 * `email_pessoal` para `string`, então as duas rotas param de repetir
 * `!usuario || !usuario.email_pessoal` e de carregar `!` no acesso ao endereço.
 * O compilador passa a exigir que a checagem venha ANTES do uso.
 */
export function podeAutoatenderResetSenha<T extends UsuarioElegibilidadeReset>(
	u: T | null
): u is T & { email_pessoal: string } {
	return !!u && !!u.email_pessoal && u.email_pessoal_verificado === 1;
}
