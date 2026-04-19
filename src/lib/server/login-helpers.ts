/**
 * Rate limit e utilitários compartilhados entre login por formulário (+page.server)
 * e login por API (+server.ts), para manter mesmas regras e métricas.
 */
import { eq, and, gt } from 'drizzle-orm';
import { loginAttempts } from '$lib/server/schema';
import type { Database } from '$lib/db';

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MINUTES = 15;

export function mascararEmailLogin(email: string): string {
	const at = email.indexOf('@');
	if (at <= 0) return email;
	const local = email.slice(0, at);
	const domain = email.slice(at + 1);
	let masked: string;
	if (local.length === 1) {
		masked = local;
	} else if (local.length === 2) {
		masked = local[0] + '*';
	} else {
		const showStart = Math.min(2, Math.floor(local.length / 2));
		masked =
			local.slice(0, showStart) +
			'*'.repeat(local.length - showStart - 1) +
			local[local.length - 1];
	}
	return masked + '@' + domain;
}

export function cookieOptionsLogin(url: URL) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'strict' as const,
		secure: url.protocol === 'https:',
		maxAge: 12 * 60 * 60
	};
}

export async function checkLoginRateLimit(
	db: Database,
	ip: string
): Promise<{ blocked: boolean; remaining: number }> {
	const windowStart = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60 * 1000).toISOString();
	const attempts = await db
		.select()
		.from(loginAttempts)
		.where(
			and(
				eq(loginAttempts.ip, ip),
				gt(loginAttempts.attempted_at, windowStart),
				eq(loginAttempts.success, 0)
			)
		)
		.all();
	const count = attempts.length;
	return {
		blocked: count >= LOGIN_MAX_ATTEMPTS,
		remaining: Math.max(0, LOGIN_MAX_ATTEMPTS - count)
	};
}

export async function recordLoginAttempt(db: Database, ip: string, success: boolean): Promise<void> {
	await db.insert(loginAttempts).values({ ip, success: success ? 1 : 0 });
}
