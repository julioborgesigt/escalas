/**
 * Geração de token opaco — o valor que É a credencial.
 *
 * 32 bytes de CSPRNG em hex (64 chars). Serve à sessão, ao link de redefinição,
 * ao id de desafio 2FA, ao nonce do login por certificado e ao cookie CSRF.
 *
 * `crypto.getRandomValues`, nunca `Math.random`: quem adivinha o token entra sem
 * senha e sem 2FA. 256 bits tornam a busca inviável. O comprimento hex fixo
 * também é o que permite distinguir um token legado em claro de um `sha256:` no
 * banco (ver `hashTokenArmazenado` em `$lib/auth`).
 *
 * Estava duplicado byte a byte entre `$lib/auth` (sessão/2FA/reset) e
 * `server/auth/csrf` (cookie CSRF) — duas cópias de uma função de quatro linhas
 * que decide a força de todas as credenciais do sistema.
 */
import { bytesToHex } from './hex';

/** Token opaco de 32 bytes (64 hex chars). */
export function gerarTokenOpaco(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return bytesToHex(bytes);
}
