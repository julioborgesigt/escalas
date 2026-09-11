/**
 * Senha PROVISÓRIA do colaborador — gerada pelo servidor, mostrada UMA vez ao
 * Super Admin, que a repassa à pessoa. No primeiro login o colaborador passa
 * pelo 2FA por e-mail e é obrigado a trocá-la (`primeiro_acesso = 1`).
 *
 * Por que gerada, e não digitada: senha escolhida pelo administrador para
 * outra pessoa vira senha fraca e reutilizada ("Mudar123"). Por que mostrada
 * em vez de enviada por e-mail: o fluxo de link por e-mail é o de policial e
 * admin (`redefinir-senha`, tabela de tokens com tipo), e estendê-lo é mais
 * superfície do que o caso pede — meia dúzia de contas, criadas presencialmente.
 *
 * CSPRNG e alfabeto de 32 símbolos sem O/0/I/1 — a mesma técnica de
 * `gerarCodigoValidacao`: `byte % 32` é uniforme porque 256 % 32 === 0. Doze
 * símbolos são 60 bits, muito além do que o throttle por conta deixa tentar.
 */

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TAMANHO = 12;

/** Ex.: `"K7QW-3RTX-9MHB"` — grupos de quatro para ditar por telefone. */
export function gerarSenhaProvisoria(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(TAMANHO));
	const s = Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
	return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
