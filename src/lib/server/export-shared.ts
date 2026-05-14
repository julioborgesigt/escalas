import type { Escala, EscalaPolicialComDados } from '../types';
import { formatarData, proximoDia } from '../utils';

export interface DiaPlantao {
	data: string;
	policiais: EscalaPolicialComDados[];
}

export interface OficialPlantao {
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

export function getHoraEntrada(p: EscalaPolicialComDados, escala: Escala): string {
	return p.hora_entrada || escala.hora_entrada || '08';
}

export function getHoraSaida(p: EscalaPolicialComDados, escala: Escala): string {
	return p.hora_saida || escala.hora_saida || '08';
}

export function getDataSaida(p: EscalaPolicialComDados, escala: Escala): string {
	if (p.data_saida) return p.data_saida;
	const he = Number(getHoraEntrada(p, escala).split(':')[0]);
	const hs = Number(getHoraSaida(p, escala).split(':')[0]);
	if (hs <= he) return proximoDia(p.data_plantao);
	return p.data_plantao;
}

export function formatarHorario(p: EscalaPolicialComDados, escala: Escala): string {
	const entrada = getHoraEntrada(p, escala);
	const saida = getHoraSaida(p, escala);
	return `${entrada}H A ${saida}H`;
}

export function formatarDataPlantao(p: EscalaPolicialComDados, escala: Escala): string {
	const dataEntrada = formatarData(p.data_plantao);
	const dataSaida = getDataSaida(p, escala);
	if (dataSaida !== p.data_plantao) {
		return `${dataEntrada} à ${formatarData(dataSaida)}`;
	}
	return dataEntrada;
}

export function ordenarPoliciais(lista: EscalaPolicialComDados[]): EscalaPolicialComDados[] {
	return [...lista].sort((a, b) => {
		if (a.cargo !== b.cargo) return a.cargo === 'DPC' ? -1 : 1;
		return a.nome.localeCompare(b.nome);
	});
}

export function sepDatas(inicio: string, fim: string): string {
	const d1 = new Date(inicio + 'T00:00:00');
	const d2 = new Date(fim + 'T00:00:00');
	const dias = Math.round((d2.getTime() - d1.getTime()) / 86_400_000) + 1;
	return dias <= 2 ? 'E' : 'A';
}

export function agruparPorData(policiais: EscalaPolicialComDados[]): DiaPlantao[] {
	const map = new Map<string, EscalaPolicialComDados[]>();
	for (const p of policiais) {
		const list = map.get(p.data_plantao) || [];
		list.push(p);
		map.set(p.data_plantao, list);
	}
	return Array.from(map.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([data, lista]) => ({ data, policiais: ordenarPoliciais(lista) }));
}

export function formatarMatricula(matricula: string): string {
	return matricula;
}

export function sortExpediente(policiais: EscalaPolicialComDados[]): EscalaPolicialComDados[] {
	return [...policiais].sort((a, b) => {
		if (a.cargo !== b.cargo) return a.cargo === 'DPC' ? -1 : 1;
		return a.nome.localeCompare(b.nome);
	});
}

export const COLS_EXPEDIENTE = ['NOME COMPLETO', 'MATRÍCULA', 'CARGO', 'TELEFONE', 'CLASSE', 'LOTAÇÃO', 'REGIME', 'OBSERVAÇÕES'] as const;

export function rowExpediente(p: EscalaPolicialComDados): string[] {
	return [p.nome, p.matricula, p.cargo, p.telefone || '', p.classe || '', p.lotacao, p.regime || '', p.observacoes || ''];
}

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
		list.sort((a, b) => {
			if (a.cargo !== b.cargo) return a.cargo === 'DPC' ? -1 : 1;
			return a.nome.localeCompare(b.nome);
		});
	}

	return new Map([...equipes.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function formatarDias(dias: string[]): string {
	return dias.map((d) => d.split('-')[2]).join(', ');
}

export function formatarMesAno(dateStr: string): string {
	if (!dateStr) return '';
	const [year, month] = dateStr.split('-');
	const meses = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
	return `${meses[Number(month) - 1]}/${year}`;
}

export const COLS_PLANTAO = ['NOME', 'MATRÍCULA', 'CARGO', 'TELEFONE', 'LOTAÇÃO', 'DIAS', 'OBSERVAÇÕES'] as const;

export function rowPlantao(o: OficialPlantao): string[] {
	return [o.nome, o.matricula, o.cargo, o.telefone, o.lotacao, formatarDias(o.dias), o.observacoes];
}
