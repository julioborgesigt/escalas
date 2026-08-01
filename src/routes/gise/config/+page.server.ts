import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getDB,
	salvarVagasPadraoEquipesGise,
	buscarVagasPadraoEquipesGise,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { buscarConfiguracao, salvarConfiguracao } from '$lib/db/configuracoes';
import {
	getBreveRelatorioEnvMergido,
	GISE_BREVE_RELATORIO_CONFIG_KEYS
} from '$lib/server/gise/breve-relatorio-env';
import {
	resolveBreveRelatorioTitulo,
	resolveBreveRelatorioConteudoSeccional,
	resolveBreveRelatorioConteudoSupervisao
} from '$lib/gise/breve-relatorio';
import { logger } from '$lib/server/logger';
import { validarHora, normalizarHora } from '$lib/gise/gise-horarios';

/**
 * Tela `/gise/config` (Admin Geral): padrões que valem para toda GISE nova —
 * vagas por tipo de equipe, textos do breve relatório e horários padrão.
 */

/**
 * GISE "vazia" passada aos resolvedores do breve relatório: como os três campos
 * são nulos, eles caem no fallback (config do banco → env → texto embutido), que
 * é justamente o que esta tela edita. Sem isso seria preciso duplicar a cadeia
 * de precedência aqui.
 */
const giseRowBreveNulo = {
	breve_relatorio_titulo: null,
	breve_relatorio_texto_seccional: null,
	breve_relatorio_texto_supervisao: null
} as const;

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (locals.usuario?.tipo !== 'admin') redirect(302, '/gise');
	const db = getDB(platform);
	const [vagas, brEnv, defaultHoraEntrada, defaultHoraSaida] = await Promise.all([
		buscarVagasPadraoEquipesGise(db),
		getBreveRelatorioEnvMergido(db),
		buscarConfiguracao(db, 'gise_default_hora_entrada'),
		buscarConfiguracao(db, 'gise_default_hora_saida')
	]);
	return {
		vagas,
		breveForm: {
			titulo: resolveBreveRelatorioTitulo(giseRowBreveNulo, brEnv),
			textoSeccional: resolveBreveRelatorioConteudoSeccional(giseRowBreveNulo, brEnv),
			textoSupervisao: resolveBreveRelatorioConteudoSupervisao(giseRowBreveNulo, brEnv)
		},
		defaultHoraEntrada: defaultHoraEntrada ?? '08:00',
		defaultHoraSaida: defaultHoraSaida ?? '16:00'
	};
};

/** Inteiro de 0 a 999 vindo do form; qualquer coisa fora disso cai no padrão `d`. */
function parseN(v: FormDataEntryValue | null, d: number): number {
	if (v === null || v === undefined) return d;
	const s = String(v).trim();
	if (s === '') return d;
	const n = parseInt(s, 10);
	if (Number.isNaN(n) || n < 0 || n > 999) return d;
	return n;
}

export const actions: Actions = {
	salvar: async (event) => {
		const { request, locals, platform } = event;
		if (locals.usuario?.tipo !== 'admin') return fail(403, { error: 'Sem permissão' });
		const fd = await request.formData();
		const vOpDpc = parseN(fd.get('op_dpc'), 1);
		const vOpOip = parseN(fd.get('op_oip'), 3);
		const vSeDpc = parseN(fd.get('seint_dpc'), 0);
		const vSeOip = parseN(fd.get('seint_oip'), 2);

		const breveTitulo = (fd.get('breve_titulo') as string | null) ?? '';
		const breveTextoSeccional = (fd.get('breve_texto_seccional') as string | null) ?? '';
		const breveTextoSupervisao = (fd.get('breve_texto_supervisao') as string | null) ?? '';

		const defaultHoraEntradaRaw = (fd.get('default_hora_entrada') as string | null) ?? '';
		const defaultHoraSaidaRaw = (fd.get('default_hora_saida') as string | null) ?? '';

		const defaultHoraEntrada = normalizarHora(defaultHoraEntradaRaw.trim());
		const defaultHoraSaida = normalizarHora(defaultHoraSaidaRaw.trim());

		// `validarHora('')` é true (o campo é opcional nas outras telas), então o
		// teste de vazio é o que torna o horário obrigatório aqui.
		if (!defaultHoraEntrada || !validarHora(defaultHoraEntrada)) {
			return fail(400, { error: 'Horário de entrada padrão inválido. Use o formato HH:MM.' });
		}
		if (!defaultHoraSaida || !validarHora(defaultHoraSaida)) {
			return fail(400, { error: 'Horário de saída padrão inválido. Use o formato HH:MM.' });
		}

		const db = getDB(platform);
		try {
			await salvarVagasPadraoEquipesGise(db, {
				operacional: { dpc: vOpDpc, oip: vOpOip },
				seint: { dpc: vSeDpc, oip: vSeOip }
			});

			// String vazia é gravada de propósito: significa "sem texto", diferente de
			// não ter a chave (que faria o resolvedor cair no default do env).
			const salvarBreve = async (k: string, val: string) => {
				await salvarConfiguracao(db, k, val.trim() ? val.trim() : '');
			};
			await salvarBreve(GISE_BREVE_RELATORIO_CONFIG_KEYS.titulo, breveTitulo);
			await salvarBreve(GISE_BREVE_RELATORIO_CONFIG_KEYS.textoSeccional, breveTextoSeccional);
			await salvarBreve(GISE_BREVE_RELATORIO_CONFIG_KEYS.textoSupervisao, breveTextoSupervisao);

			await salvarConfiguracao(db, 'gise_default_hora_entrada', defaultHoraEntrada);
			await salvarConfiguracao(db, 'gise_default_hora_saida', defaultHoraSaida);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			logger.error('[gise/config] salvar', { error: msg });
			return fail(500, { error: 'Erro ao salvar' });
		}

		// Auditoria depois do commit: a tela é de configuração global e o registro
		// precisa refletir o que de fato ficou gravado.
		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'salvar_config_gise',
				usuario: locals.usuario,
				entidade: 'configuracao',
				detalhes: 'Configuração do GISE alterada (vagas padrão, breve relatório, horários)',
				dados_depois: {
					vagas: { op_dpc: vOpDpc, op_oip: vOpOip, seint_dpc: vSeDpc, seint_oip: vSeOip },
					default_hora_entrada: defaultHoraEntrada,
					default_hora_saida: defaultHoraSaida
				},
				...contexto
			},
			{ env }
		);
		return { success: true };
	}
};
