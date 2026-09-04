/**
 * Helpers do fluxo "adicionar servidor à escala de plantão", compartilhados
 * por `FormAdicionarServidores` (criar equipe) e `FormInlineAdicionarOip`
 * (adicionar OIP a uma equipe existente) — antes cada um tinha uma cópia.
 */
import { toaster } from '$lib/toast';
import { mostrarErroDeResultado } from '$lib/enhance-handler';
import { calcularDataSaida, adicionarDias, diasNoMes } from '$lib/utils/datas';
import type { ActionResult } from '@sveltejs/kit';
import type { EscalaPolicialComDados } from '$lib/types';

/** Último dia do mês de uma data ISO (`YYYY-MM-DD`); 31 quando vazia. */
export function ultimoDiaMes(dataStr: string): number {
	if (!dataStr) return 31;
	const [ano, mes] = dataStr.split('-');
	return diasNoMes(Number(ano), Number(mes));
}

/** `MM/AAAA` de uma data ISO, para o sufixo do campo "1º dia". */
export function mesAnoFormatado(dataStr: string): string {
	if (!dataStr) return '';
	const [ano, mes] = dataStr.split('-');
	return `${mes}/${ano}`;
}

/** Data ISO do 1º plantão a partir do dia digitado (mês/ano da escala). */
export function primeiroPlantaoDoDia(dataInicio: string, dia: string | number): string {
	if (!dia || !dataInicio) return '';
	const [ano, mes] = dataInicio.split('-');
	return `${ano}-${mes}-${String(dia).padStart(2, '0')}`;
}

/**
 * Projeta as datas de plantão dentro do período da escala a partir do 1º
 * plantão: `1x3` trabalha 1 dia e folga 3 (passo 4); `2x6` trabalha 2 dias
 * seguidos e folga 6 (passo 8).
 *
 * Usa `adicionarDias` (UTC-safe) — nunca `toISOString().split('T')` em Date
 * local, que em UTC-3 marca o dia seguinte das 21h à meia-noite (e o inverso
 * em fuso positivo). Ver CLAUDE.md / auditoria de duplicação 06/ago §1.1.
 */
export function calcularDatasPlantao(
	escala: { data_inicio: string; data_fim: string },
	primeiroPlantao: string,
	tipo: '1x3' | '2x6'
): string[] {
	if (!primeiroPlantao) return [];
	const datas: string[] = [];
	const { data_inicio: inicio, data_fim: fim } = escala;
	let cursor = primeiroPlantao;
	const passo = tipo === '1x3' ? 4 : 8;

	while (cursor <= fim) {
		if (cursor >= inicio) datas.push(cursor);
		if (tipo === '2x6') {
			const segundo = adicionarDias(cursor, 1);
			if (segundo <= fim && segundo >= inicio) datas.push(segundo);
		}
		cursor = adicionarDias(cursor, passo);
	}
	return datas;
}

/** JSON do hidden field `datas` da action `?/adicionarPlantao`. */
export function datasPlantaoParaJson(
	datas: string[],
	horaEntrada: string,
	horaSaida: string
): string {
	return JSON.stringify(
		datas.map((d) => ({
			data_plantao: d,
			data_saida: calcularDataSaida(d, horaEntrada, horaSaida)
		}))
	);
}

/**
 * Pós-processamento comum do resultado de `?/adicionarPlantao`/`?/repetir`:
 * aplica a lista atualizada, avisa dias ignorados por choque de horário e
 * delega ao caller o reset de estado próprio via `aoSucesso`. `textos`
 * personaliza o toast de sucesso e o fallback de erro por action.
 */
export function tratarResultadoAdicionarPlantao(
	result: ActionResult,
	onPoliciais: (policiais: EscalaPolicialComDados[]) => void,
	aoSucesso: () => void,
	textos?: { sucesso?: string; erroPadrao?: string }
): void {
	if (result.type === 'success') {
		onPoliciais(result.data?.policiais);
		const conflitantes =
			(result.data?.conflitantes as { data: string; motivo: string }[] | undefined) ?? [];
		if (conflitantes.length > 0) {
			const datas = conflitantes.map((c) => c.data).join(', ');
			toaster.create({
				title: `Adicionado — ${conflitantes.length} dia(s) com choque ignorado(s)`,
				description: `Dias ignorados: ${datas}`,
				type: 'warning'
			});
		} else {
			toaster.create({
				title: textos?.sucesso ?? 'Servidor adicionado à escala de plantão',
				type: 'success'
			});
		}
		aoSucesso();
	} else {
		mostrarErroDeResultado(result, textos?.erroPadrao ?? 'Erro ao adicionar');
	}
}
