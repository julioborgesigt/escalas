import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { policiais, administradores } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { gerarCodigo2FA, criarDesafio2FA } from '$lib/auth';
import { enviarCodigo2FA } from '$lib/server/email';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ platform, locals, url }) => {
	try {
		const db = getDB(platform);
		const u = locals.usuario;

		if (!u) {
			console.error('[Assinatura 2FA] Usuário não encontrado em locals.usuario. Path:', url.pathname);
			return json({ error: 'Sessão inválida ou expirada. Faça login novamente.' }, { status: 401 });
		}

		// Recuperar o usuário do DB para confirmar o e-mail
		let email: string | null = null;
		if (u.tipo === 'policial') {
			const row = await db.select({ email: policiais.email }).from(policiais).where(eq(policiais.id, u.id)).get();
			email = row?.email ?? null;
		} else {
			const row = await db.select({ email: administradores.email }).from(administradores).where(eq(administradores.id, u.id)).get();
			email = row?.email ?? null;
		}

		if (!email) {
			console.warn(`[Assinatura 2FA] Email não encontrado para usuário ID ${u.id} (${u.tipo})`);
			return json({ error: `Você não possui um e-mail cadastrado (ID: ${u.id}, Tipo: ${u.tipo}). Atualize o seu perfil para prosseguir.` }, { status: 400 });
		}

		const codigo = gerarCodigo2FA();
		const desafioId = await criarDesafio2FA(db, 'assinatura', u.id, codigo);

		try {
			await enviarCodigo2FA(email, codigo, u.nome, platform);
		} catch (err: any) {
			console.error('[Assinatura 2FA] Falha ao enviar e-mail:', err);
			return json({ error: `Falha no envio de e-mail (SMTP): ${err.message || 'Erro desconhecido'}` }, { status: 500 });
		}

		return json({
			success: true,
			desafioId,
			emailMascarado: mascararEmail(email)
		});
	} catch (err: any) {
		console.error('[Assinatura 2FA] Erro crítico no handler:', err);
		return json({
			error: `Ocorreu um erro ao processar a solicitação: ${err.message || 'Erro interno'}`
		}, { status: 500 });
	}
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
