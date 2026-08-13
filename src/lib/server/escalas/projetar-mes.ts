/**
 * Projeta os policiais de uma escala para o mês seguinte.
 *
 * `criarComBase` (listagem) e `gerarProximoMes` (página da escala) montavam as
 * mesmas linhas à mão: expediente deduplica e lança no dia 1; plantão identifica
 * a rotação e projeta o ciclo. O insert em lotes já era compartilhado; o laço
 * que decide O QUÊ inserir ainda estava copiado — e foi assim que um lado
 * fatiava em 50 e o outro mandava um `values(array)` só (DUP-DRIFT 1.3).
 *
 * As actions continuam donas de criar a escala, auditar e recusar conflito;
 * daqui saem só as linhas e a lista de quem não pôde ser projetado.
 */
import { agruparDiasPorPolicial, calcularProximoMesDias } from '$lib/rotacao';
import { calcularDataSaida } from '$lib/utils/datas';

/** O que o laço lê de cada linha de `listarPoliciaisEscala`. */
export type LinhaEscalaParaProjecao = {
	policial_id: number;
	nome: string;
	equipe?: string | null;
	data_plantao: string;
	hora_entrada?: string | null;
	hora_saida?: string | null;
};

/** Linha pronta para `inserirPoliciaisEscalaEmLotes`. */
type LinhaProjetadaMes = {
	escala_id: number;
	policial_id: number;
	data_plantao: string;
	data_saida: string;
	hora_entrada: string;
	hora_saida: string;
	equipe?: string;
};

export type ResultadoProjecaoMes = {
	linhas: LinhaProjetadaMes[];
	adicionados: number;
	naoProcessados: Array<{ nome: string; motivo: string }>;
};

/**
 * Monta as linhas do mês-alvo a partir dos escalados da escala-base.
 *
 * @param tipo `expediente` = uma linha por policial no `dataInicioAlvo`;
 *   qualquer outro (na prática `plantao`) = projeção por rotação.
 * @param ano / mes mês-alvo (1–12), o mesmo que `calcularProximoMesDias` espera.
 * @param dataInicioAlvo primeiro dia do mês-alvo — só o expediente usa.
 */
export function projetarLinhasMesSeguinte(opts: {
	tipo: 'plantao' | 'expediente';
	policiaisAtuais: readonly LinhaEscalaParaProjecao[];
	novaEscalaId: number;
	ano: number;
	mes: number;
	dataInicioAlvo: string;
	horaEntradaPadrao: string | null;
	horaSaidaPadrao: string | null;
}): ResultadoProjecaoMes {
	const {
		tipo,
		policiaisAtuais,
		novaEscalaId,
		ano,
		mes,
		dataInicioAlvo,
		horaEntradaPadrao,
		horaSaidaPadrao
	} = opts;
	const hePadrao = horaEntradaPadrao || '00:00';
	const hsPadrao = horaSaidaPadrao || '23:59';
	const linhas: LinhaProjetadaMes[] = [];
	const naoProcessados: Array<{ nome: string; motivo: string }> = [];
	let adicionados = 0;

	if (tipo === 'expediente') {
		const vistos = new Set<number>();
		for (const p of policiaisAtuais) {
			if (vistos.has(p.policial_id)) continue;
			vistos.add(p.policial_id);
			const he = p.hora_entrada || hePadrao;
			const hs = p.hora_saida || hsPadrao;
			linhas.push({
				escala_id: novaEscalaId,
				policial_id: p.policial_id,
				data_plantao: dataInicioAlvo,
				data_saida: calcularDataSaida(dataInicioAlvo, he, hs),
				hora_entrada: he,
				hora_saida: hs
			});
			adicionados++;
		}
		return { linhas, adicionados, naoProcessados };
	}

	const diasPorPolicial = agruparDiasPorPolicial(policiaisAtuais);
	for (const [policialId, { nome, dias, equipe }] of diasPorPolicial) {
		const { dias: novosDias, rotacao } = calcularProximoMesDias(dias, ano, mes);
		if (novosDias.length === 0) {
			naoProcessados.push({
				nome,
				motivo: rotacao === null ? 'Rotação não identificada' : 'Nenhum dia calculado'
			});
			continue;
		}
		for (const dia of novosDias) {
			linhas.push({
				escala_id: novaEscalaId,
				policial_id: policialId,
				data_plantao: dia,
				data_saida: calcularDataSaida(dia, hePadrao, hsPadrao),
				hora_entrada: hePadrao,
				hora_saida: hsPadrao,
				equipe
			});
		}
		adicionados++;
	}
	return { linhas, adicionados, naoProcessados };
}
