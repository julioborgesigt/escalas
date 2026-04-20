import { json, type RequestHandler } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { upsertUnidade, buscarUnidadePorNome } from '$lib/db/unidades';
import { timingSafeEqual } from 'node:crypto';

function bearerTokenValido(authHeader: string | null, expectedToken: string): boolean {
	const expected = `Bearer ${expectedToken}`;
	const a = Buffer.from((authHeader ?? '').padEnd(expected.length, ' ').slice(0, expected.length));
	const b = Buffer.from(expected);
	const valueMatch = timingSafeEqual(a, b) ? 1 : 0;
	const lenMatch = (authHeader ?? '').length === expected.length ? 1 : 0;
	return (valueMatch & lenMatch) === 1;
}

type SyncNivel = 'DEPARTAMENTO' | 'SUB_DEPARTAMENTO' | 'SECCIONAL' | 'DELEGACIA';

function parseNivel(item: Record<string, unknown>): SyncNivel | null {
	const raw = String(item.nivel ?? item.NIVEL ?? '').trim().toUpperCase();
	if (raw === 'DEPARTAMENTO' || raw === 'SUB_DEPARTAMENTO' || raw === 'SECCIONAL' || raw === 'DELEGACIA') {
		return raw;
	}
	return null;
}

function trimCol(item: Record<string, unknown>, key: string): string {
	return String(item[key] ?? '').trim();
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const authHeader = request.headers.get('Authorization');
	const SYNC_TOKEN = (platform?.env as { SYNC_TOKEN?: string })?.SYNC_TOKEN;

	if (!SYNC_TOKEN || !bearerTokenValido(authHeader, SYNC_TOKEN)) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	try {
		const payload = await request.json();
		const db = getDB(platform);

		const data = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];

		const departamentos: Record<string, unknown>[] = [];
		const subDepartamentos: Record<string, unknown>[] = [];
		const seccionais: Record<string, unknown>[] = [];
		const delegacias: Record<string, unknown>[] = [];

		for (const item of data) {
			const nivel = parseNivel(item);
			const colUnidade = trimCol(item, 'unidade');
			const colSeccional = trimCol(item, 'seccional');

			if (nivel === 'DEPARTAMENTO') {
				if (!colSeccional) continue;
				departamentos.push(item);
				continue;
			}
			if (nivel === 'SUB_DEPARTAMENTO') {
				if (!colUnidade || !colSeccional) continue;
				subDepartamentos.push(item);
				continue;
			}
			if (nivel === 'SECCIONAL') {
				if (!colSeccional) continue;
				// Raiz: A vazio, B = nome da seccional (igual ao legado)
				if (!colUnidade) {
					seccionais.push({ ...item, __legacyRaiz: true });
				} else {
					seccionais.push(item);
				}
				continue;
			}
			if (nivel === 'DELEGACIA') {
				if (!colUnidade || !colSeccional) continue;
				delegacias.push(item);
				continue;
			}

			// Legado (sem coluna nivel): A vazio + B = seccional raiz; A + B = delegacia
			if (!colUnidade && colSeccional) {
				seccionais.push({ ...item, seccional: colSeccional, unidade: '', __legacyRaiz: true });
			} else if (colUnidade && colSeccional) {
				delegacias.push(item);
			}
		}

		let successCount = 0;
		const errors: string[] = [];

		// 1) Departamentos (raiz)
		for (const item of departamentos) {
			const nome = trimCol(item, 'seccional');
			if (!nome) continue;
			try {
				await upsertUnidade(db, {
					nome,
					tipo: 'departamento',
					seccional_id: null,
					cidade: trimCol(item, 'cidade')
				});
				successCount++;
			} catch (err: unknown) {
				errors.push(`Departamento ${nome}: ${messageFromUnknown(err)}`);
			}
		}

		// 2) Subdepartamentos (pai obrigatoriamente departamento)
		for (const item of subDepartamentos) {
			const nome = trimCol(item, 'unidade');
			const nomePai = trimCol(item, 'seccional');
			if (!nome || !nomePai) continue;
			try {
				const pai = await buscarUnidadePorNome(db, nomePai);
				if (!pai || pai.tipo !== 'departamento') {
					errors.push(`Subdepartamento ${nome}: pai "${nomePai}" não é um departamento cadastrado.`);
					continue;
				}
				await upsertUnidade(db, {
					nome,
					tipo: 'sub_departamento',
					seccional_id: pai.id,
					cidade: trimCol(item, 'cidade')
				});
				successCount++;
			} catch (err: unknown) {
				errors.push(`Subdepartamento ${nome}: ${messageFromUnknown(err)}`);
			}
		}

		// 3) Seccionais (com ou sem pai organizacional)
		for (const item of seccionais) {
			const legacyRaiz = Boolean(item.__legacyRaiz);
			const nomeSec = legacyRaiz ? trimCol(item, 'seccional') : trimCol(item, 'unidade');
			const nomeOrgPai = legacyRaiz ? '' : trimCol(item, 'seccional');

			if (!nomeSec) continue;

			try {
				let parentId: number | null = null;
				if (nomeOrgPai) {
					const org = await buscarUnidadePorNome(db, nomeOrgPai);
					if (!org || (org.tipo !== 'departamento' && org.tipo !== 'sub_departamento')) {
						errors.push(
							`Seccional ${nomeSec}: organização pai "${nomeOrgPai}" não encontrada ou não é departamento/subdepartamento.`
						);
						continue;
					}
					parentId = org.id;
				}

				await upsertUnidade(db, {
					nome: nomeSec,
					tipo: 'seccional',
					seccional_id: parentId,
					cidade: trimCol(item, 'cidade')
				});
				successCount++;
			} catch (err: unknown) {
				errors.push(`Seccional ${nomeSec}: ${messageFromUnknown(err)}`);
			}
		}

		// 4) Delegacias (pai = seccional)
		for (const item of delegacias) {
			try {
				const nomeUni = trimCol(item, 'unidade');
				const nomeSec = trimCol(item, 'seccional');
				if (!nomeUni || !nomeSec) continue;

				const sec = await buscarUnidadePorNome(db, nomeSec);
				if (!sec || sec.tipo !== 'seccional') {
					errors.push(`Delegacia ${nomeUni}: seccional "${nomeSec}" não encontrada ou não é seccional.`);
					continue;
				}

				await upsertUnidade(db, {
					nome: nomeUni,
					tipo: 'delegacia',
					seccional_id: sec.id,
					cidade: trimCol(item, 'cidade')
				});
				successCount++;
			} catch (err: unknown) {
				errors.push(`Delegacia ${trimCol(item, 'unidade')}: ${messageFromUnknown(err)}`);
			}
		}

		return json({
			success: true,
			processed: data.length,
			imported: successCount,
			errors: errors.length > 0 ? errors : undefined
		});
	} catch (err: unknown) {
		return json({ error: 'Erro ao processar payload', details: messageFromUnknown(err) }, { status: 400 });
	}
};

function messageFromUnknown(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
