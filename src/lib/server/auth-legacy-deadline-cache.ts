import { buscarConfiguracao } from '$lib/db/configuracoes';
import type { Database } from '$lib/db/core';

export const LEGACY_PASSWORD_DEADLINE_DEFAULT_ISO = '2026-07-01T00:00:00Z';

const CHAVE = 'auth.legacy_password_deadline';
const TTL_MS = 5 * 60 * 1000;

let cachedIso: string | null = null;
let cachedAt = 0;

function parseDeadlineIso(iso: string): Date {
	const d = new Date(iso);
	if (!Number.isFinite(d.getTime())) {
		return new Date(LEGACY_PASSWORD_DEADLINE_DEFAULT_ISO);
	}
	return d;
}

/**
 * Deadline para aceitar hash de senha legado (SHA-256), lido de `configuracoes`
 * com cache em memória (TTL 5 min por isolate do Worker).
 */
export async function getLegacyPasswordDeadline(db: Database): Promise<Date> {
	const now = Date.now();
	if (cachedIso !== null && now - cachedAt < TTL_MS) {
		return parseDeadlineIso(cachedIso);
	}
	const row = await buscarConfiguracao(db, CHAVE);
	const iso = row?.trim() || LEGACY_PASSWORD_DEADLINE_DEFAULT_ISO;
	cachedIso = iso;
	cachedAt = now;
	return parseDeadlineIso(iso);
}

/** Quando não há `db` (ex.: testes unitários sem SQLite). */
export function getLegacyPasswordDeadlineDefault(): Date {
	return parseDeadlineIso(LEGACY_PASSWORD_DEADLINE_DEFAULT_ISO);
}
