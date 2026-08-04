/**
 * Comparação de segredos em tempo ~constante.
 *
 * Toda comparação de credencial passa por aqui: senha de bootstrap, token de
 * sessão, token de redefinição, código 2FA, hash de senha, Bearer de webhook.
 * Um `===` comum devolve mais cedo no primeiro byte diferente, e essa diferença
 * de tempo, medida em muitas tentativas, revela o segredo caractere a caractere.
 *
 * Existiam QUATRO implementações disso, cada uma com seu preenchimento
 * (`Buffer.alloc` do maior tamanho, `padEnd(96,'0')`, `padEnd(64,'0')`,
 * comparação de comprimento em curto-circuito). Todas corretas, e é justamente
 * esse o problema: uma revisão de segurança que ajuste o método precisaria achar
 * as quatro.
 *
 * Duas propriedades que o preenchimento precisa garantir, e que as versões com
 * `padEnd('0')` só garantiam por acidente:
 *
 * - o comprimento é conferido À PARTE. Preenchendo com o caractere `'0'`,
 *   `"abc"` e `"abc0"` viram a mesma sequência — sem essa conferência extra
 *   passariam por iguais. Aqui o preenchimento é com byte `0x00`, que não
 *   colide com texto, e o comprimento é comparado mesmo assim;
 * - nada é TRUNCADO. As versões de tamanho fixo cortavam em 64/96 bytes: dois
 *   segredos diferentes a partir do byte 97 seriam aceitos como iguais.
 */
import { timingSafeEqual } from 'node:crypto';

/**
 * `true` só quando as duas strings têm exatamente os mesmos bytes UTF-8.
 * O tempo de execução não depende de ONDE elas diferem.
 */
export function comparacaoTimingSafe(a: string, b: string): boolean {
	const bufA = Buffer.from(a, 'utf8');
	const bufB = Buffer.from(b, 'utf8');
	// `timingSafeEqual` exige buffers do mesmo tamanho; o mínimo de 1 evita o
	// erro que ele lança com dois buffers vazios.
	const len = Math.max(bufA.length, bufB.length, 1);
	const padA = Buffer.alloc(len);
	const padB = Buffer.alloc(len);
	bufA.copy(padA);
	bufB.copy(padB);
	const iguais = timingSafeEqual(padA, padB);
	return iguais && bufA.length === bufB.length;
}
