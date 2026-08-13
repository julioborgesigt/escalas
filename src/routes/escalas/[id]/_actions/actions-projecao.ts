/**
 * Form action de PROJEÇÃO de `/escalas/[id]`: cria a escala do mês seguinte a
 * partir desta, avançando a rotação.
 *
 * Recusa com 409 se já existir escala equivalente — e "equivalente" varia por
 * tipo, por isso a pergunta é de `verificarEscalaExistente` e não de um
 * `where` montado aqui.
 *
 * É `'ciclo'` e não `'conteudo'`: cria escala NOVA sem tocar nesta, então não
 * pode travar por esta estar assinada.
 */
import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
	listarPoliciaisEscala,
	criarEscala,
	verificarEscalaExistente,
	registrarAuditComContexto,
	contextoDeEvento,
	inserirPoliciaisEscalaEmLotes
} from '$lib/db';
import { proximoMes, primeiroDiaDoMes, ultimoDiaDoMes, MESES_PT } from '$lib/rotacao';
import { projetarLinhasMesSeguinte } from '$lib/server/escalas/projetar-mes';
import { carregarEscalaComPermissao } from './shared';

/** O `event` das actions desta rota: `params.id` é a escala. */
type Event = RequestEvent<{ id: string }>;

export const actionsProjecao = {
	/**
	 * Clona a escala para o mês seguinte — a operação mais carregada de regra do
	 * módulo:
	 *
	 * - **expediente**: uma linha por policial (deduplicado) no primeiro dia do
	 *   mês novo, preservando o horário individual de cada um;
	 * - **plantão**: `calcularProximoMesDias` identifica a ROTAÇÃO de cada
	 *   policial a partir dos dias que ele cumpriu e projeta o mesmo ciclo no mês
	 *   seguinte. Quem não tem rotação reconhecível não é escalado no palpite: vai
	 *   para `nao_processados` e a tela mostra a lista, para lançamento manual —
	 *   errar a projeção é pior do que não projetar.
	 *
	 * Recusa com 409 (e o id da escala existente, para a tela oferecer o atalho)
	 * quando já há escala do mesmo tipo/lotação naquele mês.
	 */
	gerarProximoMes: async (event: Event) => {
		const { locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'ciclo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala: escalaAtual, escalaId, usuario: u } = ctx;

		if (escalaAtual.tipo !== 'plantao' && escalaAtual.tipo !== 'expediente') {
			return fail(400, { error: 'Operação inválida para este tipo de escala' });
		}

		const [anoAtual, mesAtual] = escalaAtual.data_inicio.split('-').map(Number);
		const { ano: novoAno, mes: novoMes } = proximoMes(anoAtual, mesAtual);
		const novaDataInicio = primeiroDiaDoMes(novoAno, novoMes);
		const novaDataFim = ultimoDiaDoMes(novoAno, novoMes);

		const existente = await verificarEscalaExistente(
			db,
			escalaAtual.lotacao,
			escalaAtual.tipo,
			novaDataInicio
		);
		if (existente) {
			return fail(409, {
				error: `Já existe uma Escala de ${escalaAtual.tipo === 'plantao' ? 'Plantão' : 'Expediente'} para ${escalaAtual.lotacao} em ${MESES_PT[novoMes - 1]} ${novoAno}.`,
				escala_id: existente.id
			});
		}

		const tipoLabel = escalaAtual.tipo === 'plantao' ? 'PLANTÃO' : 'EXPEDIENTE';
		const novoTitulo = `ESCALA DE ${tipoLabel} DA ${escalaAtual.lotacao.toUpperCase()} – ${MESES_PT[novoMes - 1].toUpperCase()} ${novoAno}`;

		try {
			const result = await criarEscala(db, {
				titulo: novoTitulo,
				cidade: escalaAtual.cidade,
				data_inicio: novaDataInicio,
				data_fim: novaDataFim,
				horario: escalaAtual.horario,
				hora_entrada: escalaAtual.hora_entrada,
				hora_saida: escalaAtual.hora_saida,
				lotacao: escalaAtual.lotacao,
				tipo: escalaAtual.tipo
			});

			const novaEscalaId = result[0]?.id;
			if (!novaEscalaId) return fail(500, { error: 'Erro ao criar nova escala' });

			// Copiar policiais
			const policiaisAtuais = await listarPoliciaisEscala(db, escalaId);
			const { linhas, adicionados, naoProcessados } = projetarLinhasMesSeguinte({
				tipo: escalaAtual.tipo,
				policiaisAtuais,
				novaEscalaId,
				ano: novoAno,
				mes: novoMes,
				dataInicioAlvo: novaDataInicio,
				horaEntradaPadrao: escalaAtual.hora_entrada,
				horaSaidaPadrao: escalaAtual.hora_saida
			});

			await inserirPoliciaisEscalaEmLotes(db, linhas);

			const { contexto, env } = contextoDeEvento(event);
			await registrarAuditComContexto(db, {
				usuario: u,
				acao: 'criar_escala',
				entidade: 'escala',
				entidade_id: novaEscalaId,
				alvo_tipo: 'escala',
				alvo_id: novaEscalaId,
				detalhes: `Escala do próximo mês gerada a partir da escala ${escalaId}`,
				...contexto,
				env
			});

			return {
				success: true,
				escala_id: novaEscalaId,
				adicionados,
				nao_processados: naoProcessados
			};
		} catch {
			return fail(500, { error: 'Erro ao gerar escala do próximo mês' });
		}
	}
};
