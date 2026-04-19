import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, salvarConfiguracao } from '$lib/db';
import { assinaturaConfigSchema } from '$lib/schemas';
import { invalidarFlagsAssinatura, lerFlagsAssinatura } from '$lib/server/cfg-ass-cache';

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
	if (locals.usuario?.tipo !== 'admin') {
		return json({ error: 'Acesso negado' }, { status: 403 });
	}

	const body = await request.json().catch(() => ({}));
	const parsed = assinaturaConfigSchema.safeParse(body);

	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}

	const db = getDB(platform);
	const data = parsed.data;
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

	if (saves.length === 0) {
		return json({ error: 'Nenhum campo válido para salvar' }, { status: 400 });
	}

	await Promise.all(saves);

	// Invalida o cache edge server-side para que toda assinatura subsequente
	// leia os novos valores do D1 (não mais do cliente).
	await invalidarFlagsAssinatura();

	return json({ ok: true });
};
