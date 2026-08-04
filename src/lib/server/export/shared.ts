/**
 * Regras de formatação e agrupamento compartilhadas pelos exportadores de
 * escala (PDF, XLSX e DOCX) — o que muda entre eles é só o desenho, os dados
 * saem daqui iguais para os três.
 */
import type { Escala, EscalaPolicialComDados } from '../../types';
import { formatarData, calcularDataSaida, MESES_PT } from '../../utils/datas';

/** Um dia de plantão com os policiais escalados nele. */
interface DiaPlantao {
	data: string;
	policiais: EscalaPolicialComDados[];
}

/** Um policial no plantão MENSAL: uma linha por pessoa, com todos os seus dias. */
interface OficialPlantao {
	policial_id: number;
	equipe: string;
	nome: string;
	matricula: string;
	cargo: string;
	telefone: string;
	lotacao: string;
	dias: string[];
	observacoes: string;
}

// Horário em três níveis: o do policial vence o da escala, e '08' é o padrão
// histórico da corporação para quando nenhum dos dois está preenchido.
function getHoraEntrada(p: EscalaPolicialComDados, escala: Escala): string {
	return p.hora_entrada || escala.hora_entrada || '08';
}

function getHoraSaida(p: EscalaPolicialComDados, escala: Escala): string {
	return p.hora_saida || escala.hora_saida || '08';
}

/** Data de saída explícita ou derivada (plantão que vira o dia). */
function getDataSaida(p: EscalaPolicialComDados, escala: Escala): string {
	if (p.data_saida) return p.data_saida;
	return calcularDataSaida(p.data_plantao, getHoraEntrada(p, escala), getHoraSaida(p, escala));
}

/**
 * Horário do plantão no formato do documento: `"08H A 08H"`. Entrada e saída
 * iguais significam turno de 24h — a corporação escreve assim, não "08H A 08H
 * do dia seguinte"; quem precisa das datas usa `formatarDataPlantao`.
 */
export function formatarHorario(p: EscalaPolicialComDados, escala: Escala): string {
	const entrada = getHoraEntrada(p, escala);
	const saida = getHoraSaida(p, escala);
	return `${entrada}H A ${saida}H`;
}

/** "05/07/2026" ou "05/07/2026 à 06/07/2026" quando o turno atravessa a meia-noite. */
export function formatarDataPlantao(p: EscalaPolicialComDados, escala: Escala): string {
	const dataEntrada = formatarData(p.data_plantao);
	const dataSaida = getDataSaida(p, escala);
	if (dataSaida !== p.data_plantao) {
		return `${dataEntrada} à ${formatarData(dataSaida)}`;
	}
	return dataEntrada;
}

/**
 * Ordem canônica dos nomes em qualquer listagem de escala: delegado (DPC) no
 * topo, o resto em ordem alfabética.
 */
function compararPorCargoENome(
	a: { cargo: string; nome: string },
	b: { cargo: string; nome: string }
) {
	if (a.cargo !== b.cargo) return a.cargo === 'DPC' ? -1 : 1;
	return a.nome.localeCompare(b.nome);
}

/**
 * Separador do título do FDS: "05/07 **E** 06/07" para um fim de semana comum
 * (até 2 dias) e "05/07 **A** 08/07" para feriado prolongado.
 */
export function sepDatas(inicio: string, fim: string): string {
	const d1 = new Date(inicio + 'T00:00:00');
	const d2 = new Date(fim + 'T00:00:00');
	const dias = Math.round((d2.getTime() - d1.getTime()) / 86_400_000) + 1;
	return dias <= 2 ? 'E' : 'A';
}

/** Agrupa por dia (usado no FDS, onde cada data vira um bloco). */
export function agruparPorData(policiais: EscalaPolicialComDados[]): DiaPlantao[] {
	const map = new Map<string, EscalaPolicialComDados[]>();
	for (const p of policiais) {
		const list = map.get(p.data_plantao) || [];
		list.push(p);
		map.set(p.data_plantao, list);
	}
	return Array.from(map.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([data, lista]) => ({ data, policiais: [...lista].sort(compararPorCargoENome) }));
}

/** Expediente é lista única (sem agrupamento), só ordenada. */
export function sortExpediente(policiais: EscalaPolicialComDados[]): EscalaPolicialComDados[] {
	return [...policiais].sort(compararPorCargoENome);
}

export const COLS_EXPEDIENTE = [
	'NOME COMPLETO',
	'MATRÍCULA',
	'CARGO',
	'TELEFONE',
	'CLASSE',
	'LOTAÇÃO',
	'REGIME',
	'OBSERVAÇÕES'
] as const;

/**
 * Uma linha da tabela de EXPEDIENTE, na ordem exata de `COLS_EXPEDIENTE` — os
 * dois têm de ser editados juntos, ou a coluna passa a exibir outro campo sem
 * nenhum erro aparecer.
 *
 * Campo ausente vira string vazia em vez de `undefined`: os três exportadores
 * escrevem células de texto, e `undefined` apareceria literalmente no PDF.
 */
export function rowExpediente(p: EscalaPolicialComDados): string[] {
	return [
		p.nome,
		p.matricula,
		p.cargo,
		p.telefone || '',
		p.classe || '',
		p.lotacao,
		p.regime || '',
		p.observacoes || ''
	];
}

/**
 * Plantão mensal: colapsa as N linhas de um policial (uma por dia) numa linha
 * só com a lista de dias, e agrupa por equipe.
 *
 * A chave inclui a equipe porque o mesmo policial pode aparecer em duas equipes
 * na mesma escala — nesse caso são duas linhas, não uma.
 */
export function agruparPlantao(policiais: EscalaPolicialComDados[]): Map<string, OficialPlantao[]> {
	const oficiais = new Map<string, OficialPlantao>();
	for (const p of policiais) {
		const key = `${p.policial_id}_${p.equipe || ''}`;
		if (!oficiais.has(key)) {
			oficiais.set(key, {
				policial_id: p.policial_id,
				equipe: p.equipe || '',
				nome: p.nome,
				matricula: p.matricula,
				cargo: p.cargo,
				telefone: p.telefone || '',
				lotacao: p.lotacao,
				dias: [],
				observacoes: p.observacoes || ''
			});
		}
		oficiais.get(key)!.dias.push(p.data_plantao);
	}

	const equipes = new Map<string, OficialPlantao[]>();
	for (const oficial of oficiais.values()) {
		oficial.dias.sort();
		const list = equipes.get(oficial.equipe) || [];
		list.push(oficial);
		equipes.set(oficial.equipe, list);
	}

	for (const list of equipes.values()) {
		list.sort(compararPorCargoENome);
	}

	// Map ordenado por nome de equipe: a ordem de inserção é a ordem de impressão.
	return new Map([...equipes.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** "2026-07-05" → "05"; a coluna DIAS mostra só o dia do mês ("05, 12, 19"). */
function formatarDias(dias: string[]): string {
	return dias.map((d) => d.split('-')[2]).join(', ');
}

/** Cabeçalho "MÊS/ANO" dos documentos mensais: "2026-07-05" → "JULHO/2026". */
export function formatarMesAno(dateStr: string): string {
	if (!dateStr) return '';
	const [year, month] = dateStr.split('-');
	return `${MESES_PT[Number(month) - 1].toUpperCase()}/${year}`;
}

/**
 * Cabeçalho "DELEGACIA: <unidade>" dos três formatos.
 *
 * O campo é `lotacao` (o NOME da unidade — "1ª DELEGACIA DE JUAZEIRO"), nunca
 * `cidade` (o município — "JUAZEIRO DO NORTE"): são colunas distintas de
 * `escalas`, e o rótulo pede a delegacia.
 *
 * Existe como função porque as duas versões já divergiram: o plantão em DOCX e
 * em XLSX imprimia `cidade` enquanto o PDF imprimia `lotacao`, e o servidor que
 * recebia a planilha lia o nome do município no lugar do da sua delegacia.
 * Nenhum teste pegava — só o PDF tem golden.
 */
export function cabecalhoDelegacia(escala: Pick<Escala, 'lotacao'>): string {
	return `DELEGACIA: ${escala.lotacao.toUpperCase()}`;
}

export const COLS_PLANTAO = [
	'NOME',
	'MATRÍCULA',
	'CARGO',
	'TELEFONE',
	'LOTAÇÃO',
	'DIAS',
	'OBSERVAÇÕES'
] as const;

/**
 * Uma linha da tabela de PLANTÃO mensal, na ordem de `COLS_PLANTAO` (mesma
 * regra de edição conjunta de `rowExpediente`). Recebe o policial já colapsado
 * por `agruparPlantao`: a coluna DIAS traz a lista compactada por
 * `formatarDias`, não uma data só.
 */
export function rowPlantao(o: OficialPlantao): string[] {
	return [o.nome, o.matricula, o.cargo, o.telefone, o.lotacao, formatarDias(o.dias), o.observacoes];
}
