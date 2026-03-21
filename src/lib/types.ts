export type {
	Policial,
	Escala,
	EscalaPolicial,
	Unidade
} from './server/schema';

import type { EscalaPolicial } from './server/schema';

export interface EscalaPolicialComDados extends EscalaPolicial {
	nome: string;
	matricula: string;
	cargo: string;
	telefone: string | null;
	lotacao: string;
}
