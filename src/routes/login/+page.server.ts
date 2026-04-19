import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { eq, and } from 'drizzle-orm';
import { getDB } from '$lib/db';
import { hashSenha, verificarDesafio2FA, criarSessao } from '$lib/auth';
import { enviarSenhaProvisoria } from '$lib/server/email';
import {
	executeLoginPassword,
	LOGIN_WINDOW_MINUTES,
	type AdminModulo
} from '$lib/server/auth-login-flow';
import { cookieOptionsLogin } from '$lib/server/login-helpers';
import { administradores, policiais } from '$lib/server/schema';
import { loginSchema } from '$lib/schemas';

const cookieOptions = cookieOptionsLogin;

function gerarSenhaProvisoria(): string {
	const letras = 'ABCDEFGHJKMNPQRSTUVWXYZ';
	const digitos = '23456789';
	const todos = letras + digitos;
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => todos[b % todos.length])
		.join('');
}

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

		const result = await executeLoginPassword(db, ip, platform, parsed.data, {
			formAdminModulo: adminModulo
		});

		if (result.outcome === 'rate_limited') {
			return fail(429, {
				error: `Muitas tentativas. Tente em ${LOGIN_WINDOW_MINUTES} minutos.`,
				fields: { matricula, tipo }
			});
		}

		if (result.outcome === 'error') {
			return fail(result.httpStatus as 400 | 401 | 429 | 500, {
				error: result.message,
				fields: result.fields ?? { matricula, tipo }
			});
		}

		if (result.outcome === '2fa') {
			if (result.setAdminModuloPendingCookie) {
				cookies.set('admin_modulo_pending', adminModulo, { ...cookieOptions(url), maxAge: 15 * 60 });
			}
			return {
				pendente2FA: true,
				desafioId: result.desafioId,
				nome: result.nome,
				primeiro_acesso: result.primeiro_acesso,
				emailMascarado: result.emailMascarado,
				tipoUsuario2FA: result.tipoUsuario2FA
			};
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
			primeiro_acesso: result.primeiro_acesso,
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

		const resultado = await verificarDesafio2FA(db, desafioId, String(codigo));

		if (resultado === 'expirado') {
			return fail(401, { error: 'Código expirado. Faça login novamente.', expirado: true });
		}
		if (resultado === 'esgotado') {
			return fail(429, { error: 'Muitas tentativas incorretas. Faça login novamente.', esgotado: true });
		}
		if (!resultado) {
			return fail(401, { error: 'Código inválido. Verifique e tente novamente.' });
		}

		const { tipo, usuarioId } = resultado;

		let primeiroAcesso = false;
		if (tipo === 'admin') {
			const admin = await db.select().from(administradores).where(eq(administradores.id, usuarioId)).get();
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

	solicitarPrimeiroAcesso: async ({ request, platform }) => {
		const db = getDB(platform);
		const formData = await request.formData();
		const matricula = formData.get('matricula') as string;

		if (!matricula || typeof matricula !== 'string') {
			return fail(400, { error: 'Matrícula inválida.' });
		}

		const policial = await db
			.select()
			.from(policiais)
			.where(and(eq(policiais.matricula, matricula.trim()), eq(policiais.ativo, 1)))
			.get();

		const respostaGenerica = { success: true, enviado: true };

		if (!policial) return respostaGenerica;
		if (policial.primeiro_acesso !== 1) return respostaGenerica;
		if (!policial.email) {
			return fail(422, { error: 'Nenhum e-mail cadastrado para esta matrícula.' });
		}

		const senhaProvisoria = gerarSenhaProvisoria();
		const senhaHash = await hashSenha(senhaProvisoria);
		await db.update(policiais).set({ senha: senhaHash }).where(eq(policiais.id, policial.id));

		try {
			await enviarSenhaProvisoria(policial.email, senhaProvisoria, policial.nome, platform);
		} catch (err) {
			console.error('[primeiro-acesso] Falha ao enviar e-mail:', err);
			return fail(500, { error: 'Falha ao enviar e-mail. Tente novamente.' });
		}

		return respostaGenerica;
	}
};
