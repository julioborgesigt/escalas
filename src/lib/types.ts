import type {
	Policial,
	Escala,
	EscalaPolicial,
	Unidade,
	GisePresenca,
	PolicialHistorico
} from './server/schema';

export type { Policial, Escala, Unidade, PolicialHistorico };

/** Item do formulário GISE (modelo operacional / SEINT em JSON). */
export interface GiseModeloPerguntaConfig {
	id: number;
	texto: string;
	tipo: string;
	key: string;
	obrigatoria?: boolean;
	filhos?: GiseModeloPerguntaConfig[];
	subtexto_qtd?: string;
	subtexto_lista?: string;
	subtexto_tipo?: string;
	subtexto_detalhe?: string;
}

/** Linha da lista "minhas escalas" em `/res-gise` (+page.server). */
export type ResGiseMinhaEscalaLinha = {
	id: number;
	data_inicio: string;
	status: string;
	hora_entrada: string;
	hora_saida: string;
	equipe_id: number;
	sec_hora_entrada: string | null;
	sec_hora_saida: string | null;
	eq_hora_entrada: string | null;
	eq_hora_saida: string | null;
	equipe_tipo: string;
	seccional_id: number;
	seccional_nome: string;
	presenca: GisePresenca | undefined;
	assinada: boolean;
	extraAssinado: boolean;
	equipeRespondida: boolean;
	horarioPrevisto: { inicio: string; fim: string };
};

/**
 * Linha da visão admin em `/res-gise`. Só compõe a união `ResGiseEscalaSelecionavel`
 * (o load não devolve mais uma lista admin separada), por isso não é exportada.
 */
type ResGiseListaAdminLinha = {
	id: number;
	data_inicio: string;
	status: string;
	seccional_id: number;
	seccional_nome: string;
	equipe_id: number;
	equipe_tipo: string;
	equipeRespondida: boolean;
	extraAssinado: boolean;
	isAdminView: true;
	/** Só em `minhasEscalas`; opcional aqui para compatibilidade com helpers compartilhados. */
	presenca?: GisePresenca;
	horarioPrevisto?: { inicio: string; fim: string };
};

/** Shape de `data` em `src/routes/res-gise/+page.svelte` (+page.server load). */
export type ResGisePageData = {
	minhasEscalas: ResGiseMinhaEscalaLinha[];
	isSupervisorGise: boolean;
	/** Assessor ou SEINT em GISE ativa (quadro de supervisão). */
	isSupervisaoGise?: boolean;
	/** ID da unidade sintética usada em assinaturas do relatório de extra da supervisão. */
	supervisaoExtraUnidadeId: number | null;
	respostas: Record<string, unknown>;
	/** Carimbo do 1º envio da resposta de produtividade (local, "YYYY-MM-DD HH:MM:SS") ou null. */
	respostaEnviadaEm?: string | null;
	/** Carimbo da última retificação da resposta de produtividade ou null. */
	respostaAtualizadaEm?: string | null;
	restringirSmartphone: boolean;
	/** Rubrica reutilizável cadastrada pelo policial (PNG dataURL) ou `null`. */
	minhaRubrica?: string | null;
	modeloOperacional: GiseModeloPerguntaConfig[];
	modeloSeint: GiseModeloPerguntaConfig[];
	modeloPadraoOperacional: GiseModeloPerguntaConfig[];
	modeloPadraoSeint: GiseModeloPerguntaConfig[];
};

export type ResGiseEscalaSelecionavel = ResGiseMinhaEscalaLinha | ResGiseListaAdminLinha;

export interface EscalaPolicialComDados extends EscalaPolicial {
	nome: string;
	matricula: string;
	cpf: string | null;
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
