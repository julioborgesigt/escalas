import { buscarConfiguracao, salvarConfiguracao } from '../configuracoes';
import type { Database } from '../core';

/** Uma chave em `configuracoes` com JSON: `{"op":{"dpc":1,"oip":3},"seint":{"dpc":0,"oip":2}}` */
const GISE_EQUIPES_VAGAS_JSON_KEY = 'gise_equipes_vagas';

const VAGAS_EQUIPES_FALLBACK = {
	operacional: { dpc: 1, oip: 3 },
	seint: { dpc: 0, oip: 2 }
} as const;

function n(v: unknown, fallback: number): number {
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 999) return Math.floor(v);
	if (typeof v === 'string' && /^\d{1,3}$/.test(v)) {
		const k = parseInt(v, 10);
		if (k >= 0 && k <= 999) return k;
	}
	return fallback;
}

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
