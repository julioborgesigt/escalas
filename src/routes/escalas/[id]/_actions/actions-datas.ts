/**
 * Form actions de DATAS E HORÁRIOS de `/escalas/[id]` — mexem nas linhas
 * existentes sem trocar quem serve.
 *
 * `repetir` clona a alocação de um servidor para outras datas;
 * `editarPlantaoAgrupado` e `editarDiasEscala` reescrevem o conjunto de dias de
 * quem já está na escala. Operações de `'conteudo'`, portanto travadas depois
 * de assinar ou finalizar.
 */
import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { intervaloDeDatas, dataISOValida } from '$lib/utils/datas';
import { listarPoliciaisEscala, adicionarMultiplasDatasPlantao } from '$lib/db';
import { eq, and, inArray } from 'drizzle-orm';
import { escalaPoliciais, escalas as escalasTable } from '$lib/server/schema';
import { verificarConflitoGlobalBatch } from '$lib/server/escalas/conflict';
import { calcularDataSaida } from '$lib/rotacao';
import { erroDeDatasForaDoPeriodo } from '$lib/server/escalas/periodo';
import { carregarEscalaComPermissao, lerEquipe, MAX_EQUIPE_ESCALA } from './shared';
import { registrarMudancaEscala, nomeDoPolicial } from './desfecho';
import { ehViolacaoUnique } from '$lib/server/db-errors';
import { textoLimitado, horaOuPadrao, MAX_OBSERVACOES } from '$lib/server/form-data';

/** O `event` das actions desta rota: `params.id` é a escala. */
type Event = RequestEvent<{ id: string }>;

export const actionsDatas = {
	/**
	 * Edita de uma vez TODAS as linhas de um policial no plantão mensal: a tela
	 * mostra uma linha por pessoa (com os dias agrupados), então salvar precisa
	 * reconciliar o conjunto — os dias que saíram são apagados e os que entraram,
	 * inseridos.
	 */
	editarPlantaoAgrupado: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		const data = await request.formData();
		const idsJson = data.get('ids')?.toString() || '[]';
		const datasJson = data.get('datas')?.toString() || '[]';
		const hora_entrada = horaOuPadrao(data, 'hora_entrada', '08:00');
		const hora_saida = horaOuPadrao(data, 'hora_saida', '08:00');
		const observacoes = textoLimitado(data, 'observacoes', MAX_OBSERVACOES);
		if (hora_entrada === null || hora_saida === null) {
			return fail(400, { error: 'Horário inválido — use HH:MM.' });
		}

		let ids: number[];
		let datasStr: string[];
		try {
			ids = JSON.parse(idsJson);
			datasStr = JSON.parse(datasJson);
		} catch {
			return fail(400, { error: 'Dados inválidos' });
		}

		if (ids.length === 0) return fail(400, { error: 'IDs de origem não fornecidos' });
		if (datasStr.length === 0) return fail(400, { error: 'Selecione pelo menos uma data' });

		const foraDoPeriodo = erroDeDatasForaDoPeriodo(escala, datasStr);
		if (foraDoPeriodo) return fail(400, { error: foraDoPeriodo });

		const origin = await db
			.select({ policial_id: escalaPoliciais.policial_id, equipe: escalaPoliciais.equipe })
			.from(escalaPoliciais)
			.where(and(eq(escalaPoliciais.escala_id, escalaId), eq(escalaPoliciais.id, ids[0])))
			.get();
		if (!origin) return fail(404, { error: 'Registro não encontrado' });

		const policial_id = origin.policial_id;
		const equipe = origin.equipe || '';

		const oldRows = await db
			.select()
			.from(escalaPoliciais)
			.where(and(eq(escalaPoliciais.escala_id, escalaId), inArray(escalaPoliciais.id, ids)))
			.all();
		await db
			.delete(escalaPoliciais)
			.where(and(eq(escalaPoliciais.escala_id, escalaId), inArray(escalaPoliciais.id, ids)));

		const conflitosMap = await verificarConflitoGlobalBatch(
			db,
			policial_id,
			datasStr,
			hora_entrada,
			hora_saida,
			-1
		);
		const datasLimpas = datasStr.filter((d) => !conflitosMap.has(d));
		const conflitantes = Array.from(conflitosMap.entries()).map(([data, motivo]) => ({
			data,
			motivo
		}));

		if (datasLimpas.length === 0) {
			await db.insert(escalaPoliciais).values(oldRows);
			const primeiro = conflitantes[0];
			return fail(409, {
				error: `Choque de horário em todas as datas. Ex: ${primeiro.data} — ${primeiro.motivo}`
			});
		}

		try {
			const linhasParaInserir = datasLimpas.map((d) => ({
				escala_id: escalaId,
				policial_id,
				data_plantao: d,
				data_saida: calcularDataSaida(d, hora_entrada, hora_saida),
				hora_entrada,
				hora_saida,
				equipe,
				observacoes
			}));
			await db.insert(escalaPoliciais).values(linhasParaInserir);
			const policiais = await listarPoliciaisEscala(db, escalaId);

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'editar_escala',
				alvo: { tipo: 'policial', id: policial_id, nome: await nomeDoPolicial(db, policial_id) },
				detalhes: `Plantão do mês reconciliado: ${oldRows.length} dia(s) → ${datasLimpas.length} dia(s)`,
				itens: datasLimpas.length,
				metadados: { equipe, recusadas_por_conflito: conflitantes },
				// A action APAGA as linhas antigas e insere as novas; sem o antes, a
				// trilha registra a inserção e some com o que estava lá.
				dados_antes: { datas: oldRows.map((r) => r.data_plantao) },
				dados_depois: { datas: datasLimpas, hora_entrada, hora_saida, observacoes }
			});

			return { success: true, policiais, conflitantes };
		} catch {
			await db.insert(escalaPoliciais).values(oldRows);
			return fail(500, { error: 'Erro ao salvar alterações' });
		}
	},

	/**
	 * Troca as datas de uma escala de FDS (ex.: feriado prolongado que muda de
	 * dia). Só antes de finalizar: depois do envio por e-mail, o documento já
	 * circulou.
	 */
	editarDiasEscala: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		if (escala.tipo !== 'fds')
			return fail(400, { error: 'Operação válida apenas para escalas de FDS' });
		if (escala.finalizada_em) return fail(400, { error: 'Escala já finalizada' });

		const formData = await request.formData();
		const datasJson = formData.get('datas')?.toString() || '[]';
		let novasDatas: string[];
		try {
			novasDatas = JSON.parse(datasJson);
		} catch {
			return fail(400, { error: 'Dados inválidos' });
		}

		if (!Array.isArray(novasDatas) || novasDatas.length === 0) {
			return fail(400, { error: 'Selecione pelo menos um dia' });
		}
		// Estas datas viram `data_inicio` e `data_fim` da ESCALA (o menor e o maior
		// do conjunto), e nada as conferia: `datas=["banana"]` gravava "banana"
		// como o período do documento. Diferente das outras actions, aqui não há
		// período contra o qual comparar — é ele que está sendo redefinido —,
		// então o que se pode exigir é o FORMATO.
		if (!novasDatas.every((d) => dataISOValida(d))) {
			return fail(400, { error: 'Datas inválidas — use AAAA-MM-DD.' });
		}

		const sorted = [...novasDatas].sort();
		const novaDataInicio = sorted[0];
		const novaDataFim = sorted[sorted.length - 1];

		// Dias atualmente no range da escala
		const getDaysInRange = intervaloDeDatas;

		const velhoRange = getDaysInRange(escala.data_inicio, escala.data_fim);
		const novoRangeSet = new Set(getDaysInRange(novaDataInicio, novaDataFim));
		const diasRemovidos = velhoRange.filter((d) => !novoRangeSet.has(d));

		if (diasRemovidos.length > 0) {
			// Verifica se algum dia removido tem policiais escalados
			const comPoliciais = await db
				.select({ data_plantao: escalaPoliciais.data_plantao })
				.from(escalaPoliciais)
				.where(
					and(
						eq(escalaPoliciais.escala_id, escalaId),
						inArray(escalaPoliciais.data_plantao, diasRemovidos)
					)
				)
				.all();

			if (comPoliciais.length > 0) {
				const diasStr = [
					...new Set(
						comPoliciais.map((p) => {
							const [, m, d] = p.data_plantao.split('-');
							return `${d}/${m}`;
						})
					)
				].join(', ');
				return fail(409, {
					error: `Não é possível remover o(s) dia(s) ${diasStr} — há policiais escalados. Remova-os primeiro e tente novamente.`
				});
			}
		}

		const dS = novaDataInicio.split('-')[2];
		const mS = novaDataInicio.split('-')[1];
		const dF = novaDataFim.split('-')[2];
		const mF = novaDataFim.split('-')[1];
		const novoTitulo = `ESCALA DE PLANTÃO DO FINAL DE SEMANA - ${escala.lotacao} - ${dS}/${mS} a ${dF}/${mF}`;

		await db
			.update(escalasTable)
			.set({ data_inicio: novaDataInicio, data_fim: novaDataFim, titulo: novoTitulo })
			.where(eq(escalasTable.id, escalaId));

		const policiais = await listarPoliciaisEscala(db, escalaId);

		await registrarMudancaEscala(event, {
			db,
			escalaId,
			usuario: u,
			acao: 'editar_escala',
			alvo: { tipo: 'escala', id: escalaId, nome: novoTitulo },
			detalhes: `Dias do FDS: ${escala.data_inicio}–${escala.data_fim} → ${novaDataInicio}–${novaDataFim}`,
			itens: policiais.length,
			dados_antes: {
				data_inicio: escala.data_inicio,
				data_fim: escala.data_fim,
				titulo: escala.titulo
			},
			dados_depois: {
				data_inicio: novaDataInicio,
				data_fim: novaDataFim,
				titulo: novoTitulo
			}
		});

		return {
			success: true,
			data_inicio: novaDataInicio,
			data_fim: novaDataFim,
			titulo: novoTitulo,
			policiais
		};
	},

	/**
	 * Repete um policial já escalado em novas datas, herdando horário e equipe da
	 * linha de origem — evita redigitar o que já está na escala.
	 */
	repetir: async (event: Event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		const data = await request.formData();
		const policial_id = Number(data.get('policial_id'));
		const hora_entrada = horaOuPadrao(data, 'hora_entrada', '08:00');
		const hora_saida = horaOuPadrao(data, 'hora_saida', '08:00');
		const equipe = lerEquipe(data);
		const datasJson = data.get('datas')?.toString() || '[]';

		let datasStr: string[];
		try {
			datasStr = JSON.parse(datasJson);
		} catch {
			return fail(400, { error: 'Datas inválidas' });
		}

		if (isNaN(policial_id) || datasStr.length === 0) {
			return fail(400, { error: 'Selecione pelo menos uma data' });
		}
		if (hora_entrada === null || hora_saida === null) {
			return fail(400, { error: 'Horário inválido — use HH:MM.' });
		}
		if (equipe === null) {
			return fail(400, { error: `Equipe inválida — informe de 1 a ${MAX_EQUIPE_ESCALA}.` });
		}

		const foraDoPeriodo = erroDeDatasForaDoPeriodo(escala, datasStr);
		if (foraDoPeriodo) return fail(400, { error: foraDoPeriodo });

		const todos = await db
			.select({
				policial_id: escalaPoliciais.policial_id,
				data_plantao: escalaPoliciais.data_plantao
			})
			.from(escalaPoliciais)
			.where(eq(escalaPoliciais.escala_id, escalaId));

		const ocupados = new Set(todos.map((r) => `${r.policial_id}|${r.data_plantao}`));

		const datasDisponiveis = datasStr.filter((d) => !ocupados.has(`${policial_id}|${d}`));

		if (datasDisponiveis.length === 0) {
			return fail(400, { error: 'Este servidor já está em todos os dias selecionados' });
		}

		// Verifica conflitos em batch (-1 = sem exclusão; datasDisponiveis já excluiu duplicatas na escala atual)
		const conflitosMap = await verificarConflitoGlobalBatch(
			db,
			policial_id,
			datasDisponiveis,
			hora_entrada,
			hora_saida,
			-1
		);

		const novas = datasDisponiveis
			.filter((d) => !conflitosMap.has(d))
			.map((d) => ({
				data_plantao: d,
				data_saida: calcularDataSaida(d, hora_entrada, hora_saida)
			}));
		const conflitantes = Array.from(conflitosMap.entries()).map(([data, motivo]) => ({
			data,
			motivo
		}));

		if (novas.length === 0) {
			const primeiro = conflitantes[0];
			return fail(409, {
				error: `Choque de horário em todas as datas. Ex: ${primeiro.data} — ${primeiro.motivo}`
			});
		}

		try {
			await adicionarMultiplasDatasPlantao(
				db,
				escalaId,
				policial_id,
				novas,
				hora_entrada,
				hora_saida,
				equipe
			);
			const policiais = await listarPoliciaisEscala(db, escalaId);

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'adicionar_policial_escala',
				alvo: { tipo: 'policial', id: policial_id, nome: await nomeDoPolicial(db, policial_id) },
				detalhes: `Repetido em ${novas.length} dia(s), ${hora_entrada} às ${hora_saida}`,
				itens: novas.length,
				metadados: { equipe, recusadas_por_conflito: conflitantes },
				dados_depois: { datas: novas.map((d) => d.data_plantao) }
			});

			return { success: true, policiais, conflitantes };
		} catch (e) {
			if (ehViolacaoUnique(e)) {
				return fail(409, { error: 'Este policial já está escalado neste dia.' });
			}
			return fail(500, { error: 'Erro ao repetir servidor na escala' });
		}
	}
};
