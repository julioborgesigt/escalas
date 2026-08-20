/**
 * POST/DELETE /api/perfil/rubrica
 *
 * Cadastro (POST) e exclusão (DELETE) da rubrica reutilizável do policial,
 * usada como elemento gráfico na assinatura por Token A3 no computador.
 *
 * LGPD:
 *  - O armazenamento reutilizável da rubrica é uma finalidade própria; o cliente
 *    DEVE enviar `consentimento: true` (Art. 8º) — registrado em
 *    `rubrica_consentimento_em`.
 *  - O titular pode excluir a qualquer momento (Art. 18) via DELETE, que zera os
 *    três campos.
 *  - A imagem chega já processada e minimizada no cliente (PNG transparente, sem
 *    EXIF); aqui só validamos formato/tamanho e persistimos.
 */

import type { RequestHandler } from './$types';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDB, auditar, contextoDeEvento } from '$lib/db';
import { policiais } from '$lib/server/schema';
import { requireAuth, badRequest, forbidden, validateBody, serverError } from '$lib/server/api';
import { detectarTipo } from '$lib/server/assinatura/selfie-upload';

/** Teto do dataURL PNG (~600 KB) — rubricas legítimas ficam muito abaixo disso. */
const MAX_RUBRICA_CHARS = 600 * 1024;

const rubricaSchema = z.object({
	rubrica: z
		.string()
		.startsWith('data:image/png;base64,', { message: 'A rubrica deve ser um PNG transparente.' })
		.max(MAX_RUBRICA_CHARS, { message: 'Rubrica muito grande.' }),
	consentimento: z.literal(true, {
		message: 'É necessário consentir com o registro da rubrica.'
	})
});

export const POST: RequestHandler = async (event) => {
	const { locals, platform, request } = event;
	const u = requireAuth(locals);
	if (u instanceof Response) return u;
	if (u.tipo !== 'policial') {
		return forbidden('Apenas policiais possuem rubrica cadastrável.');
	}

	const validated = await validateBody(request, rubricaSchema);
	if (!validated.ok) return validated.response;
	const { rubrica } = validated.data;

	// Sanidade do base64 (evita persistir lixo que quebraria o carimbo no PDF).
	const b64 = rubrica.slice('data:image/png;base64,'.length);
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length < 100) {
		return badRequest('Conteúdo da rubrica inválido.');
	}

	// O prefixo `data:image/png` é declaração do cliente; os magic bytes são a
	// evidência. Mesma checagem que a selfie faz desde que o upload dela foi
	// endurecido — aqui faltava, e bytes arbitrários eram persistidos e depois
	// entregues ao carimbador de PDF.
	if (detectarTipo(Buffer.from(b64, 'base64')) !== 'png') {
		return badRequest('A rubrica deve ser um PNG transparente.');
	}

	const agora = new Date().toISOString();
	const db = getDB(platform);
	try {
		await db
			.update(policiais)
			.set({
				rubrica,
				rubrica_atualizada_em: agora,
				rubrica_consentimento_em: agora
			})
			.where(eq(policiais.id, u.id));
	} catch (e) {
		return serverError('salvar rubrica do perfil', e);
	}

	const { contexto, env } = contextoDeEvento(event);
	await auditar(
		db,
		{
			acao: 'rubrica_cadastrada',
			usuario: u,
			entidade: 'policial',
			entidade_id: u.id,
			alvo_tipo: 'policial',
			alvo_id: u.id,
			alvo_nome: u.nome,
			detalhes: 'Cadastro/atualização da rubrica reutilizável (com consentimento)',
			...contexto
		},
		{ env }
	);

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
};

export const DELETE: RequestHandler = async (event) => {
	const { locals, platform } = event;
	const u = requireAuth(locals);
	if (u instanceof Response) return u;
	if (u.tipo !== 'policial') {
		return forbidden('Apenas policiais possuem rubrica cadastrável.');
	}

	const db = getDB(platform);
	try {
		await db
			.update(policiais)
			.set({ rubrica: null, rubrica_atualizada_em: null, rubrica_consentimento_em: null })
			.where(eq(policiais.id, u.id));
	} catch (e) {
		return serverError('excluir rubrica do perfil', e);
	}

	const { contexto, env } = contextoDeEvento(event);
	await auditar(
		db,
		{
			acao: 'rubrica_excluida',
			usuario: u,
			entidade: 'policial',
			entidade_id: u.id,
			alvo_tipo: 'policial',
			alvo_id: u.id,
			alvo_nome: u.nome,
			detalhes: 'Exclusão da rubrica reutilizável a pedido do titular (LGPD Art. 18)',
			...contexto
		},
		{ env }
	);

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
};
