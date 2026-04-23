/**
 * Colunas da planilha Base_Equipe (POST «Enviar para a planilha»).
 * Fica em módulo separado **sem** `$env/dynamic/private` para poder ser usado em
 * rotas como download XLSX sem arrastar o bundle do sync/webhook.
 */
import type { Database } from '../core';
import type { GiseEscala } from '../../server/schema';
import { buscarGiseEscala } from './escalas';
import { listarMembrosParaBaseEquipe, type LinhaBaseEquipeMembro } from './base-equipe';

const TZ = 'America/Sao_Paulo';

/** Cabeçalhos da aba Base_Equipe na planilha Google (A–J); mesma ordem do POST `rows`. */
export const BASE_EQUIPE_PLANILHA_HEADERS = [
	'ID_Relatorio',
	'Nome_Policial',
	'Cidade_Atuacao',
	'Tipo_Servico',
	'Data_Entrada',
	'Hora_Entrada_Indiv',
	'Dia_Entrada',
	'Data_Saida_Indiv',
	'Hora_Saida_Indiv',
	'Dia_Saida'
] as const;

function dataSaidaEfetivaGise(dataInicio: string, horaEntrada: string, horaSaida: string): string {
	const heVal = parseInt(horaEntrada.split(':')[0] ?? '0', 10);
	const hsVal = parseInt(horaSaida.split(':')[0] ?? '0', 10);
	if (hsVal <= heVal) {
		const dObj = new Date(dataInicio + 'T12:00:00');
		dObj.setDate(dObj.getDate() + 1);
		return dObj.toISOString().slice(0, 10);
	}
	return dataInicio;
}

function isoAgendadoFortaleza(dataYmd: string, hhmm: string): string {
	const parts = hhmm.split(':');
	const h = Math.min(23, Math.max(0, parseInt(parts[0] ?? '0', 10) || 0));
	const mi = Math.min(59, Math.max(0, parseInt(parts[1] ?? '0', 10) || 0));
	return `${dataYmd}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00-03:00`;
}

function dataCalendarioBR(isoTs: string): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: TZ,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(isoTs));
}

const EN_SHORT_TO_DIA: Record<string, string> = {
	Sun: 'Dom.',
	Mon: 'Seg.',
	Tue: 'Ter.',
	Wed: 'Qua.',
	Thu: 'Qui.',
	Fri: 'Sex.',
	Sat: 'Sáb.'
};

function diaColuna(isoTs: string, dataInicioGise: string, feriadoEscala: boolean): string {
	const calKey = dataCalendarioBR(isoTs);
	if (feriadoEscala && calKey === dataInicioGise) return 'Feriado';
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: TZ,
		weekday: 'short'
	}).formatToParts(new Date(isoTs));
	const w = parts.find((p) => p.type === 'weekday')?.value ?? '';
	return EN_SHORT_TO_DIA[w] ?? `${w}.`;
}

function formatarDataPtBRDeTimestamp(isoTs: string): string {
	const calKey = dataCalendarioBR(isoTs);
	const [y, m, d] = calKey.split('-');
	return `${d}/${m}/${y}`;
}

function horaPtBR(isoTs: string): string {
	const parts = new Intl.DateTimeFormat('pt-BR', {
		timeZone: TZ,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).formatToParts(new Date(isoTs));
	const h = (parts.find((p) => p.type === 'hour')?.value ?? '00').padStart(2, '0');
	const mi = (parts.find((p) => p.type === 'minute')?.value ?? '00').padStart(2, '0');
	return `${h}:${mi}`;
}

/** Mesmos campos enviados ao POST da planilha Base_Equipe (exceto nome, que vem da linha do membro). */
export type DadosPlanilhaBaseEquipePolicial = {
	gise_id: number;
	cidade_atuacao: string;
	tipo_servico: string;
	data_entrada: string;
	hora_entrada: string;
	dia_entrada: string;
	data_saida: string;
	hora_saida: string;
	dia_saida: string;
};

export function dadosPlanilhaBaseEquipeParaMembro(
	gise: GiseEscala,
	giseId: number,
	r: LinhaBaseEquipeMembro
): DadosPlanilhaBaseEquipePolicial {
	const feriado = !!gise.feriado;
	const dataInicio = gise.data_inicio;
	const horaEntradaGise = gise.hora_entrada ?? '08:00';
	const horaSaidaGise = gise.hora_saida ?? '16:00';
	const dataSaidaDoc = dataSaidaEfetivaGise(dataInicio, horaEntradaGise, horaSaidaGise);
	const isoEntradaPadrao = isoAgendadoFortaleza(dataInicio, horaEntradaGise);

	let dataEnt: string;
	let horaEnt: string;
	let diaEnt: string;
	if (r.entrada_timestamp) {
		dataEnt = formatarDataPtBRDeTimestamp(r.entrada_timestamp);
		horaEnt = horaPtBR(r.entrada_timestamp);
		diaEnt = diaColuna(r.entrada_timestamp, dataInicio, feriado);
	} else {
		dataEnt = formatarDataPtBRDeTimestamp(isoEntradaPadrao);
		horaEnt = '';
		diaEnt = diaColuna(isoEntradaPadrao, dataInicio, feriado);
	}

	let dataSai: string;
	let horaSai: string;
	let diaSai: string;
	if (r.saida_timestamp) {
		dataSai = formatarDataPtBRDeTimestamp(r.saida_timestamp);
		horaSai = horaPtBR(r.saida_timestamp);
		diaSai = diaColuna(r.saida_timestamp, dataInicio, feriado);
	} else {
		const isoDiaSaidaDoc = isoAgendadoFortaleza(dataSaidaDoc, '12:00');
		dataSai = formatarDataPtBRDeTimestamp(isoDiaSaidaDoc);
		horaSai = '';
		diaSai = diaColuna(isoDiaSaidaDoc, dataInicio, feriado);
	}

	return {
		gise_id: giseId,
		cidade_atuacao: r.cidade_atuacao,
		tipo_servico: 'GISE',
		data_entrada: dataEnt,
		hora_entrada: horaEnt,
		dia_entrada: diaEnt,
		data_saida: dataSai,
		hora_saida: horaSai,
		dia_saida: diaSai
	};
}

/**
 * Mapa policial_id → colunas idênticas ao envio «Enviar para a planilha» (Base_Equipe).
 */
export async function montarMapaBaseEquipePorPolicialId(
	db: Database,
	giseId: number
): Promise<Map<number, DadosPlanilhaBaseEquipePolicial>> {
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return new Map();

	const linhasDb = await listarMembrosParaBaseEquipe(db, giseId);
	const map = new Map<number, DadosPlanilhaBaseEquipePolicial>();
	for (const r of linhasDb) {
		map.set(r.policial_id, dadosPlanilhaBaseEquipeParaMembro(gise, giseId, r));
	}
	return map;
}

/**
 * Monta as linhas A–J para a aba Base_Equipe (uma linha por membro escalado).
 */
export async function montarLinhasBaseEquipeGise(
	db: Database,
	giseId: number
): Promise<(string | number)[][] | null> {
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return null;

	const linhasDb = await listarMembrosParaBaseEquipe(db, giseId);
	if (linhasDb.length === 0) return [];

	const out: (string | number)[][] = [];
	for (const r of linhasDb) {
		const d = dadosPlanilhaBaseEquipeParaMembro(gise, giseId, r);
		out.push([
			d.gise_id,
			r.nome,
			d.cidade_atuacao,
			d.tipo_servico,
			d.data_entrada,
			d.hora_entrada,
			d.dia_entrada,
			d.data_saida,
			d.hora_saida,
			d.dia_saida
		]);
	}
	return out;
}
