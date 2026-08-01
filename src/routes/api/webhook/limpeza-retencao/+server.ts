/**
 * POST /api/webhook/limpeza-retencao
 *
 * Dispara a limpeza de retenção de dados (LGPD art. 16 + higiene operacional):
 * remove sessões, tokens 2FA/reset, tentativas de login/recovery e nonces de
 * webhook expirados, além do audit_log além do prazo. A lógica vive em
 * `executarLimpezaRetencao`; aqui é só o gatilho automatizável.
 *
 * Autenticado por SYNC_TOKEN (Bearer), igual aos demais webhooks — pensado para
 * um agendador externo (GitHub Actions cron em `.github/workflows/cleanup-retencao.yml`),
 * já que o Cloudflare Pages não oferece cron triggers nativos. É idempotente:
 * remove apenas registros já expirados, então reexecuções são inofensivas
 * (não precisa de replay-protection).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, registrarAuditComContexto } from '$lib/db';
import { carregarConfigRetencao, executarLimpezaRetencao } from '$lib/db/lgpd-retencao';
import {
	validarWebhookSync,
	validarReplayProtection,
	replayEnforceLigado,
	logFaltaReplayHeaders
} from '$lib/server/auth/webhook-auth';
import { logger } from '$lib/server/logger';
import { unauthorized } from '$lib/server/api';

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const env = platform?.env as Env | undefined;
	const rawBody = await request.text();
	const auth = await validarWebhookSync(env?.SYNC_TOKEN, request, rawBody);
	if (!auth.ok) {
		logger.warn('[limpeza-retencao] auth rejeitada', {
			ip: getClientAddress(),
			reason: auth.reason
		});
		return unauthorized();
	}

	const db = getDB(platform);

	// Replay protection: evita abusos de chamadas repetitivas de limpeza
	const replay = await validarReplayProtection(db, request);
	if (!replay.ok) {
		const ctx = { ip: getClientAddress(), reason: replay.reason };
		if (replay.reason === 'missing-headers' && !replayEnforceLigado(env)) {
			logFaltaReplayHeaders('limpeza-retencao', ctx, import.meta.env.PROD);
		} else {
			logger.warn('[limpeza-retencao] replay protection rejeitou', ctx);
			return unauthorized();
		}
	}

	const config = await carregarConfigRetencao(db);
	const resultado = await executarLimpezaRetencao(db, config);

	await registrarAuditComContexto(db, {
		usuario: null,
		acao: 'limpeza_retencao',
		entidade: 'lgpd',
		detalhes: JSON.stringify({ origem: 'cron', resultado })
	});

	logger.info('[limpeza-retencao] concluída', { resultado });
	return json({ ok: true, resultado });
};
