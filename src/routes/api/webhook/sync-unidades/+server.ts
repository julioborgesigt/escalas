import { json, type RequestHandler } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { upsertUnidade, buscarUnidadePorNome } from '$lib/db/unidades';

export const POST: RequestHandler = async ({ request, platform }) => {
	const authHeader = request.headers.get('Authorization');
	const SYNC_TOKEN = (platform?.env as any)?.SYNC_TOKEN;

	if (!SYNC_TOKEN || authHeader !== `Bearer ${SYNC_TOKEN}`) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	try {
		const payload = await request.json();
		const db = getDB(platform);

		const data = Array.isArray(payload) ? payload : [payload];
		
		// 1. Processar todas as SECCIONAIS primeiro para garantir que os pais existam
		const seccionais = data.filter(item => !item.unidade || String(item.unidade).trim() === '');
		for (const item of seccionais) {
			const nomeSec = String(item.seccional || '').trim();
			if (!nomeSec) continue;
			
			await upsertUnidade(db, {
				nome: nomeSec,
				tipo: 'seccional',
				seccional_id: null,
				cidade: String(item.cidade || '').trim()
			});
		}

		// 2. Processar as DELEGACIAS
		const delegacias = data.filter(item => item.unidade && String(item.unidade).trim() !== '');
		let successCount = seccionais.length;
		const errors: string[] = [];

		for (const item of delegacias) {
			try {
				const nomeUni = String(item.unidade || '').trim();
				const nomeSec = String(item.seccional || '').trim();
				
				let seccionalId: number | null = null;
				if (nomeSec) {
					const sec = await buscarUnidadePorNome(db, nomeSec);
					if (sec && sec.tipo === 'seccional') {
						seccionalId = sec.id;
					}
				}

				await upsertUnidade(db, {
					nome: nomeUni,
					tipo: 'delegacia',
					seccional_id: seccionalId,
					cidade: String(item.cidade || '').trim()
				});
				successCount++;
			} catch (err: any) {
				errors.push(`Erro na unidade ${item.unidade}: ${err.message}`);
			}
		}

		return json({
			success: true,
			processed: data.length,
			imported: successCount,
			errors: errors.length > 0 ? errors : undefined
		});
	} catch (err: any) {
		return json({ error: 'Erro ao processar payload', details: err.message }, { status: 400 });
	}
};
