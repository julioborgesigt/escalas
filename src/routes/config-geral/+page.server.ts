/**
 * Configurações Gerais (Admin Geral).
 *
 * Por ora: escolha do provedor de e-mail PADRÃO (Cloudflare ou Resend). O outro
 * provedor assume automaticamente por fallback quando o padrão falha ou
 * extrapola a cota — útil para isolar problemas de entrega (ex.: link de
 * primeiro acesso) a um provedor específico.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getDB,
	salvarConfiguracao,
	buscarProvedorEmailPadrao,
	EMAIL_PROVEDOR_PADRAO,
	auditar,
	contextoDeEvento,
	type EmailProvedor
} from '$lib/db';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.usuario?.isSuperAdmin) redirect(302, '/');

	const db = getDB(platform);
	const provedorEmail = await buscarProvedorEmailPadrao(db);

	// Sinaliza na UI se o Resend está configurado (sem expor a chave).
	const env = platform?.env as Record<string, string | undefined> | undefined;
	const resendConfigurado = !!env?.RESEND_API_KEY?.trim();

	return { provedorEmail, resendConfigurado };
};

export const actions: Actions = {
	salvarEmail: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u || !u.isSuperAdmin)
			return fail(403, { error: 'Acesso restrito ao Super Administrador' });

		const data = await request.formData();
		const provedor = String(data.get('provedor') ?? '');
		if (provedor !== 'cloudflare' && provedor !== 'resend') {
			return fail(400, { error: 'Provedor inválido' });
		}

		const db = getDB(platform);
		const anterior = await buscarProvedorEmailPadrao(db);
		if (anterior === provedor) return { success: true, provedorEmail: provedor };

		await salvarConfiguracao(db, EMAIL_PROVEDOR_PADRAO, provedor);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'salvar_config_geral',
				usuario: u,
				entidade: 'configuracao',
				detalhes: `Provedor de e-mail padrão alterado de ${anterior} para ${provedor}`,
				dados_antes: { email_provedor_padrao: anterior },
				dados_depois: { email_provedor_padrao: provedor as EmailProvedor },
				...contexto
			},
			{ env }
		);

		return { success: true, provedorEmail: provedor };
	}
};
