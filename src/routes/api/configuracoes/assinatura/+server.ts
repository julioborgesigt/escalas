import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarExigirFotoAssinatura, buscarExigirGpsAssinatura, buscarExigirCodigoEmailAssinatura, salvarConfiguracao } from '$lib/db';

export const GET: RequestHandler = async ({ platform }) => {
	const db = getDB(platform);
	const [exigirFoto, exigirGps, exigirCodigoEmail] = await Promise.all([
		buscarExigirFotoAssinatura(db),
		buscarExigirGpsAssinatura(db),
		buscarExigirCodigoEmailAssinatura(db)
	]);
	return json({ exigirFoto, exigirGps, exigirCodigoEmail });
};

export const PUT: RequestHandler = async ({ platform, request, locals }) => {
	if (locals.usuario?.tipo !== 'admin') {
		return json({ error: 'Acesso negado' }, { status: 403 });
	}

	const body = await request.json().catch(() => ({}));
	const db = getDB(platform);

	const saves: Promise<void>[] = [];
	if (typeof body.exigirFoto === 'boolean') {
		saves.push(salvarConfiguracao(db, 'exigir_foto_assinatura', body.exigirFoto ? '1' : '0'));
	}
	if (typeof body.exigirGps === 'boolean') {
		saves.push(salvarConfiguracao(db, 'exigir_gps_assinatura', body.exigirGps ? '1' : '0'));
	}
	if (typeof body.exigirCodigoEmail === 'boolean') {
		saves.push(salvarConfiguracao(db, 'exigir_codigo_email_assinatura', body.exigirCodigoEmail ? '1' : '0'));
	}
	if (saves.length === 0) {
		return json({ error: 'Nenhum campo válido para salvar' }, { status: 400 });
	}

	await Promise.all(saves);
	return json({ ok: true });
};
