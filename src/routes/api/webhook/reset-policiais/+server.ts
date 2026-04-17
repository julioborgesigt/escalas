import { json, type RequestHandler } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { timingSafeEqual } from 'node:crypto';
import {
	policiais,
	unidades,
	giseEscalas,
	giseSeccionais,
	giseEquipes,
	giseMembros,
	gisePresencas,
	giseRespostasFormulario,
	giseAssinaturasRelatorios,
	giseSeccionalUnidades,
	escalaPoliciais,
	escalas,
	giseDocumentos,
	escalaDocumentos
} from '$lib/server/schema';

function bearerTokenValido(authHeader: string | null, expectedToken: string): boolean {
	const expected = `Bearer ${expectedToken}`;
	const a = Buffer.from((authHeader ?? '').padEnd(expected.length, ' ').slice(0, expected.length));
	const b = Buffer.from(expected);
	const valueMatch = timingSafeEqual(a, b) ? 1 : 0;
	const lenMatch = (authHeader ?? '').length === expected.length ? 1 : 0;
	return (valueMatch & lenMatch) === 1;
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const authHeader = request.headers.get('Authorization');
	const SYNC_TOKEN = (platform?.env as any)?.SYNC_TOKEN;

	if (!SYNC_TOKEN || !bearerTokenValido(authHeader, SYNC_TOKEN)) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	try {
		const db = getDB(platform);
		
		// IMPORTANTE: Limpeza profunda em ordem reversa de dependência
		// 1. Tabelas de transação e logs
		await db.delete(gisePresencas);
		await db.delete(giseRespostasFormulario);
		await db.delete(giseAssinaturasRelatorios);
		await db.delete(giseDocumentos);
		await db.delete(escalaDocumentos);
		
		// 2. Hierarquia GISE
		await db.delete(giseMembros);
		await db.delete(giseEquipes);
		await db.delete(giseSeccionalUnidades);
		await db.delete(giseSeccionais);
		await db.delete(giseEscalas);
		
		// 3. Escalas antigas
		await db.delete(escalaPoliciais);
		await db.delete(escalas);

		// 4. Tabelas base (Unidades e Policiais)
		await db.delete(policiais);
		await db.delete(unidades);

		return json({ 
			success: true, 
			message: 'Banco de dados resetado com sucesso (Tabelas operacionais, Policiais e Unidades limpas).' 
		});
	} catch (err: any) {
		return json({ error: 'Erro ao limpar banco de dados', details: err.message }, { status: 500 });
	}
};
