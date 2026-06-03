import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { gerarToken } from '$lib/auth';
import { doisFatoresTokens } from '$lib/server/schema';
import { badRequest, rateLimited } from '$lib/server/api';
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
	// Nonce aleatório que o frontend enviará ao Assinador SERPRO para assinar.
	// Armazenado com hash SHA-256 para consistência com o restante da tabela.
	const nonce = gerarToken();
	const nonceHash = await crypto.subtle
		.digest('SHA-256', new TextEncoder().encode(nonce))
		.then((buf) =>
			Array.from(new Uint8Array(buf))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('')
		);

	const expiresAt = new Date(Date.now() + CERTIFICADO_DESAFIO_TTL_MS).toISOString();

	await db.insert(doisFatoresTokens).values({
		desafio_id: desafioId,
		tipo: 'login_certificado',
		usuario_id: 0, // usuário ainda não identificado
		codigo: nonceHash,
		expires_at: expiresAt
	});

	return json({ desafioId, nonce });
};
