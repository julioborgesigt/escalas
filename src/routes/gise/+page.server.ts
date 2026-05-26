import type { PageServerLoad, Actions } from './$types';
import { redirect, fail } from '@sveltejs/kit';
import { getDB, listarGiseEscalas, buscarGiseAtiva, criarGiseEscala, clonarGiseParaData, upsertGiseSeccional } from '$lib/db';
import { isAdminGeral, isAdminSeccional, isAdminUnidade } from '$lib/auth';
import { lerPapelGise } from '$lib/server/gise-papel-cache';
import { buscarUnidadeIdSupervisaoExtra } from '$lib/server/gise-supervisao-extra';
import { eq, asc } from 'drizzle-orm';
import { unidades } from '$lib/server/schema';
import { buscarConfiguracao } from '$lib/db/configuracoes';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const db = getDB(platform);

	const isGeral = isAdminGeral(u);
	const isSeccional = isAdminSeccional(u);

	let isSupervisor = false;
	let isMembro = false;
	if (u.tipo === 'policial') {
		// Reutiliza o cache edge (TTL 60s) já populado pelo layout — evita 2 queries ao D1
		const papel = await lerPapelGise(db, u.id);
		isSupervisor = papel.isSupervisor;
		isMembro = papel.isMembro;
	}

	// Servidores sem qualquer vínculo com GISE: redirecionar
	if (!isGeral && !isSeccional && !isSupervisor && !isMembro) {
		throw redirect(302, '/');
	}

	const supervisorId = (!isGeral && !isSeccional && isSupervisor && !isMembro) ? u.id : undefined;
	const policialId = (!isGeral && !isSeccional) ? u.id : undefined;
	const [escalas, ativa, seccionaisList, supervisaoExtraUnidadeId, defaultHoraEntrada, defaultHoraSaida] = await Promise.all([
		listarGiseEscalas(db, supervisorId, policialId),
		buscarGiseAtiva(db),
		db.select({ id: unidades.id, nome: unidades.nome }).from(unidades).where(eq(unidades.tipo, 'seccional')).orderBy(asc(unidades.nome)).all(),
		buscarUnidadeIdSupervisaoExtra(db),
		buscarConfiguracao(db, 'gise_default_hora_entrada'),
		buscarConfiguracao(db, 'gise_default_hora_saida')
	]);

	const isUnidade = isAdminUnidade(u);
	const minhaSeccionalId = (isSeccional || isAdminUnidade(u)) ? u.papel_unidade_id : null;

	return {
		escalas,
		ativa,
		isGeral,
		isSeccional,
		isUnidade,
		isSupervisor,
		isMembro,
		seccionaisList,
		minhaSeccionalId,
		supervisaoExtraUnidadeId,
		defaultHoraEntrada: defaultHoraEntrada ?? '08:00',
		defaultHoraSaida: defaultHoraSaida ?? '16:00'
	};
};

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function parseDatasCriacaoGise(raw: string | undefined): { ok: true; dias: { data: string; feriado: boolean }[] } | { ok: false; error: string } {
	if (!raw?.trim()) return { ok: false, error: 'Selecione pelo menos um dia no calendário' };
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, error: 'Lista de datas inválida' };
	}
	if (!Array.isArray(parsed) || parsed.length === 0) {
		return { ok: false, error: 'Selecione pelo menos um dia no calendário' };
	}
	const vistos = new Set<string>();
	const dias: { data: string; feriado: boolean }[] = [];
	for (const item of parsed) {
		if (!item || typeof item !== 'object') return { ok: false, error: 'Lista de datas inválida' };
		const data = (item as { data?: unknown }).data;
		const feriado = !!(item as { feriado?: unknown }).feriado;
		if (typeof data !== 'string' || !DATA_ISO.test(data)) return { ok: false, error: 'Data inválida na seleção' };
		if (vistos.has(data)) continue;
		vistos.add(data);
		dias.push({ data, feriado });
	}
	dias.sort((a, b) => a.data.localeCompare(b.data));
	if (dias.length === 0) return { ok: false, error: 'Selecione pelo menos um dia no calendário' };
	return { ok: true, dias };
}

export const actions: Actions = {
	criar: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (!isAdminGeral(u)) return fail(403, { error: 'Apenas o Administrador Geral pode criar escalas GISE' });

		const data = await request.formData();
		const datasJson = data.get('datas_json')?.toString();

		const db = getDB(platform);
		const defaultHoraEntrada = (await buscarConfiguracao(db, 'gise_default_hora_entrada')) ?? '08:00';
		const defaultHoraSaida = (await buscarConfiguracao(db, 'gise_default_hora_saida')) ?? '16:00';

		const hora_entrada = data.get('hora_entrada')?.toString() || defaultHoraEntrada;
		const hora_saida = data.get('hora_saida')?.toString() || defaultHoraSaida;
		const modo = (data.get('modo')?.toString() || 'completa') as 'completa' | 'clonada' | 'branco';
		const clonar_de = data.get('clonar_de') ? Number(data.get('clonar_de')) : undefined;

		const parsed = parseDatasCriacaoGise(datasJson);
		if (!parsed.ok) return fail(400, { error: parsed.error });
		if (modo === 'clonada' && !clonar_de) {
			return fail(400, { error: 'Escolha a escala de origem para copiar' });
		}

		try {
			let ids: number[];

			if (modo === 'clonada' && clonar_de) {
				// Paralelize: cada data é independente, sem conflito de FK
				ids = await Promise.all(
					parsed.dias.map(({ data: d, feriado }) =>
						clonarGiseParaData(db, clonar_de, d, 'clonada', hora_entrada, hora_saida, feriado)
					)
				);
			} else if (modo === 'branco') {
				ids = await Promise.all(
					parsed.dias.map(({ data: d, feriado }) =>
						criarGiseEscala(db, d, hora_entrada, hora_saida, 'em_definicao_supervisor', feriado)
					)
				);
			} else {
				// Buscar seccionais uma vez; depois criar todas as escalas + suas seccionais em paralelo
				const seccionais = await db.select({ id: unidades.id, nome: unidades.nome })
					.from(unidades).where(eq(unidades.tipo, 'seccional')).all();

				ids = await Promise.all(
					parsed.dias.map(async ({ data: d, feriado }) => {
						const novaId = await criarGiseEscala(db, d, hora_entrada, hora_saida, 'em_definicao_supervisor', feriado);
						await Promise.all(seccionais.map((sec) => upsertGiseSeccional(db, novaId, sec.id)));
						return novaId;
					})
				);
			}

			return { success: true, count: ids.length, ids, datas: parsed.dias.map(d => d.data) };
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			return fail(500, { error: msg });
		}
	}
};
