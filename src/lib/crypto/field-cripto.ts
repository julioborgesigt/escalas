/**
 * Cifragem genérica de campos sensíveis em repouso (AES-256-GCM).
 *
 * Fina camada sobre `./envelope` (o `enc:v1:<base64(iv(12) || ct+tag)>` comum a
 * todo dado cifrado do projeto), SEM normalização de domínio — serve para
 * qualquer string, como o IP completo do log de auditoria, que precisa ficar
 * recuperável só em perícia autorizada. O irmão `cpf-cripto` usa o mesmo
 * envelope, e a única diferença dele é normalizar o CPF antes.
 *
 * Confidencialidade: AES-256-GCM com IV aleatório por gravação (não
 * determinístico — não dá para `WHERE`; por isso a auditoria mantém também a
 * coluna `ip` ANONIMIZADA para filtro/exibição).
 *
 * Módulo puro (WebCrypto + ./hex), importável pelo app e por scripts `tsx`.
 */
import { cifrarComChave, decifrarComChave } from './envelope';

/** Nome da variável de ambiente, para a mensagem de erro apontar a chave certa. */
const NOME_CHAVE = 'AUDIT_IP_ENCRYPTION_KEY';

export { ehCifrado } from './envelope';

/** Cifra um texto arbitrário → `enc:v1:<base64>`. */
export async function cifrarTexto(plain: string, encKeyHex: string): Promise<string> {
	return cifrarComChave(plain, encKeyHex, NOME_CHAVE);
}

/**
 * Decifra um valor `enc:v1:...`. Valores SEM o prefixo (vazios ou legados em
 * texto) voltam como estão — tolerante à coexistência durante o rollout.
 */
export async function decifrarTexto(
	armazenado: string | null | undefined,
	encKeyHex: string
): Promise<string> {
	return decifrarComChave(armazenado, encKeyHex, NOME_CHAVE);
}
