/**
 * Vagas padrão das equipes GISE (quantos DPC e OIP cada equipe nova recebe).
 *
 * Guardadas como JSON numa única chave de `configuracoes` em vez de colunas
 * próprias: são um preset de UI, editado em `/gise/config`, e não entram em
 * consulta nenhuma. Toda leitura passa pelo parser tolerante abaixo, porque o
 * valor pode ter sido gravado por uma versão anterior ou editado à mão.
 */
import { buscarConfiguracao, salvarConfiguracao } from '../configuracoes';
import type { Database } from '../core';

/** Uma chave em `configuracoes` com JSON: `{"op":{"dpc":1,"oip":3},"seint":{"dpc":0,"oip":2}}` */
const GISE_EQUIPES_VAGAS_JSON_KEY = 'gise_equipes_vagas';

/** Configuração histórica da corporação, usada quando não há nada salvo. */
const VAGAS_EQUIPES_FALLBACK = {
	operacional: { dpc: 1, oip: 3 },
	seint: { dpc: 0, oip: 2 }
} as const;

/** Inteiro de 0 a 999, aceitando número ou string; qualquer outra coisa cai no padrão. */
function n(v: unknown, fallback: number): number {
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 999) return Math.floor(v);
	if (typeof v === 'string' && /^\d{1,3}$/.test(v)) {
		const k = parseInt(v, 10);
		if (k >= 0 && k <= 999) return k;
	}
	return fallback;
}

/**
 * JSON → objeto de vagas, nunca lançando: chave ausente, JSON quebrado ou campo
 * fora de faixa recaem no fallback. As cópias com spread evitam devolver a
 * constante compartilhada, que o chamador poderia mutar.
 */
function parseVagasEquipesGiseJson(raw: string | null): {
	operacional: { dpc: number; oip: number };
	seint: { dpc: number; oip: number };
} {
	if (!raw?.trim())
		return {
			...VAGAS_EQUIPES_FALLBACK,
			operacional: { ...VAGAS_EQUIPES_FALLBACK.operacional },
			seint: { ...VAGAS_EQUIPES_FALLBACK.seint }
		};
	try {
		const j = JSON.parse(raw) as {
			op?: { dpc?: unknown; oip?: unknown };
			seint?: { dpc?: unknown; oip?: unknown };
		};
		return {
			operacional: {
				dpc: n(j?.op?.dpc, VAGAS_EQUIPES_FALLBACK.operacional.dpc),
				oip: n(j?.op?.oip, VAGAS_EQUIPES_FALLBACK.operacional.oip)
			},
			seint: {
				dpc: n(j?.seint?.dpc, VAGAS_EQUIPES_FALLBACK.seint.dpc),
				oip: n(j?.seint?.oip, VAGAS_EQUIPES_FALLBACK.seint.oip)
			}
		};
	} catch {
		return {
			...VAGAS_EQUIPES_FALLBACK,
			operacional: { ...VAGAS_EQUIPES_FALLBACK.operacional },
			seint: { ...VAGAS_EQUIPES_FALLBACK.seint }
		};
	}
}

export async function buscarVagasPadraoEquipesGise(db: Database) {
	const raw = await buscarConfiguracao(db, GISE_EQUIPES_VAGAS_JSON_KEY);
	return parseVagasEquipesGiseJson(raw);
}

export async function salvarVagasPadraoEquipesGise(
	db: Database,
	v: { operacional: { dpc: number; oip: number }; seint: { dpc: number; oip: number } }
): Promise<void> {
	const body = {
		op: { dpc: n(v.operacional.dpc, 1), oip: n(v.operacional.oip, 3) },
		seint: { dpc: n(v.seint.dpc, 0), oip: n(v.seint.oip, 2) }
	};
	await salvarConfiguracao(db, GISE_EQUIPES_VAGAS_JSON_KEY, JSON.stringify(body));
}
