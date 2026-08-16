/**
 * Janela de reautenticação por senha da assinatura avançada.
 *
 * O POST `/api/auth/reautenticar-assinatura` confere a senha e grava aqui um
 * token opaco (64 hex). Cada POST de assinar confere a janela — sem consumi-la,
 * para o lote reutilizar os ~10 min, como o código 2FA de assinatura.
 *
 * TOKEN NUNCA VAI EM CLARO PARA O BANCO. O valor existe uma vez, na resposta;
 * a linha guarda `sha256:`. `sessao_hash` amarra a janela ao cookie atual: um
 * token vazado não vale em outra sessão.
 *
 * Não autoriza o ato. Só prova que ESTE usuário, NESTA sessão, reinseriu a
 * senha recentemente. A permissão do recurso continua no handler.
 */
import { and, eq, gt } from 'drizzle-orm';
import { assinaturaReauth } from '../server/schema';
import type { Database } from './core';
import { sha256Hex } from '../crypto/digest';
import { gerarTokenOpaco } from '../crypto/token';
import { REAUTH_VALIDADE_MS } from '$lib/assinatura-reauth';

export { REAUTH_VALIDADE_MS };

const PREFIXO_HASH = 'sha256:';

async function hashDoToken(token: string): Promise<string> {
	return `${PREFIXO_HASH}${await sha256Hex(token)}`;
}

/** SHA-256 do cookie de sessão, sem prefixo — não há legado em claro aqui. */
async function hashDaSessao(sessaoToken: string): Promise<string> {
	return sha256Hex(sessaoToken);
}

/**
 * Abre a janela e devolve o token OPACO. Só este valor autoriza os POSTs
 * seguintes; o banco guarda o hash.
 */
export async function criarJanelaReauth(
	db: Database,
	usuario: { tipo: 'policial' | 'admin'; id: number },
	sessaoToken: string
): Promise<string> {
	const token = gerarTokenOpaco();
	await db.insert(assinaturaReauth).values({
		token_hash: await hashDoToken(token),
		usuario_tipo: usuario.tipo,
		usuario_id: usuario.id,
		sessao_hash: await hashDaSessao(sessaoToken),
		expires_at: new Date(Date.now() + REAUTH_VALIDADE_MS).toISOString()
	});
	return token;
}

export type RecusaReauth = 'ausente' | 'invalida';

/**
 * Confere a janela SEM consumi-la. Recusa se o token não existe, expirou,
 * pertence a outro usuário ou foi aberto em outra sessão.
 */
export async function conferirJanelaReauth(
	db: Database,
	token: string | undefined | null,
	usuario: { tipo: 'policial' | 'admin'; id: number },
	sessaoToken: string | undefined | null
): Promise<{ ok: true } | { ok: false; motivo: RecusaReauth }> {
	if (!token || !sessaoToken) return { ok: false, motivo: 'ausente' };

	const linha = await db
		.select({
			usuario_tipo: assinaturaReauth.usuario_tipo,
			usuario_id: assinaturaReauth.usuario_id,
			sessao_hash: assinaturaReauth.sessao_hash
		})
		.from(assinaturaReauth)
		.where(
			and(
				eq(assinaturaReauth.token_hash, await hashDoToken(token)),
				gt(assinaturaReauth.expires_at, new Date().toISOString())
			)
		)
		.get();

	if (!linha) return { ok: false, motivo: 'invalida' };
	if (linha.usuario_tipo !== usuario.tipo || linha.usuario_id !== usuario.id) {
		return { ok: false, motivo: 'invalida' };
	}
	if (linha.sessao_hash !== (await hashDaSessao(sessaoToken))) {
		return { ok: false, motivo: 'invalida' };
	}
	return { ok: true };
}
