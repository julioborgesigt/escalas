export interface Policial {
	id: number;
	nome: string;
	matricula: string;
	cargo: 'DPC' | 'OIP';
	telefone: string;
	lotacao: string;
	ativo: number;
	created_at: string;
	updated_at: string;
}

export interface Escala {
	id: number;
	titulo: string;
	cidade: string;
	data_inicio: string;
	data_fim: string;
	horario: string;
	created_at: string;
}

export interface EscalaPolicial {
	id: number;
	escala_id: number;
	policial_id: number;
	data_plantao: string;
}

export interface EscalaPolicialComDados extends EscalaPolicial {
	nome: string;
	matricula: string;
	cargo: string;
	telefone: string;
	lotacao: string;
}
