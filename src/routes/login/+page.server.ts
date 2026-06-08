import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { eq, and, count, gt } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { verificarDesafio2FA, criarSessao, criarTokenRedefinicao } from '$lib/auth';
import { enviarLinkPrimeiroAcesso } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import {
	tentarLogin,
	LOGIN_WINDOW_MINUTES,
	cookieOptionsLogin,
	type AdminModulo
} from '$lib/server/auth-flow';
import { administradores, policiais, loginAttempts } from '$lib/server/schema';
import { loginSchema } from '$lib/schemas';
import { resolverAppOrigin } from '$lib/server/app-origin';

const cookieOptions = cookieOptionsLogin;

const PRIMEIRO_ACESSO_MAX_TENTATIVAS_IP = 5;
const PRIMEIRO_ACESSO_JANELA_IP_MINUTOS = 15;

export const load: PageServerLoad = async ({ locals }) => {
	const u = locals.usuario;
	if (u) {
		throw redirect(302, u.tipo === 'admin' ? '/painel' : '/escalas');
	}
	return {};
};

export const actions: Actions = {
	login: async ({ request, cookies, platform, url, getClientAddress }) => {
		const db = getDB(platform);
		const ip = getClientAddress();
		const formData = await request.formData();
		const matricula = formData.get('matricula') as string;
		const senha = formData.get('senha') as string;
		const tipo = formData.get('tipo') as 'policial' | 'admin';
		const adminModulo = ((formData.get('adminModulo') as string) || 'ambas') as AdminModulo;

		const parsed = loginSchema.safeParse({ matricula, senha, tipo });
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0].message, fields: { matricula, tipo } });
		}

		const result = await tentarLogin({
			db,
			ip,
			matricula: parsed.data.matricula,
			senha: parsed.data.senha,
			tipo: parsed.data.tipo,
			platform,
			formAdminModulo: adminModulo
		});

		if (!result.sucesso && result.statusCode === 429) {
			return fail(429, {
				error: `Muitas tentativas. Tente em ${LOGIN_WINDOW_MINUTES} minutos.`,
				fields: { matricula, tipo }
			});
		}

		if (!result.sucesso && 'pendente2FA' in result) {
			if (result.setAdminModuloPendingCookie) {
				cookies.set('admin_modulo_pending', adminModulo, {
					...cookieOptions(url),
					maxAge: 15 * 60
				});
			}
			const p = result.pendente2FA;
			return {
				pendente2FA: true,
				desafioId: p.desafioId,
				nome: p.nome,
				primeiro_acesso: p.primeiroAcesso,
				emailMascarado: p.emailMascarado,
				tipoUsuario2FA: p.tipoUsuario2FA
			};
		}

		if (!result.sucesso) {
			return fail(result.statusCode as 400 | 401 | 429 | 500, {
				error: result.erro,
				fields: result.fields ?? { matricula, tipo }
			});
		}

		cookies.set('session_token', result.token, cookieOptions(url));
		if (result.role === 'admin' && result.adminModuloCookie !== undefined) {
			cookies.set('admin_modulo', result.adminModuloCookie, cookieOptions(url));
		}
		if (!result.formRedirect) {
			return fail(500, { error: 'Resposta de login incompleta.' });
		}
		return {
			success: true,
			redirect: result.formRedirect,
			primeiro_acesso: result.primeiroAcesso,
			nome: result.nome
		};
	},

	verificar2FA: async ({ request, cookies, platform, url }) => {
		const db = getDB(platform);
		const formData = await request.formData();
		const desafioId = formData.get('desafioId') as string;
		const codigo = formData.get('codigo') as string;

		if (!desafioId || !codigo) {
			return fail(400, { error: 'Dados inválidos' });
		}

		const resultado = await verificarDesafio2FA(db, desafioId, String(codigo), [
			'policial',
			'admin'
		]);

		if (resultado === 'expirado') {
			return fail(401, { error: 'Código expirado. Faça login novamente.', expirado: true });
		}
		if (resultado === 'esgotado') {
			return fail(429, {
				error: 'Muitas tentativas incorretas. Faça login novamente.',
				esgotado: true
			});
		}
		if (!resultado) {
			return fail(401, { error: 'Código inválido. Verifique e tente novamente.' });
		}

		const { tipo, usuarioId } = resultado;

		let primeiroAcesso: boolean;
		if (tipo === 'admin') {
			const admin = await db
				.select()
				.from(administradores)
				.where(eq(administradores.id, usuarioId))
				.get();
			if (!admin) return fail(404, { error: 'Usuário não encontrado' });
			primeiroAcesso = admin.primeiro_acesso === 1;
		} else {
			const policial = await db.select().from(policiais).where(eq(policiais.id, usuarioId)).get();
			if (!policial || policial.ativo === 0) return fail(403, { error: 'Usuário inativo' });
			primeiroAcesso = policial.primeiro_acesso === 1;
		}

		const token = await criarSessao(db, tipo as 'policial' | 'admin', usuarioId);
		cookies.set('session_token', token, cookieOptions(url));

		if (tipo === 'admin') {
			const pendingModulo = cookies.get('admin_modulo_pending') || 'ambas';
			cookies.set('admin_modulo', pendingModulo, cookieOptions(url));
			cookies.delete('admin_modulo_pending', { path: '/' });
			const adminDest2FA =
				pendingModulo === 'gise' ? '/gise' : pendingModulo === 'escalas' ? '/recebidos' : '/painel';
			return {
				success: true,
				redirect: primeiroAcesso ? '/alterar-senha' : adminDest2FA,
				primeiro_acesso: primeiroAcesso
			};
		}

		return {
			success: true,
			redirect: primeiroAcesso ? '/alterar-senha' : '/escalas',
			primeiro_acesso: primeiroAcesso
		};
	},

	solicitarPrimeiroAcesso: async ({ request, platform, url, getClientAddress }) => {
		const db = getDB(platform);
		const ip = getClientAddress();
		const formData = await request.formData();
		const matricula = formData.get('matricula') as string;

		if (!matricula || typeof matricula !== 'string') {
			return fail(400, { error: 'Matrícula inválida.' });
		}

		const respostaGenerica = { success: true, enviado: true };

		const windowIp = new Date(
			Date.now() - PRIMEIRO_ACESSO_JANELA_IP_MINUTOS * 60 * 1000
		).toISOString();
		const [ipCount] = await db
			.select({ n: count() })
			.from(loginAttempts)
			.where(and(eq(loginAttempts.ip, ip), gt(loginAttempts.attempted_at, windowIp)));

		if ((ipCount?.n ?? 0) >= PRIMEIRO_ACESSO_MAX_TENTATIVAS_IP) {
			return respostaGenerica;
		}

		await db.insert(loginAttempts).values({ ip, success: 0 });

		const policial = await db
			.select()
			.from(policiais)
			.where(and(eq(policiais.matricula, matricula.trim()), eq(policiais.ativo, 1)))
			.get();

		if (!policial) return respostaGenerica;
		if (policial.primeiro_acesso !== 1) return respostaGenerica;
		if (!policial.email) {
			return fail(422, { error: 'Nenhum e-mail cadastrado para esta matrícula.' });
		}

		const token = await criarTokenRedefinicao(db, 'policial', policial.id);
		const link = `${resolverAppOrigin(url, platform)}/redefinir-senha?token=${token}`;

		try {
			await enviarLinkPrimeiroAcesso(policial.email, policial.nome, link, platform);
		} catch (err) {
			logger.error('[login/primeiro-acesso] Falha ao enviar e-mail', {
				policial_id: policial.id,
				error: err instanceof Error ? err.message : String(err)
			});
			return fail(500, { error: 'Falha ao enviar e-mail. Tente novamente.' });
		}

		return respostaGenerica;
	}
};
