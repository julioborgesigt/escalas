/**
 * POST /api/auth/primeiro-acesso
 *
 * Gera uma senha provisória e envia por e-mail para policiais com primeiro_acesso = 1.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB } from '$lib/db';
import { hashSenha } from '$lib/auth';
import { enviarSenhaProvisoria } from '$lib/server/email';
import { policiais } from '$lib/server/schema';
import { and, eq } from 'drizzle-orm';

function gerarSenhaProvisoria(): string {
	// 8 chars: 4 letras maiúsculas + 4 dígitos embaralhados
	// Evita caracteres ambíguos: 0, O, 1, I, L
	const letras = 'ABCDEFGHJKMNPQRSTUVWXYZ';
	const digitos = '23456789';
	const todos = letras + digitos;
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => todos[b % todos.length])
		.join('');
}

export const POST: RequestHandler = async ({ platform, request }) => {
	const db = getDB(platform);
	const body = await request.json().catch(() => ({}));
	const { matricula } = body;

	if (!matricula || typeof matricula !== 'string') {
		return json({ error: 'Matrícula inválida.' }, { status: 400 });
	}

	const policial = await db
		.select()
		.from(policiais)
		.where(and(eq(policiais.matricula, matricula.trim()), eq(policiais.ativo, 1)))
		.get();

	// Resposta genérica para não revelar se a matrícula existe
	const respostaGenerica = json({
		ok: true,
		message: 'Se a matrícula estiver cadastrada com e-mail e for primeiro acesso, você receberá a senha por e-mail.'
	});

	if (!policial) return respostaGenerica;
	if (policial.primeiro_acesso !== 1) return respostaGenerica;
	if (!policial.email) {
		return json(
			{ error: 'Nenhum e-mail cadastrado para esta matrícula. Contate o administrador.' },
			{ status: 422 }
		);
	}

	const senhaProvisoria = gerarSenhaProvisoria();
	const senhaHash = await hashSenha(senhaProvisoria);

	await db.update(policiais).set({ senha: senhaHash }).where(eq(policiais.id, policial.id));

	try {
		await enviarSenhaProvisoria(policial.email, senhaProvisoria, policial.nome, platform);
	} catch (err) {
		console.error('[primeiro-acesso] Falha ao enviar e-mail:', err);
		return json(
			{ error: 'Falha ao enviar e-mail. Tente novamente ou contate o administrador.' },
			{ status: 500 }
		);
	}

	return respostaGenerica;
};
