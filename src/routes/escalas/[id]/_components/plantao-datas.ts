import { toaster } from '$lib/toast';
import { mostrarErroDeResultado } from '$lib/enhance-handler';
import { calcularDataSaida } from '$lib/utils/datas';
import type { ActionResult } from '@sveltejs/kit';
import type { EscalaPolicialComDados } from '$lib/types';

/**
 * Helpers do fluxo "adicionar servidor à escala de plantão", compartilhados
 * por `FormAdicionarServidores` (criar equipe) e `FormInlineAdicionarOip`
 * (adicionar OIP a uma equipe existente) — antes cada um tinha uma cópia.
 */

/** Último dia do mês de uma data ISO (`YYYY-MM-DD`); 31 quando vazia. */
export function ultimoDiaMes(dataStr: string): number {
	if (!dataStr) return 31;
	const [ano, mes] = dataStr.split('-');
	return new Date(Number(ano), Number(mes), 0).getDate();
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
 */
export function calcularDatasPlantao(
	escala: { data_inicio: string; data_fim: string },
	primeiroPlantao: string,
	tipo: '1x3' | '2x6'
): string[] {
	if (!primeiroPlantao) return [];
	const datas: string[] = [];
	const inicio = new Date(escala.data_inicio + 'T00:00:00');
	const fim = new Date(escala.data_fim + 'T00:00:00');
	const d = new Date(primeiroPlantao + 'T00:00:00');
	if (tipo === '1x3') {
		while (d <= fim) {
			if (d >= inicio) datas.push(d.toISOString().split('T')[0]);
			d.setDate(d.getDate() + 4);
		}
	} else {
		while (d <= fim) {
			if (d >= inicio) datas.push(d.toISOString().split('T')[0]);
			const d2 = new Date(d);
			d2.setDate(d2.getDate() + 1);
			if (d2 <= fim && d2 >= inicio) datas.push(d2.toISOString().split('T')[0]);
			d.setDate(d.getDate() + 8);
		}
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
