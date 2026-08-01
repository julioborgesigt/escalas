/**
 * POST /api/auth/verificar-2fa
 *
 * Verifica o código 2FA enviado por e-mail e cria a sessão do usuário.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, auditar, contextoDeEvento } from '$lib/db';
import { criarSessao, verificarDesafio2FA } from '$lib/auth';
import { policiais, administradores } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { cookieOptions } from '$lib/server/auth/auth-flow';
import {
	contarRecoveryAttempts,
	registrarRecoveryAttempt
} from '$lib/server/auth/recovery-rate-limit';
import {
	apiError,
	ErrorCode,
	notFound,
	forbidden,
	rateLimited,
	validateBody
} from '$lib/server/api';
import { verificar2faSchema } from '$lib/schemas';
import { logger } from '$lib/server/logger';

// Throttle por IP do brute-force do código 2FA. O contador de 5 tentativas por
// desafio (em verificarDesafio2FA) é resetável via /reenviar-codigo (novo
// desafio, novo código), então sem este teto por IP o atacante recicla desafios
// indefinidamente. 10/15min é folgado para erros de digitação legítimos.
const VERIFICAR_2FA_MAX = 10;
const VERIFICAR_2FA_WINDOW_MIN = 15;

export const POST: RequestHandler = async (event) => {
	const { platform, request, cookies, url, getClientAddress } = event;
	const db = getDB(platform);
	const ip = getClientAddress();

	try {
		const { blocked } = await contarRecoveryAttempts(
			db,
			ip,
			'verificar_2fa',
			VERIFICAR_2FA_WINDOW_MIN,
			VERIFICAR_2FA_MAX
		);
		if (blocked) {
			return rateLimited('Muitas tentativas. Faça login novamente em alguns minutos.');
		}
	} catch (err) {
		logger.error('[verificar-2fa] Falha no rate-limit (fail-open)', {
			error: err instanceof Error ? err.message : String(err)
		});
	}

	const v = await validateBody(request, verificar2faSchema);
	if (!v.ok) return v.response;
	const { desafioId, codigo } = v.data;

	const resultado = await verificarDesafio2FA(db, desafioId, codigo, ['policial', 'admin']);

	// Registra a tentativa malsucedida (código errado/expirado/esgotado) para o
	// teto por IP acima. Sucesso não conta. Fail-open: erro de registro não
	// pode quebrar o login.
	if (resultado === 'expirado' || resultado === 'esgotado' || !resultado) {
		try {
			await registrarRecoveryAttempt(db, ip, 'verificar_2fa');
		} catch (err) {
			logger.error('[verificar-2fa] Falha ao registrar tentativa (fail-open)', {
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	if (resultado === 'expirado') {
		// Mantém status 401 + flag legada `expirado` para o front diferenciar
		// até a próxima major do contrato. O ErrorCode novo (AUTH_REQUIRED)
		// também identifica o caso para consumidores que migrarem.
		return json(
			{
				error: 'Código expirado. Faça login novamente.',
				status: 401,
				errorType: ErrorCode.AUTH_REQUIRED,
				expirado: true
			},
			{ status: 401 }
		);
	}
	if (resultado === 'esgotado') {
		return json(
			{
				error: 'Muitas tentativas incorretas. Faça login novamente.',
				status: 429,
				errorType: ErrorCode.RATE_LIMIT,
				esgotado: true
			},
			{ status: 429 }
		);
	}
	if (!resultado) {
		return apiError('Código inválido. Verifique e tente novamente.', 401, ErrorCode.AUTH_REQUIRED);
	}

	const { tipo, usuarioId } = resultado;

	// Verificar se o usuário ainda está ativo e buscar primeiro_acesso
	let primeiroAcesso: boolean;
	let nomeUsuario: string;
	if (tipo === 'admin') {
		const admin = await db
			.select()
			.from(administradores)
			.where(eq(administradores.id, usuarioId))
			.get();
		if (!admin) return notFound('Usuário');
		primeiroAcesso = admin.primeiro_acesso === 1;
		nomeUsuario = admin.nome;
	} else {
		const policial = await db.select().from(policiais).where(eq(policiais.id, usuarioId)).get();
		if (!policial || policial.ativo === 0) {
			return forbidden('Usuário inativo');
		}
		primeiroAcesso = policial.primeiro_acesso === 1;
		nomeUsuario = policial.nome;
	}

	const token = await criarSessao(db, tipo as 'policial' | 'admin', usuarioId);
	cookies.set('session_token', token, cookieOptions(url));

	const { contexto, env } = contextoDeEvento(event);
	await auditar(
		db,
		{
			acao: 'login',
			usuario: { id: usuarioId, nome: nomeUsuario, tipo: tipo as 'policial' | 'admin' },
			entidade: tipo,
			entidade_id: usuarioId,
			detalhes: `Login com 2FA por e-mail (${tipo})`,
			metadados: { via: '2fa' },
			...contexto
		},
		{ env }
	);

	return json({ success: true, primeiro_acesso: primeiroAcesso });
};
