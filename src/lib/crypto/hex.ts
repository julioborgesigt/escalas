/**
 * Conversões hex ↔ bytes — SEM dependências (só JS puro), de propósito: este
 * módulo é importável tanto pelo app SvelteKit quanto por scripts `tsx`/`node`
 * standalone (que não resolvem aliases `$lib` nem deps do Vite/Drizzle).
 *
 * Centraliza o idiom `bytes.toString(16).padStart(2,'0')` que estava repetido
 * por todo o código (item C7 da auditoria de código morto/duplicado).
 */

/** Codifica bytes em string hexadecimal minúscula (2 chars por byte). */
export function bytesToHex(bytes: Uint8Array): string {
	const hex = new Array(bytes.length);
	for (let i = 0; i < bytes.length; i++) {
		hex[i] = bytes[i].toString(16).padStart(2, '0');
	}
	return hex.join('');
}

/**
 * Decodifica string hexadecimal → bytes. Retorna `null` se o input não for hex
 * válido (comprimento ímpar ou caractere não-hex), para o chamador tratar como
 * entrada inválida (ex.: hash corrompido).
 */
export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
	if (hex.length % 2 !== 0) return null;
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		const b = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		if (Number.isNaN(b)) return null;
		out[i] = b;
	}
	return out;
}
