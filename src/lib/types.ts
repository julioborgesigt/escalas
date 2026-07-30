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
	/** Versão salva ANTES da última alteração de cada modelo — alimenta o
	 *  "Restaurar Anterior" do editor do Admin Geral. `null` enquanto só houve
	 *  a primeira gravação (coluna `config_anterior`, migração 0039). */
	modeloAnteriorOperacional: GiseModeloPerguntaConfig[] | null;
	modeloAnteriorSeint: GiseModeloPerguntaConfig[] | null;
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

/**
 * Uma linha do painel de COMPLIANCE: a exigência de escala (unidade × regime ×
 * período) e o estado em que ela está.
 *
 * `status` distingue os três casos que o painel precisa cobrar de formas
 * diferentes — `nao_criada` (ninguém montou), `nao_assinada` (montada mas sem
 * valor de documento) e `ok`. Sem escala não há `escala_id`.
 *
 * Vive aqui, e não na rota, porque é produzido em DOIS lugares com algoritmos
 * distintos — o `load` de `/painel` (qualquer mês/ano) e
 * `/api/admin/compliance` (mês corrente + FDS da semana) — e consumido pela
 * mesma tela. Duas declarações idênticas em arquivos diferentes divergem em
 * silêncio.
 */
export interface ItemCompliance {
	unidade_nome: string;
	tipo_regime: 'plantao' | 'expediente' | 'fds';
	periodo: string;
	data_inicio: string;
	data_fim: string;
	status: 'ok' | 'nao_assinada' | 'nao_criada';
	escala_id?: number;
}
