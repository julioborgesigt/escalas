/**
 * Envelope de cifragem em repouso — a forma ÚNICA de guardar dado sensível
 * cifrado neste projeto: `enc:v1:<base64(iv(12) || ciphertext+tag)>`, AES-256-GCM
 * com IV aleatório por gravação.
 *
 * Dois módulos consomem daqui, e a diferença entre eles é só de domínio:
 * `cpf-cripto` normaliza o CPF antes de cifrar e mantém um índice cego para
 * lookup; `field-cripto` cifra string arbitrária. O envelope em si — formato,
 * prefixo, tamanho de IV, validação de chave — é o mesmo, e antes estava
 * copiado linha a linha nos dois. O cabeçalho de `field-cripto` chegava a
 * DESCREVER a duplicação ("mesmo envelope de cpf-cripto.ts") em vez de
 * eliminá-la: um ajuste no formato precisaria ser feito duas vezes, e a metade
 * esquecida só apareceria como dado ilegível.
 *
 * `nomeChave` existe para a mensagem de erro apontar a variável de ambiente
 * certa (`CPF_ENCRYPTION_KEY` × `AUDIT_IP_ENCRYPTION_KEY`) — é o operador quem
 * lê esse texto.
 *
 * Módulo puro (WebCrypto + ./hex + ./bin), importável pelo app e por scripts.
 */
import { hexToBytes } from './hex';
import { bytesToBase64, base64ToBytes } from './bin';

const ENC_PREFIX = 'enc:v1:';

/** `true` se o valor já está no envelope cifrado `enc:v1:...`. */
export function ehCifrado(valor: string | null | undefined): boolean {
	return typeof valor === 'string' && valor.startsWith(ENC_PREFIX);
}

/**
 * Valida e converte uma chave de 32 bytes em hex. Exportada porque também
 * alimenta o HMAC do índice cego de CPF, que não passa pelo envelope.
 */
export function chaveHexParaBytes(hex: string, nomeChave: string): Uint8Array<ArrayBuffer> {
	const bytes = hexToBytes(hex.trim());
	if (!bytes || bytes.length !== 32) {
		throw new Error(
			`${nomeChave} inválida: esperado 32 bytes em hex (64 chars). Gere com "openssl rand -hex 32".`
		);
	}
	return bytes;
}

/** Cifra um texto → `enc:v1:<base64>`. */
export async function cifrarComChave(
	plain: string,
	encKeyHex: string,
	nomeChave: string
): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		chaveHexParaBytes(encKeyHex, nomeChave),
		{ name: 'AES-GCM' },
		false,
		['encrypt']
	);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: iv as BufferSource },
			key,
			new TextEncoder().encode(plain) as BufferSource
		)
	);
	const blob = new Uint8Array(iv.length + ct.length);
	blob.set(iv, 0);
	blob.set(ct, iv.length);
	return ENC_PREFIX + bytesToBase64(blob);
}

/**
 * Decifra um valor `enc:v1:...`. Valor SEM o prefixo (vazio, ou legado em texto
 * plano) volta como está — tolerância deliberada para a coexistência durante o
 * rollout da cifragem.
 */
export async function decifrarComChave(
	armazenado: string | null | undefined,
	encKeyHex: string,
	nomeChave: string
): Promise<string> {
	const v = String(armazenado ?? '');
	if (!v.startsWith(ENC_PREFIX)) return v;
	const blob = base64ToBytes(v.slice(ENC_PREFIX.length));
	const iv = blob.slice(0, 12);
	const ct = blob.slice(12);
	const key = await crypto.subtle.importKey(
		'raw',
		chaveHexParaBytes(encKeyHex, nomeChave),
		{ name: 'AES-GCM' },
		false,
		['decrypt']
	);
	const pt = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: iv as BufferSource },
		key,
		ct as BufferSource
	);
	return new TextDecoder().decode(pt);
}
