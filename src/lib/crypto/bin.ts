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
