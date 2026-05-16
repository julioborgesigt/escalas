import { error, fail, redirect } from '@sveltejs/kit';
import { getDB, registrarAceite, registrarAuditComContexto } from '$lib/db';
import { CONTEUDO_HTML, VERSAO, VIGENTE_DESDE, calcularHashTermo } from '$lib/server/termo/termo-vigente';
import { sanitizeTermoHtml } from '$lib/server/termo/sanitize';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const hash = await calcularHashTermo();
	return {
		versao: VERSAO,
		vigenteDesde: VIGENTE_DESDE,
		conteudoHtml: sanitizeTermoHtml(CONTEUDO_HTML),
		hash
	};
};

export const actions: Actions = {
	aceitar: async ({ request, locals, platform, getClientAddress }) => {
		const u = locals.usuario;
		if (!u) throw error(401, 'Não autorizado');

		const form = await request.formData();
		const aceitouTermo = form.get('aceitou_termo') === 'on' || form.get('aceitou_termo') === 'true';
		const aceitouLgpd = form.get('aceitou_lgpd') === 'on' || form.get('aceitou_lgpd') === 'true';
		const aceitouEmail = form.get('aceitou_uso_email') === 'on' || form.get('aceitou_uso_email') === 'true';
		const aceitouLocalizacao = form.get('aceitou_uso_localizacao') === 'on' || form.get('aceitou_uso_localizacao') === 'true';
		if (!aceitouTermo || !aceitouLgpd) {
			return fail(400, { erro: 'É necessário marcar as duas caixas obrigatórias de aceite.' });
		}

		const db = getDB(platform);
		const hash = await calcularHashTermo();
		const ip = getClientAddress();
		const ua = request.headers.get('user-agent') || '';

		await registrarAceite(db, {
			usuario_tipo: u.tipo,
			usuario_id: u.id,
			versao_termo: VERSAO,
			hash_termo: hash,
			aceitou_lgpd: aceitouLgpd,
			aceitou_uso_email: aceitouEmail,
			aceitou_uso_localizacao: aceitouLocalizacao,
			ip,
			user_agent: ua
		});

		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'aceitar_termos',
			entidade: 'termo_uso',
			detalhes: `Versão ${VERSAO} (hash ${hash.slice(0, 16)}…)`
		});

		// Redireciona para a área principal conforme tipo de usuário.
		throw redirect(303, u.tipo === 'admin' ? '/painel' : '/escalas');
	}
};
