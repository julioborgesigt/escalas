/**
 * Gera uma senha provisória de 12 caracteres (~62 bits de entropia) usando
 * `crypto.getRandomValues`. Alfabeto de 31 símbolos: evita caracteres ambíguos
 * (`0`, `O`, `1`, `I`, `L`) para reduzir erros de digitação ao copiar do e-mail.
 *
 * Fonte única — importado por `/api/auth/primeiro-acesso` e pela action
 * `solicitarPrimeiroAcesso` do formulário de login. Manter aqui evita divergência
 * de entropia entre os dois caminhos.
 */
export function gerarSenhaProvisoria(): string {
	const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('');
}
