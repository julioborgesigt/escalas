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
