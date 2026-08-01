import { error, fail, redirect } from '@sveltejs/kit';
import { getDB, registrarAceite, registrarAuditComContexto } from '$lib/db';
import {
	CONTEUDO_HTML,
	VERSAO,
	VIGENTE_DESDE,
	calcularHashTermo
} from '$lib/server/termo/termo-vigente';
import { sanitizeTermoHtml } from '$lib/server/termo/sanitize';
import { invalidarSessaoCache } from '$lib/server/auth/session-cache';
import { obterRotaBemVindo } from '$lib/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');

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
		if (!u) error(401, 'Não autorizado');

		// Aceite ÚNICO e implícito (v1.3): o próprio envio deliberado do formulário
		// (clique em "Li e aceito", com o campo `confirmado`) É a manifestação de
		// vontade. As antigas caixas separadas (termo/LGPD/assinatura/e-mail/GPS)
		// foram unificadas: o tratamento de dados não depende mais de consentimento
		// (base legal = obrigação legal/competências, cláusula 3.1 do termo), e a
		// única exigência de manifestação expressa — a aceitação da assinatura
		// avançada — está coberta pelo aceite único (cláusula 7).
		const form = await request.formData();
		const confirmado = form.get('confirmado') === 'true' || form.get('confirmado') === 'on';
		if (!confirmado) {
			return fail(400, { erro: 'Não foi possível registrar o aceite. Tente novamente.' });
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
			// Aceite único: todas as condições do termo vigente ficam cobertas por
			// esta manifestação. Mantemos os flags históricos em `true` por
			// compatibilidade com a tabela/relatórios de aceite.
			aceitou_lgpd: true,
			aceitou_uso_email: true,
			aceitou_uso_localizacao: true,
			aceitou_assinatura_avancada: true,
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
			detalhes: `Versão ${VERSAO} (hash ${hash.slice(0, 16)}…)`,
			ip,
			user_agent: ua,
			env: platform?.env
		});

		// O cache edge de sessão guarda `aceiteVigente` — sem invalidar aqui,
		// o redirect abaixo voltaria para /aceitar-termo por até 60s.
		await invalidarSessaoCache(cookies.get('session_token'));

		// Redireciona para a página de boas-vindas correta (mesmo destino do
		// pós-login), conforme tipo de usuário e módulo admin selecionado.
		const adminModulo = cookies.get('admin_modulo');
		redirect(303, obterRotaBemVindo(u, adminModulo));
	}
};
