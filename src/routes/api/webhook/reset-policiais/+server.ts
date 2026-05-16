/**
 * POST /api/webhook/reset-policiais
 *
 * **OPERAÇÃO DESTRUTIVA E IRREVERSÍVEL.** Apaga todas as tabelas operacionais.
 *
 * Antes de executar exige:
 *  1. `Authorization: Bearer <SYNC_TOKEN>`            — segredo padrão de webhooks.
 *  2. `X-Reset-Token: <RESET_TOKEN>`                  — segredo SEPARADO, nunca igual ao SYNC.
 *  3. `X-Confirm-Reset: <YYYY-MM-DD UTC do dia atual>` — anti-replay, válido só hoje.
 *
 * Caso o `RESET_TOKEN` não esteja configurado no ambiente, o endpoint **sempre**
 * retorna 401 — fail-closed por padrão, evitando que um deploy esqueça a guarda.
 *
 * Antes da deleção, grava no log estruturado um snapshot com a contagem de
 * linhas por tabela. Esse snapshot serve de prova forense em caso de
 * comprometimento ou execução acidental.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { count } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { logger } from '$lib/server/logger';
import { compararSegredoUtf8TimingSafe } from '$lib/auth';
import { SYNC_TOKEN_MIN_LEN } from '$lib/server/webhook-auth';
import { apiError, ErrorCode, unauthorized, serverError } from '$lib/server/api';
import {
	policiais,
	unidades,
	giseEscalas,
	giseSeccionais,
	giseEquipes,
	giseMembros,
	gisePresencas,
	giseRespostasFormulario,
	giseAssinaturasRelatorios,
	giseSeccionalUnidades,
	escalaPoliciais,
	escalas,
	giseDocumentos,
	escalaDocumentos
} from '$lib/server/schema';

function bearerTokenValido(authHeader: string | null, expectedToken: string): boolean {
	const expected = `Bearer ${expectedToken}`;
	return compararSegredoUtf8TimingSafe(authHeader ?? '', expected);
}

/** YYYY-MM-DD em UTC. Diferenças de fuso entre cliente e Worker são absorvidas pela janela de 24h. */
function dataIsoHojeUtc(): string {
	const now = new Date();
	const yyyy = now.getUTCFullYear();
	const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(now.getUTCDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	// `platform.env` resolve para `Env` em runtime Cloudflare, mas o tipo
	// gerado pelo svelte-kit local não enxerga isso sem cast.
	const env = (platform?.env ?? {}) as Env;
	const SYNC_TOKEN = env.SYNC_TOKEN;
	const RESET_TOKEN = env.RESET_TOKEN;
	const ip = getClientAddress();

	// Fail-closed: sem RESET_TOKEN configurado, ninguém apaga nada.
	if (!SYNC_TOKEN || !RESET_TOKEN) {
		logger.warn('[reset-policiais] tentativa sem segredos configurados', { ip });
		return unauthorized();
	}
	// Recusa segredos fracos (config drift / placeholders esquecidos).
	if (SYNC_TOKEN.length < SYNC_TOKEN_MIN_LEN || RESET_TOKEN.length < SYNC_TOKEN_MIN_LEN) {
		logger.warn('[reset-policiais] segredos abaixo do mínimo de entropia', { ip });
		return unauthorized();
	}

	const authHeader = request.headers.get('Authorization');
	const resetHeader = request.headers.get('X-Reset-Token');
	const confirmHeader = request.headers.get('X-Confirm-Reset');

	if (!bearerTokenValido(authHeader, SYNC_TOKEN)) {
		logger.warn('[reset-policiais] bearer inválido', { ip });
		return unauthorized();
	}

	if (!resetHeader || !compararSegredoUtf8TimingSafe(resetHeader, RESET_TOKEN)) {
		logger.warn('[reset-policiais] X-Reset-Token ausente ou inválido', { ip });
		return unauthorized();
	}

	const hoje = dataIsoHojeUtc();
	if (!confirmHeader || !compararSegredoUtf8TimingSafe(confirmHeader, hoje)) {
		logger.warn('[reset-policiais] X-Confirm-Reset ausente ou fora da janela', {
			ip,
			esperado: hoje,
			recebido: confirmHeader ?? '(vazio)'
		});
		// Mensagem específica (com o valor esperado) ajuda o operador na hora
		// de disparar do Google Apps Script; status mantido 401 para preservar
		// behavior do client.
		return apiError(
			`Cabeçalho X-Confirm-Reset deve ser igual a "${hoje}" (UTC).`,
			401,
			ErrorCode.AUTH_REQUIRED
		);
	}

	const db = getDB(platform);

	// Snapshot pré-deleção. Útil para auditoria/recuperação forense.
	let snapshot: Record<string, number>;
	try {
		const tabelas = [
			['policiais', policiais],
			['unidades', unidades],
			['escalas', escalas],
			['escala_policiais', escalaPoliciais],
			['escala_documentos', escalaDocumentos],
			['gise_escalas', giseEscalas],
			['gise_seccionais', giseSeccionais],
			['gise_seccional_unidades', giseSeccionalUnidades],
			['gise_equipes', giseEquipes],
			['gise_membros', giseMembros],
			['gise_presencas', gisePresencas],
			['gise_respostas_formulario', giseRespostasFormulario],
			['gise_assinaturas_relatorios', giseAssinaturasRelatorios],
			['gise_documentos', giseDocumentos]
		] as const;

		const counts = await Promise.all(
			tabelas.map(([_, t]) => db.select({ n: count() }).from(t).get())
		);
		snapshot = Object.fromEntries(
			tabelas.map(([nome], i) => [nome, counts[i]?.n ?? 0])
		);
		logger.warn('[reset-policiais] snapshot pré-deleção', { ip, snapshot });
	} catch (err) {
		return serverError(`[reset-policiais] Falha ao gerar snapshot (ip=${ip})`, err);
	}

	try {
		// IMPORTANTE: Limpeza profunda em ordem reversa de dependência
		// 1. Tabelas de transação e logs
		await db.delete(gisePresencas);
		await db.delete(giseRespostasFormulario);
		await db.delete(giseAssinaturasRelatorios);
		await db.delete(giseDocumentos);
		await db.delete(escalaDocumentos);

		// 2. Hierarquia GISE
		await db.delete(giseMembros);
		await db.delete(giseEquipes);
		await db.delete(giseSeccionalUnidades);
		await db.delete(giseSeccionais);
		await db.delete(giseEscalas);

		// 3. Escalas antigas
		await db.delete(escalaPoliciais);
		await db.delete(escalas);

		// 4. Tabelas base (Unidades e Policiais)
		await db.delete(policiais);
		await db.delete(unidades);

		logger.warn('[reset-policiais] reset concluído', { ip, snapshot });

		return json({
			success: true,
			message: 'Banco de dados resetado com sucesso (Tabelas operacionais, Policiais e Unidades limpas).',
			snapshot
		});
	} catch (err) {
		return serverError(`[reset-policiais] Falha durante deleção (ip=${ip})`, err);
	}
};
