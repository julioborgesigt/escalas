import { json } from '@sveltejs/kit';
import { bytesToHex } from '$lib/crypto/hex';
import { getDB } from '$lib/db';
import { gerarToken } from '$lib/auth';
import { doisFatoresTokens } from '$lib/server/schema';
import { rateLimited } from '$lib/server/api';
import { checkRateLimit } from '$lib/server/auth-flow';
import type { RequestHandler } from './$types';

// Desafios de login por certificado expiram em 5 minutos
const CERTIFICADO_DESAFIO_TTL_MS = 5 * 60 * 1000;

export const POST: RequestHandler = async ({ platform, getClientAddress }) => {
	const db = getDB(platform);
	const ip = getClientAddress();

	const rateLimit = await checkRateLimit(db, ip);
	if (rateLimit.blocked) {
		return rateLimited('Muitas tentativas. Aguarde alguns minutos.');
	}

	const desafioId = gerarToken();
	// Nonce aleatório (hex de 32 bytes) que o frontend envia ao Assinador SERPRO.
	const nonce = gerarToken();

	// O cliente decodifica o nonce hex em bytes e assina `SHA-256(bytes)` via
	// type:'hash' — logo o `messageDigest` do CMS resultante É exatamente esse
	// digest. Guardamos esse MESMO valor (e NÃO o hash da string hex) para que
	// `/verificar` possa conferir que a assinatura cobre o nonce DESTE desafio.
	// É o vínculo que, junto com a verificação da assinatura, fecha o bypass:
	// sem ele, verificar a assinatura sozinha não prova nada (o atacante poderia
	// assinar qualquer conteúdo). Deve permanecer idêntico ao cálculo no cliente
	// (src/routes/login/+page.svelte → fazerLoginComCertificado).
	const nonceBytes = Uint8Array.from(nonce.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
	const expectedDigestHex = await crypto.subtle
		.digest('SHA-256', nonceBytes)
		.then((buf) => bytesToHex(new Uint8Array(buf)));

	const expiresAt = new Date(Date.now() + CERTIFICADO_DESAFIO_TTL_MS).toISOString();

	await db.insert(doisFatoresTokens).values({
		desafio_id: desafioId,
		tipo: 'login_certificado',
		usuario_id: 0, // usuário ainda não identificado
		codigo: expectedDigestHex,
		expires_at: expiresAt
	});

	return json({ desafioId, nonce });
};
