/**
 * Conversões entre as representações binárias que circulam no projeto: "binary
 * string" (1 caractere = 1 byte, o formato do node-forge), `Uint8Array` e
 * base64.
 *
 * Sem dependências, como `hex.ts` — importável pelo app e por scripts.
 */

/**
 * Converte uma "binary string" (onde cada caractere = 1 byte, formato
 * amplamente usado pela biblioteca node-forge) para Uint8Array nativo.
 */
export function binStringToBytes(bin: string): Uint8Array {
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) {
		out[i] = bin.charCodeAt(i) & 0xff;
	}
	return out;
}

/**
 * Uint8Array → "binary string". O caminho de volta para o node-forge, que
 * consome e devolve DER nesse formato.
 */
export function bytesToBinString(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
	return s;
}

/** Bytes → base64. */
export function bytesToBase64(bytes: Uint8Array): string {
	return btoa(bytesToBinString(bytes));
}

/** base64 → bytes. */
export function base64ToBytes(b64: string): Uint8Array {
	return binStringToBytes(atob(b64));
}

/**
 * Bytes → base64url (RFC 4648 §5): `+/` viram `-_` e o `=` de preenchimento
 * some. É o alfabeto do WebAuthn — `credentialId`, `challenge` e os campos do
 * `clientDataJSON` chegam assim, e comparar contra base64 comum falha em ~1 de
 * cada 4 valores, quando calha de aparecer um `+` ou `/`.
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
	return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * base64url → bytes. Aceita também base64 comum: o navegador é quem escolhe o
 * alfabeto, e alguns campos trafegam recodificados por bibliotecas de terceiros.
 */
export function base64UrlToBytes(b64url: string): Uint8Array {
	const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
	const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
	return base64ToBytes(b64 + pad);
}
