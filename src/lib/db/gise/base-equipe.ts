import { eq, inArray, sql } from 'drizzle-orm';
import {
	giseEscalas,
	giseMembros,
	giseEquipes,
	giseSeccionais,
	gisePresencas,
	giseSeccionalUnidades,
	policiais,
	unidades
} from '../../server/schema';
import type { Database } from '../core';

export type LinhaBaseEquipeMembro = {
	policial_id: number;
	nome: string;
	cidade_atuacao: string;
	entrada_timestamp: string | null;
	saida_timestamp: string | null;
};

/**
 * Cidade da unidade cujo nome coincide com a lotação do policial (case-insensitive).
 */
async function cidadePorNomeLotacao(db: Database, lotacao: string): Promise<string> {
	const lot = lotacao.trim();
	if (!lot) return '';
	const row = await db
		.select({ cidade: unidades.cidade })
		.from(unidades)
		.where(sql`lower(trim(${unidades.nome})) = lower(trim(${lot}))`)
		.limit(1)
		.get();
	return (row?.cidade ?? '').trim();
}

/**
 * Policiais da GISE para a planilha Base_Equipe (uma linha por pessoa):
 * — escalados em equipes (`gise_membros`);
 * — e integrantes do quadro "Supervisão e apoio" que não estejam em nenhuma equipe
 *   (supervisor, assessor, SEINT), com as mesmas regras de cidade (lotação) e presença.
 */
export async function listarMembrosParaBaseEquipe(
	db: Database,
	giseId: number
): Promise<LinhaBaseEquipeMembro[]> {
	const gise = await db.select().from(giseEscalas).where(eq(giseEscalas.id, giseId)).get();
	if (!gise) return [];

	const painelIds = new Set<number>(
		[gise.supervisor_id, gise.assessor_id, gise.seint1_id, gise.seint2_id].filter(
			(x): x is number => typeof x === 'number' && x > 0
		)
	);

	const membrosRows = await db
		.select({
			policial_id: giseMembros.policial_id,
			nome: policiais.nome,
			lotacao: policiais.lotacao,
			cidade_slot: unidades.cidade
		})
		.from(giseMembros)
		.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
		.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
		.innerJoin(policiais, eq(giseMembros.policial_id, policiais.id))
		.leftJoin(giseSeccionalUnidades, eq(giseEquipes.gise_unidade_id, giseSeccionalUnidades.id))
		.leftJoin(unidades, eq(giseSeccionalUnidades.unidade_id, unidades.id))
		.where(eq(giseSeccionais.gise_id, giseId))
		.all();

	const presRows = await db
		.select()
		.from(gisePresencas)
		.where(eq(gisePresencas.gise_id, giseId))
		.all();
	const presMap = new Map(presRows.map((p) => [p.policial_id, p]));

	/** Agrega por policial (mesmo servidor em mais de uma equipe). */
	const agregado = new Map<
		number,
		{ nome: string; lotacao: string; cidade_slot: string; policial_id: number }
	>();
	for (const r of membrosRows) {
		const slotCid = (r.cidade_slot ?? '').trim();
		const ex = agregado.get(r.policial_id);
		if (!ex) {
			agregado.set(r.policial_id, {
				policial_id: r.policial_id,
				nome: r.nome,
				lotacao: r.lotacao ?? '',
				cidade_slot: slotCid
			});
		} else {
			if (!ex.cidade_slot && slotCid) ex.cidade_slot = slotCid;
		}
	}

	const lotacoesPainel = new Set<string>();
	for (const [, v] of agregado) {
		if (painelIds.has(v.policial_id) && v.lotacao.trim()) lotacoesPainel.add(v.lotacao.trim());
	}
	const cidadeLotacaoCache = new Map<string, string>();
	for (const lot of lotacoesPainel) {
		cidadeLotacaoCache.set(lot, await cidadePorNomeLotacao(db, lot));
	}

	const out: LinhaBaseEquipeMembro[] = [];
	for (const v of agregado.values()) {
		const pres = presMap.get(v.policial_id);
		let cidade = '';
		if (painelIds.has(v.policial_id)) {
			cidade = cidadeLotacaoCache.get(v.lotacao.trim()) ?? '';
		} else {
			cidade = v.cidade_slot;
		}

		out.push({
			policial_id: v.policial_id,
			nome: v.nome,
			cidade_atuacao: cidade,
			entrada_timestamp: pres?.entrada_timestamp ?? null,
			saida_timestamp: pres?.saida_timestamp ?? null
		});
	}

	const jaIncluidos = new Set(out.map((r) => r.policial_id));
	const faltamPainel = [...painelIds].filter((id) => !jaIncluidos.has(id));
	if (faltamPainel.length > 0) {
		const polsPainel = await db
			.select({ id: policiais.id, nome: policiais.nome, lotacao: policiais.lotacao })
			.from(policiais)
			.where(inArray(policiais.id, faltamPainel))
			.all();
		for (const p of polsPainel) {
			const lot = (p.lotacao ?? '').trim();
			const cidade = lot ? await cidadePorNomeLotacao(db, lot) : '';
			const pres = presMap.get(p.id);
			out.push({
				policial_id: p.id,
				nome: p.nome,
				cidade_atuacao: cidade,
				entrada_timestamp: pres?.entrada_timestamp ?? null,
				saida_timestamp: pres?.saida_timestamp ?? null
			});
		}
	}

	out.sort((a, b) => a.policial_id - b.policial_id);
	return out;
}
