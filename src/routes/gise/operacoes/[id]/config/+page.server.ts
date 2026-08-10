/**
 * `/gise/operacoes/[id]/config` — a configuração de escala DE UMA OPERAÇÃO.
 *
 * Substitui a antiga `/gise/config`, que era global. Global fazia sentido quando
 * existia uma operação só; com CRAJUBAR e EDGE convivendo, deixa de fazer — uma
 * força-tarefa monta equipe de outro tamanho, e o parágrafo que vai no PDF de
 * extra fala do serviço dela.
 *
 * ## Campo em branco herda, e é o que torna a mudança inócua
 *
 * Cada campo aceita ficar vazio, e vazio grava `NULL`, que significa "usa o
 * padrão do sistema" (`configuracoes` → constante do código). Nenhuma operação
 * existente muda de comportamento por causa desta tela: todas começam sem
 * sobrescrita nenhuma.
 *
 * Zero NÃO é ausência: uma equipe operacional sem vaga de DPC é uma escolha
 * legítima. Por isso a distinção entre `''` (herda) e `0` (zero vagas) é
 * preservada em toda a rota, e é ela que decide entre gravar `null` e gravar o
 * número.
 *
 * ## Não é retroativo
 *
 * Vagas e horários valem para o que for CRIADO depois. Equipe existente guarda
 * as suas próprias `slots_dpc`/`slots_oip`, e escala existente guarda os seus
 * horários — mudar aqui não redimensiona GISE em andamento. Já os textos do
 * breve relatório SÃO lidos na hora de gerar o PDF, então valem também para
 * escalas antigas que ainda não foram assinadas.
 */
import { fail, redirect, error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getDB,
	buscarOperacao,
	atualizarOperacao,
	buscarVagasPadraoEquipesGise,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { buscarConfiguracao } from '$lib/db/configuracoes';
import { getBreveRelatorioEnvMergido } from '$lib/server/gise/breve-relatorio-env';
import {
	resolveBreveRelatorioTitulo,
	resolveBreveRelatorioConteudoSeccional,
	resolveBreveRelatorioConteudoSupervisao
} from '$lib/gise/breve-relatorio';
import { validarHora, normalizarHora } from '$lib/gise/horarios';
import { logger } from '$lib/server/logger';

/**
 * GISE "vazia" passada aos resolvedores do breve relatório: com os três campos
 * nulos eles caem na cadeia de baixo (operação → config → constante), que é
 * justamente o que esta tela precisa mostrar como valor HERDADO.
 */
const semSobrescritaDeEscala = {
	breve_relatorio_titulo: null,
	breve_relatorio_texto_seccional: null,
	breve_relatorio_texto_supervisao: null
} as const;

export const load: PageServerLoad = async ({ locals, platform, params, depends }) => {
	depends('app:operacao-config');
	if (!isAdminGeral(locals.usuario)) redirect(302, '/gise');

	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(404, 'Operação não encontrada');

	const db = getDB(platform);
	const operacao = await buscarOperacao(db, id);
	if (!operacao) error(404, 'Operação não encontrada');

	// Os valores HERDADOS, para mostrar como placeholder de cada campo vazio: o
	// admin precisa saber o que vai valer se não escrever nada, senão "em branco"
	// vira um salto no escuro.
	const [globalSemOperacao, envDaOperacao, horaEntradaGlobal, horaSaidaGlobal] = await Promise.all([
		buscarVagasPadraoEquipesGise(db, null),
		getBreveRelatorioEnvMergido(db, null),
		buscarConfiguracao(db, 'gise_default_hora_entrada'),
		buscarConfiguracao(db, 'gise_default_hora_saida')
	]);

	return {
		operacao,
		/** O que vale quando o campo correspondente fica vazio. */
		herdado: {
			vagas: globalSemOperacao,
			horaEntrada: horaEntradaGlobal ?? '08:00',
			horaSaida: horaSaidaGlobal ?? '16:00',
			breveTitulo: resolveBreveRelatorioTitulo(semSobrescritaDeEscala, envDaOperacao),
			breveTextoSeccional: resolveBreveRelatorioConteudoSeccional(
				semSobrescritaDeEscala,
				envDaOperacao
			),
			breveTextoSupervisao: resolveBreveRelatorioConteudoSupervisao(
				semSobrescritaDeEscala,
				envDaOperacao
			)
		}
	};
};

/**
 * Inteiro de 0 a 999, ou `null` quando o campo veio vazio.
 *
 * `null` e `0` são respostas DIFERENTES: vazio herda o padrão do sistema, zero
 * é uma equipe sem aquela vaga. Confundir os dois faria "0 DPC" virar "1 DPC" no
 * próximo salvamento.
 */
function inteiroOuHerda(fd: FormData, campo: string): number | null | 'invalido' {
	const s = String(fd.get(campo) ?? '').trim();
	if (s === '') return null;
	const n = Number(s);
	if (!Number.isInteger(n) || n < 0 || n > 999) return 'invalido';
	return n;
}

/** Texto aparado, ou `null` quando vazio (herda). */
function textoOuHerda(fd: FormData, campo: string, max: number): string | null {
	const s = String(fd.get(campo) ?? '').trim();
	return s === '' ? null : s.slice(0, max);
}

export const actions: Actions = {
	salvar: async (event) => {
		const { request, locals, platform, params } = event;
		if (!isAdminGeral(locals.usuario)) return fail(403, { error: 'Somente Administrador Geral' });

		const id = Number(params.id);
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Operação inválida' });

		const db = getDB(platform);
		const operacao = await buscarOperacao(db, id);
		if (!operacao) return fail(404, { error: 'Operação não encontrada' });

		const fd = await request.formData();

		const vagas = {
			vagas_operacional_dpc: inteiroOuHerda(fd, 'op_dpc'),
			vagas_operacional_oip: inteiroOuHerda(fd, 'op_oip'),
			vagas_seint_dpc: inteiroOuHerda(fd, 'seint_dpc'),
			vagas_seint_oip: inteiroOuHerda(fd, 'seint_oip')
		};
		if (Object.values(vagas).includes('invalido')) {
			return fail(400, { error: 'As vagas devem ser números inteiros de 0 a 999.' });
		}

		// Horário: vazio herda; preenchido tem de ser HH:MM válido. `validarHora('')`
		// é `true` (o campo é opcional em outras telas), então o teste de vazio
		// acontece ANTES — é ele que separa "herda" de "digitou errado".
		const horarios: Record<'hora_entrada_padrao' | 'hora_saida_padrao', string | null> = {
			hora_entrada_padrao: null,
			hora_saida_padrao: null
		};
		for (const [campo, coluna] of [
			['hora_entrada', 'hora_entrada_padrao'],
			['hora_saida', 'hora_saida_padrao']
		] as const) {
			const bruto = String(fd.get(campo) ?? '').trim();
			if (bruto === '') continue;
			const normalizada = normalizarHora(bruto);
			if (!normalizada || !validarHora(normalizada)) {
				return fail(400, { error: `Horário inválido em "${campo}". Use o formato HH:MM.` });
			}
			horarios[coluna] = normalizada;
		}

		try {
			await atualizarOperacao(db, id, {
				...(vagas as Record<keyof typeof vagas, number | null>),
				...horarios,
				breve_relatorio_titulo: textoOuHerda(fd, 'breve_titulo', 200),
				breve_relatorio_texto_seccional: textoOuHerda(fd, 'breve_texto_seccional', 2000),
				breve_relatorio_texto_supervisao: textoOuHerda(fd, 'breve_texto_supervisao', 2000)
			});
		} catch (e) {
			logger.error('[operacoes/config] salvar', { error: String(e), operacaoId: id });
			return fail(500, { error: 'Erro ao salvar a configuração da operação.' });
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'editar_operacao',
				usuario: locals.usuario,
				entidade: 'operacao',
				entidade_id: id,
				detalhes: `Configuração de escala da operação "${operacao.nome}" alterada`,
				dados_depois: { ...vagas, ...horarios },
				...contexto
			},
			{ env }
		);

		return { success: true };
	}
};
