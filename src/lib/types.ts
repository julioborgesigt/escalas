import type {
	Policial,
	Escala,
	EscalaPolicial,
	Unidade,
	GisePresenca,
	Operacao,
	PolicialHistorico
} from './server/schema';

export type { Policial, Escala, Unidade, Operacao, PolicialHistorico };

/**
 * Meta de um indicador, gravada JUNTO da pergunta no modelo do formulário.
 *
 * Fica aqui, e não em tabela própria, porque o indicador É a pergunta: separá-los
 * criaria duas listas para manter em dia, e uma pergunta renomeada ou removida
 * deixaria uma meta órfã apontando para uma `key` que não existe mais.
 */
export interface IndicadorConfig {
	/** Para onde o número deve andar. Decide o sinal da meta e a leitura do gráfico. */
	objetivo: 'aumentar' | 'diminuir';
	/**
	 * `percentual` = a meta é relativa à LINHA DE BASE informada pela unidade
	 * ("redução mínima de 20% do acervo"). É o caso descrito no pedido e o padrão
	 * do editor.
	 *
	 * `absoluto` = a meta é um número fixo, sem base ("mínimo de 1 operação por
	 * unidade/mês"). Existe porque dois dos cinco indicadores do plano da CRAJUBAR
	 * são assim — e é o que dispensa a unidade de informar base para eles: não há
	 * valor anterior contra o que comparar.
	 */
	metaTipo: 'percentual' | 'absoluto';
	/** 20 para "20%" quando `percentual`; o próprio alvo quando `absoluto`. */
	metaValor: number;
	/** Como o número é medido: 'procedimentos', 'dias', 'ocorrências atendidas'. */
	unidadeMedida?: string;
	/** Texto do campo na aba de dados base; cai no texto da pergunta se vazio. */
	rotuloBase?: string;
}

/** Item do formulário GISE (modelo operacional / SEINT em JSON). */
export interface GiseModeloPerguntaConfig {
	id: number;
	texto: string;
	tipo: string;
	key: string;
	obrigatoria?: boolean;
	/**
	 * Nome da etapa do formulário em que a pergunta aparece (o wizard de
	 * `/res-gise/relatorio` agrupa por este valor, na ordem da primeira
	 * ocorrência). Só vale em perguntas de NÍVEL 0 — filhos herdam a etapa do
	 * pai, porque separá-los dele quebraria o gate "só aparece sob um Sim".
	 *
	 * Opcional de propósito: modelo antigo (sem o campo) e pergunta nova criada
	 * pelo editor caem numa etapa única, e o formulário vira página só. É o que
	 * mantém a mudança retrocompatível com os modelos já salvos no banco.
	 */
	etapa?: string;
	/**
	 * Marca a pergunta como INDICADOR de meta da operação — o que a promove de
	 * "campo do relatório" a série acompanhada em gráfico, com meta e linha de
	 * base.
	 *
	 * Opcional de propósito: pergunta sem este campo continua sendo o que sempre
	 * foi, e modelo antigo (todos, até ago/2026) segue válido sem migração de
	 * dado. Só tipos contáveis aceitam — ver `TIPOS_INDICADORAVEIS` em
	 * `$lib/gise/indicadores`, que é quem valida.
	 */
	indicador?: IndicadorConfig;
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
	/** Carimbo do 1º envio da resposta de produtividade (local, "YYYY-MM-DD HH:MM:SS") ou null. */
	respostaEnviadaEm?: string | null;
	/** Carimbo da última retificação da resposta de produtividade ou null. */
	respostaAtualizadaEm?: string | null;
	restringirSmartphone: boolean;
	/** Rubrica reutilizável cadastrada pelo policial (PNG dataURL) ou `null`. */
	minhaRubrica?: string | null;
	/** Operações ativas — o editor mostra um formulário por operação. */
	operacoes: Operacao[];
	/** A operação em edição (resolvida no servidor a partir de `?operacaoId=`). */
	operacaoSelecionadaId: number | null;
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
