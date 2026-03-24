import { json } from '@sveltejs/kit';
import {
	getDB,
	buscarEscala,
	listarPoliciaisEscala,
	criarEscala,
	adicionarPolicialEscala,
	verificarEscalaExistente,
	type Database
} from '$lib/db';
import {
	calcularProximoMesDias,
	proximoMes,
	primeiroDiaDoMes,
	ultimoDiaDoMes,
	calcularDataSaida,
	MESES_PT
} from '$lib/rotacao';
import type { RequestHandler } from './$types';

async function verificarAcessoEscala(
	db: Database,
	escalaId: number,
	locals: App.Locals
): Promise<Response | null> {
	if (locals.usuario?.tipo === 'policial') {
		const escala = await buscarEscala(db, escalaId);
		if (escala && escala.lotacao !== locals.usuario.lotacao) {
			return json({ error: 'Sem permissão' }, { status: 403 }) as Response;
		}
	}
	return null;
}

/**
 * POST /api/escalas/[id]/proximo-mes
 *
 * Gera a escala do próximo mês baseada na escala atual:
 *  - Expediente: copia todos os servidores com as datas do novo mês
 *  - Plantão: calcula os novos dias de cada servidor pela rotação (1x3 ou 2x6),
 *    deduzida automaticamente a partir do padrão de dias do mês atual
 */
export const POST: RequestHandler = async ({ platform, params, locals }) => {
	const db = getDB(platform);
	const escalaId = Number(params.id);

	const bloqueio = await verificarAcessoEscala(db, escalaId, locals);
	if (bloqueio) return bloqueio;

	const escalaAtual = await buscarEscala(db, escalaId);
	if (!escalaAtual) return json({ error: 'Escala não encontrada' }, { status: 404 });

	if (escalaAtual.tipo !== 'plantao' && escalaAtual.tipo !== 'expediente') {
		return json(
			{ error: 'Repetir escala só está disponível para escalas mensais de plantão ou expediente' },
			{ status: 400 }
		);
	}

	// Calcula datas do próximo mês
	const [anoAtual, mesAtual] = escalaAtual.data_inicio.split('-').map(Number);
	const { ano: novoAno, mes: novoMes } = proximoMes(anoAtual, mesAtual);
	const novaDataInicio = primeiroDiaDoMes(novoAno, novoMes);
	const novaDataFim = ultimoDiaDoMes(novoAno, novoMes);

	// Verifica se já existe escala para o próximo mês
	const existente = await verificarEscalaExistente(
		db,
		escalaAtual.lotacao,
		escalaAtual.tipo,
		novaDataInicio
	);
	if (existente) {
		const tipoLabel = escalaAtual.tipo === 'plantao' ? 'Plantão' : 'Expediente';
		return json(
			{
				error: `Já existe uma Escala de ${tipoLabel} para ${escalaAtual.lotacao} em ${MESES_PT[novoMes - 1]} ${novoAno}.`,
				escala_id: existente.id
			},
			{ status: 409 }
		);
	}

	// Cria título para o novo mês
	const tipoLabel = escalaAtual.tipo === 'plantao' ? 'PLANTÃO' : 'EXPEDIENTE';
	const novoTitulo = `ESCALA DE ${tipoLabel} DA ${escalaAtual.lotacao.toUpperCase()} – ${MESES_PT[novoMes - 1]} ${novoAno}`;

	// Cria a nova escala
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
	if (!novaEscalaId) {
		return json({ error: 'Erro ao criar nova escala' }, { status: 500 });
	}

	// Busca todos os policiais da escala atual
	const policiaisAtuais = await listarPoliciaisEscala(db, escalaId);
	if (policiaisAtuais.length === 0) {
		return json({ success: true, escala_id: novaEscalaId, adicionados: 0, nao_processados: [] });
	}

	const horaEntrada = escalaAtual.hora_entrada || '00:00';
	const horaSaida = escalaAtual.hora_saida || '23:59';

	let adicionados = 0;
	const naoProcessados: Array<{ nome: string; motivo: string }> = [];

	if (escalaAtual.tipo === 'expediente') {
		// Para expediente: copia cada servidor único com as datas do novo mês
		const policialIdsVistos = new Set<number>();

		for (const p of policiaisAtuais) {
			if (policialIdsVistos.has(p.policial_id)) continue;
			policialIdsVistos.add(p.policial_id);

			const dsEntrada = p.hora_entrada || horaEntrada;
			const dsSaida = p.hora_saida || horaSaida;
			const dataSaida = calcularDataSaida(novaDataInicio, dsEntrada, dsSaida);

			await adicionarPolicialEscala(
				db,
				novaEscalaId,
				p.policial_id,
				novaDataInicio,
				dataSaida,
				dsEntrada,
				dsSaida
			);
			adicionados++;
		}
	} else {
		// Para plantão: agrupa dias por servidor e calcula rotação
		const diasPorPolicial = new Map<number, { nome: string; dias: string[] }>();

		for (const p of policiaisAtuais) {
			if (!diasPorPolicial.has(p.policial_id)) {
				diasPorPolicial.set(p.policial_id, { nome: p.nome, dias: [] });
			}
			diasPorPolicial.get(p.policial_id)!.dias.push(p.data_plantao);
		}

		for (const [policialId, { nome, dias }] of diasPorPolicial) {
			const { dias: novosDias, rotacao } = calcularProximoMesDias(dias, novoAno, novoMes);

			if (novosDias.length === 0) {
				naoProcessados.push({
					nome,
					motivo:
						rotacao === null
							? 'Rotação não identificada (padrão de dias irregular ou poucos dados)'
							: 'Nenhum dia calculado para o próximo mês'
				});
				continue;
			}

			for (const dia of novosDias) {
				const dataSaida = calcularDataSaida(dia, horaEntrada, horaSaida);
				await adicionarPolicialEscala(
					db,
					novaEscalaId,
					policialId,
					dia,
					dataSaida,
					horaEntrada,
					horaSaida
				);
			}
			adicionados++;
		}
	}

	return json({
		success: true,
		escala_id: novaEscalaId,
		adicionados,
		nao_processados: naoProcessados
	});
};
