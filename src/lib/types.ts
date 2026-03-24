import type { Policial, Escala, EscalaPolicial, Unidade } from './server/schema';

export type {
	Policial,
	Escala,
	EscalaPolicial,
	Unidade
};

export interface EscalaPolicialComDados extends EscalaPolicial {
	nome: string;
	matricula: string;
	cargo: string;
	telefone: string | null;
	lotacao: string;
	classe: string;
	regime: string;
	observacoes: string;
	equipe: string;
}

export interface EscalaListagem extends Escala {
	is_assinada: boolean;
}
