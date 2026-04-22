import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDB, salvarVagasPadraoEquipesGise, buscarVagasPadraoEquipesGise } from '$lib/db';
import { salvarConfiguracao } from '$lib/db/configuracoes';
import { getBreveRelatorioEnvMergido, GISE_BREVE_RELATORIO_CONFIG_KEYS } from '$lib/server/breve-relatorio-env';
import {
	resolveBreveRelatorioTitulo,
	resolveBreveRelatorioConteudoSeccional,
	resolveBreveRelatorioConteudoSupervisao
} from '$lib/gise/breve-relatorio';
import { logger } from '$lib/server/logger';

const giseRowBreveNulo = {
	breve_relatorio_titulo: null,
	breve_relatorio_texto_seccional: null,
	breve_relatorio_texto_supervisao: null
} as const;

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (locals.usuario?.tipo !== 'admin') throw redirect(302, '/gise');
	const db = getDB(platform);
	const vagas = await buscarVagasPadraoEquipesGise(db);
	const brEnv = await getBreveRelatorioEnvMergido(db);
	return {
		vagas,
		breveForm: {
			titulo: resolveBreveRelatorioTitulo(giseRowBreveNulo, brEnv),
			textoSeccional: resolveBreveRelatorioConteudoSeccional(giseRowBreveNulo, brEnv),
			textoSupervisao: resolveBreveRelatorioConteudoSupervisao(giseRowBreveNulo, brEnv)
		}
	};
};

function parseN(v: FormDataEntryValue | null, d: number): number {
	if (v === null || v === undefined) return d;
	const s = String(v).trim();
	if (s === '') return d;
	const n = parseInt(s, 10);
	if (Number.isNaN(n) || n < 0 || n > 999) return d;
	return n;
}

export const actions: Actions = {
	salvar: async ({ request, locals, platform }) => {
		if (locals.usuario?.tipo !== 'admin') return fail(403, { error: 'Sem permissão' });
		const fd = await request.formData();
		const vOpDpc = parseN(fd.get('op_dpc'), 1);
		const vOpOip = parseN(fd.get('op_oip'), 3);
		const vSeDpc = parseN(fd.get('seint_dpc'), 0);
		const vSeOip = parseN(fd.get('seint_oip'), 2);

		const t = (fd.get('breve_titulo') as string | null) ?? '';
		const s = (fd.get('breve_texto_seccional') as string | null) ?? '';
		const u = (fd.get('breve_texto_supervisao') as string | null) ?? '';

		const db = getDB(platform);
		try {
			await salvarVagasPadraoEquipesGise(db, {
				operacional: { dpc: vOpDpc, oip: vOpOip },
				seint: { dpc: vSeDpc, oip: vSeOip }
			});

			const salvarBreve = async (k: string, val: string) => {
				await salvarConfiguracao(db, k, val.trim() ? val.trim() : '');
			};
			await salvarBreve(GISE_BREVE_RELATORIO_CONFIG_KEYS.titulo, t);
			await salvarBreve(GISE_BREVE_RELATORIO_CONFIG_KEYS.textoSeccional, s);
			await salvarBreve(GISE_BREVE_RELATORIO_CONFIG_KEYS.textoSupervisao, u);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			logger.error('[gise/config] salvar', { error: msg });
			return fail(500, { error: 'Erro ao salvar' });
		}
		return { success: true };
	}
};
