/**
 * Cifragem de CPF em repouso (LGPD, achado de privacidade).
 *
 *  - Confidencialidade: AES-256-GCM com IV aleatório por gravação. Formato de
 *    armazenamento: `enc:v1:<base64(iv(12) || ciphertext+tag)>`.
 *  - Lookup: o GCM é não-determinístico, então não dá para `WHERE cpf = ?`.
 *    Um índice cego determinístico `HMAC-SHA256(CPF_INDEX_KEY, cpfNormalizado)`
 *    (hex) é gravado em `cpf_index` e usado pelo login por certificado.
 *
 * Dois segredos SEPARADOS, ambos em hex de 32 bytes (`openssl rand -hex 32`):
 *   CPF_ENCRYPTION_KEY — cifra/decifra (confidencialidade).
 *   CPF_INDEX_KEY      — índice de busca (lookup do cert-login).
 *
 * São LOAD-BEARING como o `PASSWORD_PEPPER`: trocar o valor invalida os dados
 * cifrados/índices existentes (exige re-cifrar tudo ou wipe + re-sincronizar).
 *
 * Módulo puro (só WebCrypto + ./hex), importável pelo app e por scripts.
 */
import { bytesToHex } from './hex';
import { cifrarComChave, decifrarComChave, chaveHexParaBytes } from './envelope';

/** Nome da variável de ambiente, para a mensagem de erro apontar a chave certa. */
const NOME_CHAVE_ENC = 'CPF_ENCRYPTION_KEY';

/** Mantém só os dígitos do CPF (normalização antes de cifrar/indexar). */
function normalizarCPF(cpf: string | null | undefined): string {
	return String(cpf ?? '').replace(/\D/g, '');
}

/**
 * Cifra o CPF → `enc:v1:<base64>`. A NORMALIZAÇÃO é o que distingue esta função
 * do `cifrarTexto` genérico: "123.456.789-01" e "12345678901" precisam produzir
 * o mesmo texto claro, senão o mesmo CPF gravado por caminhos diferentes deixa
 * de casar com o índice de busca.
 */
export async function cifrarCPF(cpfPlain: string, encKeyHex: string): Promise<string> {
	return cifrarComChave(normalizarCPF(cpfPlain), encKeyHex, NOME_CHAVE_ENC);
}

/**
 * Decifra um valor `enc:v1:...`. Se o valor NÃO tiver o prefixo (vazio ou
 * legado em texto plano), devolve como está — tolerante para coexistência.
 */
export async function decifrarCPF(
	armazenado: string | null | undefined,
	encKeyHex: string
): Promise<string> {
	return decifrarComChave(armazenado, encKeyHex, NOME_CHAVE_ENC);
}

/** Índice cego determinístico para lookup: `HMAC-SHA256(indexKey, cpf)` em hex. */
export async function indiceCPF(cpfPlain: string, indexKeyHex: string): Promise<string> {
	const norm = normalizarCPF(cpfPlain);
	const key = await crypto.subtle.importKey(
		'raw',
		chaveHexParaBytes(indexKeyHex, 'CPF_INDEX_KEY'),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = new Uint8Array(
		await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(norm) as BufferSource)
	);
	return bytesToHex(sig);
}

// Workaround para o SvelteKit/Cloudflare inferir platform?.env como unknown
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CpfCriptoEnv = any;

/** Extrai as chaves do env (trim; undefined quando ausente/vazia). */
export function cpfKeys(env: CpfCriptoEnv | undefined): { encKey?: string; indexKey?: string } {
	return {
		encKey: env?.CPF_ENCRYPTION_KEY?.trim() || undefined,
		indexKey: env?.CPF_INDEX_KEY?.trim() || undefined
	};
}

/**
 * Prepara o CPF para persistência — devolve `{ cpf (cifrado), cpf_index }`.
 *
 * Usado por TODOS os caminhos de escrita (sync da planilha e cadastro/edição
 * pelo site), garantindo formato idêntico independentemente da origem.
 *
 * Fail-open: sem as chaves configuradas, grava o CPF normalizado em texto e
 * `cpf_index = null` — mantém o app funcional, mas SEM proteção. Configure
 * CPF_ENCRYPTION_KEY e CPF_INDEX_KEY antes de popular em produção.
 */
export async function prepararCpfParaDB(
	cpfPlain: string | null | undefined,
	env: CpfCriptoEnv | undefined
): Promise<{ cpf: string | null; cpf_index: string | null }> {
	const norm = normalizarCPF(cpfPlain);
	if (!norm) return { cpf: null, cpf_index: null };
	const { encKey, indexKey } = cpfKeys(env);
	if (!encKey || !indexKey) return { cpf: norm, cpf_index: null };
	const [cpf, cpf_index] = await Promise.all([cifrarCPF(norm, encKey), indiceCPF(norm, indexKey)]);
	return { cpf, cpf_index };
}

/**
 * Decifra um CPF lido do banco para exibição/uso. Sem chave configurada (ou
 * valor legado em texto), devolve o valor como está. Conveniência para loads e
 * montagem de sessão.
 */
export async function decifrarCpfDoDB(
	armazenado: string | null | undefined,
	env: CpfCriptoEnv | undefined
): Promise<string> {
	const { encKey } = cpfKeys(env);
	if (!encKey) return String(armazenado ?? '');
	return decifrarCPF(armazenado, encKey);
}

/**
 * Cifra um CPF para colunas de PROVENIÊNCIA (ex.: `assinante_cpf`) que não
 * precisam de índice de busca. Devolve `enc:v1:...` (ou o CPF normalizado em
 * texto, fallback sem chave) ou `null` quando vazio. Para colunas NOT NULL use
 * `(await cifrarCpfParaArmazenar(...)) ?? ''`.
 */
export async function cifrarCpfParaArmazenar(
	cpfPlain: string | null | undefined,
	env: CpfCriptoEnv | undefined
): Promise<string | null> {
	const norm = normalizarCPF(cpfPlain);
	if (!norm) return null;
	const { encKey } = cpfKeys(env);
	return encKey ? cifrarCPF(norm, encKey) : norm;
}
