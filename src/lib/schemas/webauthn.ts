/**
 * Schemas Zod das cerimônias WebAuthn (registro e assinatura).
 *
 * Todos os campos binários trafegam em **base64url**, que é o alfabeto do
 * WebAuthn. Os limites de tamanho não são decoração: `clientDataJSON` e
 * `authenticatorData` de uma cerimônia legítima têm centenas de bytes, e o
 * corpo entra num Worker com CPU contada (Erro 1102 no Cloudflare) — recusar
 * cedo é mais barato que decodificar para descobrir depois.
 */
import { z } from 'zod';

/** base64url: alfabeto A-Z a-z 0-9 - _ e nada mais (sem `=` de padding). */
const base64Url = (max: number) =>
	z
		.string()
		.min(1)
		.max(max)
		.regex(/^[A-Za-z0-9\-_]+$/, 'Valor não está em base64url');

/** Registro: o que `navigator.credentials.create()` produziu. */
export const webauthnRegistroSchema = z.object({
	desafioId: z.string().min(1).max(128),
	credentialId: base64Url(1024),
	clientDataJSON: base64Url(8192),
	authenticatorData: base64Url(8192),
	/** SPKI de `getPublicKey()`. */
	publicKey: base64Url(4096),
	/** COSE alg de `getPublicKeyAlgorithm()`; só ES256 (-7) é aceito adiante. */
	algoritmo: z.number().int(),
	apelido: z.string().max(60).nullish()
});

/** Asserção da assinatura: o que `navigator.credentials.get()` produziu. */
export const webauthnAssercaoSchema = z.object({
	credentialId: base64Url(1024),
	clientDataJSON: base64Url(8192),
	authenticatorData: base64Url(8192),
	/** Assinatura ECDSA em ASN.1 DER. */
	assinatura: base64Url(2048)
});

export type WebauthnAssercao = z.infer<typeof webauthnAssercaoSchema>;
