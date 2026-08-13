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
import { getDB, tryGetR2, registrarAuditComContexto } from '$lib/db';
import { carregarConfigRetencao, executarLimpezaRetencao } from '$lib/db/lgpd';
import { contarPendenciasAudit, reprocessarPendenciasAudit } from '$lib/db/audit';
import { contarPendenciasR2, reprocessarPendenciasR2 } from '$lib/server/r2-cleanup';
import {
	contarPendenciasBaseEquipe,
	reprocessarPendenciasBaseEquipe
} from '$lib/server/gise/base-equipe-sync';
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

	// Mesmo cron, segunda tarefa: reinserir na cadeia os eventos que ficaram
	// pendentes (FLW-AUDIT-001). Vai junto porque a pendência é, por natureza,
	// rara e assíncrona — um agendador só para ela ficaria anos sem trabalho e
	// seria o primeiro a ser desligado sem ninguém notar.
	const auditoria = await reprocessarPendenciasAudit(db, { env });
	const pendenciasRestantes = await contarPendenciasAudit(db);

	// Terceira tarefa, mesmo raciocínio: o objeto do R2 que resistiu ao delete
	// (FLW-R2-004). A chave foi capturada antes de a linha que a referenciava
	// sumir; aqui é onde ela ganha nova chance.
	const r2 = await reprocessarPendenciasR2(db, tryGetR2(platform) ?? null);
	const r2Restantes = await contarPendenciasR2(db);

	// Quarta tarefa: a GISE finalizada que não chegou à planilha da corporação
	// (FLW-WEBHOOK-003). Reenviar remonta as linhas do banco, então o que vai é
	// sempre o estado atual da escala.
	const baseEquipe = await reprocessarPendenciasBaseEquipe(env, db);
	const baseEquipeRestantes = await contarPendenciasBaseEquipe(db);

	await registrarAuditComContexto(db, {
		usuario: null,
		acao: 'limpeza_retencao',
		entidade: 'lgpd',
		detalhes: JSON.stringify({ origem: 'cron', resultado, auditoria, r2, baseEquipe })
	});

	// Os dois contadores de restantes saem na resposta e no log de propósito: são
	// os números que dizem se a trilha está íntegra e se o bucket está limpo.
	// Crescendo entre execuções, há evento que a cadeia recusa de forma
	// permanente, ou objeto que o R2 não deixa apagar.
	logger.info('[limpeza-retencao] concluída', {
		resultado,
		auditoria,
		pendenciasRestantes,
		r2,
		r2Restantes,
		baseEquipe,
		baseEquipeRestantes
	});
	return json({
		ok: true,
		resultado,
		auditoria,
		pendenciasRestantes,
		r2,
		r2Restantes,
		baseEquipe,
		baseEquipeRestantes
	});
};
