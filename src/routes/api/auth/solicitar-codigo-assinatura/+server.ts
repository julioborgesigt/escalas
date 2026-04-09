import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { policiais } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { gerarCodigo2FA, criarDesafio2FA } from '$lib/auth';
import { enviarCodigo2FA } from '$lib/server/email';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, locals }) => {
	const db = getDB(platform);
	const u = locals.usuario;

	if (!u) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	// Recuperar o usuário do DB para confirmar o e-mail (ou checar u.email se o schema estivesse na tipagem do usuario logado)
	const row = await db.select({ email: policiais.email }).from(policiais).where(eq(policiais.id, u.id)).get();

	if (!row || !row.email) {
		return json({ error: 'Você não possui um e-mail cadastrado. Atualize o seu perfil para prosseguir com assinaturas.' }, { status: 400 });
	}

	const codigo = gerarCodigo2FA();
	const desafioId = await criarDesafio2FA(db, 'assinatura', u.id, codigo);

	try {
		await enviarCodigo2FA(row.email, codigo, u.nome, platform);
	} catch (err) {
		console.error('[Assinatura 2FA] Falha ao enviar e-mail:', err);
		return json({ error: 'Falha ao enviar código de verificação para seu e-mail. Tente novamente mais tarde.' }, { status: 500 });
	}

	return json({
		success: true,
		desafioId,
		emailMascarado: mascararEmail(row.email)
	});
};

function mascararEmail(email: string): string {
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
		masked = local.slice(0, showStart) + '*'.repeat(local.length - showStart - 1) + local[local.length - 1];
	}
	return masked + '@' + domain;
}
