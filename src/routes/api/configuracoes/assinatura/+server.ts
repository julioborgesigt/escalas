import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, salvarConfiguracao } from '$lib/db';
import { assinaturaConfigSchema } from '$lib/schemas';
import { invalidarFlagsAssinatura, lerFlagsAssinatura } from '$lib/server/cfg-ass-cache';
import { requireAdmin, badRequest, validateBody } from '$lib/server/api';

export const GET: RequestHandler = async ({ platform }) => {
	const flags = await lerFlagsAssinatura(platform);
	return json({
		exigirFoto: flags.exigirFotoAssinatura,
		exigirGps: flags.exigirGpsAssinatura,
		exigirCodigoEmail: flags.exigirCodigoEmailAssinatura,
		restringirSmartphone: flags.restringirSmartphone
	});
};

export const PUT: RequestHandler = async ({ platform, request, locals }) => {
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const v = await validateBody(request, assinaturaConfigSchema);
	if (!v.ok) return v.response;

	const db = getDB(platform);
	const data = v.data;
	const saves: Promise<void>[] = [];

	if (data.exigirFoto !== undefined) {
		saves.push(salvarConfiguracao(db, 'exigir_foto_assinatura', data.exigirFoto ? '1' : '0'));
	}
	if (data.exigirGps !== undefined) {
		saves.push(salvarConfiguracao(db, 'exigir_gps_assinatura', data.exigirGps ? '1' : '0'));
	}
	if (data.exigirCodigoEmail !== undefined) {
		saves.push(
			salvarConfiguracao(db, 'exigir_codigo_email_assinatura', data.exigirCodigoEmail ? '1' : '0')
		);
	}
	if (data.restringirSmartphone !== undefined) {
		saves.push(salvarConfiguracao(db, 'restringir_smartphone', data.restringirSmartphone ? '1' : '0'));
	}

	if (saves.length === 0) return badRequest('Nenhum campo válido para salvar');

	await Promise.all(saves);

	// Invalida o cache edge server-side para que toda assinatura subsequente
	// leia os novos valores do D1 (não mais do cliente).
	await invalidarFlagsAssinatura();

	return json({ ok: true });
};
