import type * as schema from '../../server/schema';

export type GiseMembro = schema.GiseMembro & {
	policial_nome: string;
	policial_cargo: string;
	policial_matricula: string;
	policial_telefone: string | null;
	policial_lotacao: string | null;
	policial_classe: string | null;
	presenca: schema.GisePresenca | null;
};

export type GiseEquipeComMembros = schema.GiseEquipe & { membros: GiseMembro[] };

export interface GiseUnidadeSlot {
	id: number;
	unidade_id: number | null;
	nome: string | null;
	equipes: GiseEquipeComMembros[];
}

export interface GiseDetalhado extends schema.GiseEscala {
	seccionais: Array<
		schema.GiseSeccional & {
			seccional_nome: string;
			temRespostas: boolean;
			unidades: GiseUnidadeSlot[];
		}
	>;
	supervisor_nome: string | null;
	supervisor_matricula: string | null;
	supervisor_telefone: string | null;
	assessor_nome: string | null;
	assessor_matricula: string | null;
	assessor_telefone: string | null;
	seint1_nome: string | null;
	seint1_matricula: string | null;
	seint1_telefone: string | null;
	seint2_nome: string | null;
	seint2_matricula: string | null;
	seint2_telefone: string | null;
	documento: schema.GiseDocumento | null;
	totalSeccionais: number;
	assinaturasRelatorioExtra: number;
	temSaidaConfirmada: boolean;
}
