/**
 * GET /api/health — sonda de liveness/readiness.
 *
 * Resposta pública é binária (`200 ok` vs `503 down`) — antes devolvia
 * `{ checks: { database, r2 } }` com o estado individual dos bindings,
 * útil para reconnaissance: atacante mapeava qual peça da infra está
 * fora e ajustava o alvo do DDoS. O detalhe estruturado continua
 * disponível para o operador via `?detail=<HEALTH_DETAIL_TOKEN>`
 * (segredo opcional via env).
 */

import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { tryGetR2 } from '$lib/db';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { compararSegredoUtf8TimingSafe } from '$lib/auth';
import { verificarSaudeLimpezaRetencao, type SaudeLimpezaRetencao } from '$lib/db/lgpd-retencao';

interface HealthEnv {
	HEALTH_DETAIL_TOKEN?: string;
}

export const GET: RequestHandler = async ({ platform, url }) => {
	const checks: Record<string, 'ok' | 'error'> = {};
	let healthy = true;

	// Check D1 database
	try {
		const db = getDB(platform);
		await db.run(sql`SELECT 1`);
		checks.database = 'ok';
	} catch {
		checks.database = 'error';
		healthy = false;
	}

	// Check R2 bucket binding
	try {
		const r2 = tryGetR2(platform);
		if (r2) {
			checks.r2 = 'ok';
		} else {
			checks.r2 = 'error';
			healthy = false;
		}
	} catch {
		checks.r2 = 'error';
		healthy = false;
	}

	// Detalhe estruturado: só com `?detail=<HEALTH_DETAIL_TOKEN>` válido.
	// Comparação timing-safe; min 16 chars para não permitir token fraco.
	const env = (platform?.env ?? {}) as HealthEnv;
	const detailToken = url.searchParams.get('detail') ?? '';
	const wantDetail =
		!!env.HEALTH_DETAIL_TOKEN &&
		env.HEALTH_DETAIL_TOKEN.length >= 16 &&
		compararSegredoUtf8TimingSafe(detailToken, env.HEALTH_DETAIL_TOKEN);

	if (wantDetail) {
		// Failsafe do cron de limpeza (LGPD/retenção): se o agendador externo
		// parar, as tabelas crescem sem limite. Sinalizamos a defasagem para o
		// monitor do operador sem derrubar a liveness pública. Não bloqueia o
		// health se a consulta falhar (DB já reportado acima).
		let retencao: SaudeLimpezaRetencao | { erro: true };
		try {
			retencao = await verificarSaudeLimpezaRetencao(getDB(platform));
		} catch {
			retencao = { erro: true };
		}
		const stale = 'atrasada' in retencao && retencao.atrasada;
		return json(
			{
				status: healthy ? (stale ? 'degraded' : 'healthy') : 'degraded',
				checks: { ...checks, limpezaRetencao: stale ? 'stale' : 'ok' },
				retencao,
				timestamp: new Date().toISOString()
			},
			{ status: healthy ? 200 : 503 }
		);
	}

	// Resposta pública mínima: monitoramento externo continua funcionando
	// (curl checa só o status code), atacante não aprende nada sobre a
	// topologia interna.
	return json({ status: healthy ? 'ok' : 'down' }, { status: healthy ? 200 : 503 });
};
