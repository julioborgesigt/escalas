import { error, fail, redirect } from '@sveltejs/kit';
import { getDB, registrarAceite, registrarAuditComContexto } from '$lib/db';
import {
	CONTEUDO_HTML,
	VERSAO,
	VIGENTE_DESDE,
	calcularHashTermo
} from '$lib/server/termo/termo-vigente';
import { sanitizeTermoHtml } from '$lib/server/termo/sanitize';
import { invalidarSessaoCache } from '$lib/server/session-cache';
import { obterRotaBemVindo } from '$lib/auth';
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
	aceitar: async ({ request, locals, platform, cookies, getClientAddress }) => {
		const u = locals.usuario;
		if (!u) throw error(401, 'Não autorizado');

		const form = await request.formData();
		const aceitouTermo = form.get('aceitou_termo') === 'on' || form.get('aceitou_termo') === 'true';
		const aceitouLgpd = form.get('aceitou_lgpd') === 'on' || form.get('aceitou_lgpd') === 'true';
		const aceitouAssinatura =
			form.get('aceitou_assinatura_avancada') === 'on' ||
			form.get('aceitou_assinatura_avancada') === 'true';
		const aceitouEmail =
			form.get('aceitou_uso_email') === 'on' || form.get('aceitou_uso_email') === 'true';
		const aceitouLocalizacao =
			form.get('aceitou_uso_localizacao') === 'on' ||
			form.get('aceitou_uso_localizacao') === 'true';
		if (!aceitouTermo || !aceitouLgpd || !aceitouAssinatura) {
			return fail(400, { erro: 'É necessário marcar as três caixas obrigatórias de aceite.' });
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
			aceitou_assinatura_avancada: aceitouAssinatura,
			ip,
			user_agent: ua,
			// Snapshot do HTML servido. Em juizo, reproduzimos o texto exato
			// que o usuario viu sem depender do git history. ~10 KB.
			conteudo_html_snapshot: sanitizeTermoHtml(CONTEUDO_HTML)
		});

		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'aceitar_termos',
			entidade: 'termo_uso',
			detalhes: `Versão ${VERSAO} (hash ${hash.slice(0, 16)}…)`
		});

		// O cache edge de sessão guarda `aceiteVigente` — sem invalidar aqui,
		// o redirect abaixo voltaria para /aceitar-termo por até 60s.
		await invalidarSessaoCache(cookies.get('session_token'));

		// Redireciona para a página de boas-vindas correta (mesmo destino do
		// pós-login), conforme tipo de usuário e módulo admin selecionado.
		const adminModulo = cookies.get('admin_modulo');
		throw redirect(303, obterRotaBemVindo(u, adminModulo));
	}
};
