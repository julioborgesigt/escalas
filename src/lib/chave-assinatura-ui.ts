/**
 * Disponibilidade da assinatura avançada em tela quando a administração
 * exige a chave. Sem chave, o titular lê; o botão não é oferecido.
 *
 * Puro de propósito: o layout já resolveu `temChaveAssinatura` no servidor.
 * A UI só decide se mostra o controle.
 */
export function avancadaEmTelaDisponivel(exigirPasskey: boolean, temChave: boolean): boolean {
	return !exigirPasskey || temChave;
}

/** Lê as flags que o `load` do layout já resolveu — evita repetir o Boolean. */
export function avancadaEmTelaDoLayout(data: {
	exigirPasskeyAssinatura?: boolean;
	temChaveAssinatura?: boolean;
}): boolean {
	return avancadaEmTelaDisponivel(
		Boolean(data.exigirPasskeyAssinatura),
		Boolean(data.temChaveAssinatura)
	);
}

/**
 * Recado quando a avançada em tela não é oferecida. Celular: cadastrar.
 * Desktop: A3 permanece. Nunca afirma "dispositivo registrado".
 */
export function mensagemConviteChave(isMobile: boolean): string {
	if (isMobile) {
		return (
			'Cadastre a chave de assinatura no celular para assinar em tela. ' +
			'Cadastrar de novo substitui a chave anterior.'
		);
	}
	return 'A assinatura avançada em tela é no celular. Neste computador, use o Token A3.';
}
