/**
 * Tipos de pergunta do formulário de produtividade — quais abrem listagem
 * detalhada, quais aceitam sub-pergunta, e ONDE cada um grava no blob de
 * respostas.
 *
 * Existe porque essas três respostas eram dadas em sete lugares: o widget do
 * formulário (`RelatorioProdutividade`), o editor do admin
 * (`ConfigurarFormulario`) e a expansão do relatório (`db/gise/respostas.ts`).
 * A pior das sete é a das CHAVES: a tela escreve `prisoes_lista` e o relatório
 * lê `prisoes_lista`, cada um com o literal repetido no seu arquivo. Um lado
 * mudar sem o outro não quebra nada visível — o policial preenche, salva, e o
 * detalhe simplesmente não aparece no PDF assinado.
 *
 * ## Chave fixa × chave derivada
 *
 * Os tipos ORIGINAIS gravam em chave fixa (`prisoes_qtd`/`prisoes_lista`),
 * escolha deliberada na época: renomear a pergunta no editor não perde o
 * detalhe já gravado. O preço é que cada um deles só funciona UMA VEZ no
 * formulário — duas perguntas do mesmo tipo escreveriam uma por cima da outra,
 * e o relatório mostraria a mesma lista nas duas.
 *
 * `lista_detalhada` existe para poder repetir: as chaves saem da `key` da
 * pergunta (`extra_1753...__lista`), então cada pergunta tem o seu espaço. A
 * `key` é gerada na criação e não é editável em lugar nenhum da UI — é o que
 * torna essa derivação segura.
 */

/**
 * O tipo genérico: quantidade + lista de itens (nome e procedimento),
 * REUTILIZÁVEL em quantas perguntas o admin quiser. Os demais tipos de lista
 * são de uso único (ver o cabeçalho).
 */
export const TIPO_LISTA_REUTILIZAVEL = 'lista_detalhada';

/**
 * Tipo de COBERTURA: dois números na mesma pergunta — o total existente e a
 * parte atendida —, cuja razão é a resposta que interessa.
 *
 * Existe porque "atender 100% das ocorrências" não se mede com um número só: 12
 * atendimentos são ótimos se houve 12 ocorrências e ruins se houve 40. Duas
 * perguntas separadas resolveriam a coleta e não o resto — o par ficaria
 * implícito, e nenhum gráfico saberia que uma é denominador da outra.
 *
 * Chaves DERIVADAS da `key` (como `lista_detalhada`), então é reutilizável:
 * quantas perguntas de cobertura o admin quiser, sem uma sobrescrever a outra.
 */
export const TIPO_PROPORCAO = 'proporcao';

/** Onde cada tipo ORIGINAL grava quantidade e lista. Chaves fixas, de propósito. */
const CHAVES_FIXAS: Record<string, { qtd: string; lista: string }> = {
	mandados_maiores: { qtd: 'mandados_qtd', lista: 'mandados_lista' },
	prisoes_maiores: { qtd: 'prisoes_qtd', lista: 'prisoes_lista' },
	apreensoes_menores: { qtd: 'apreensoes_qtd', lista: 'apreensoes_lista' },
	celulares_complex: { qtd: 'celulares_qtd', lista: 'celulares_lista' },
	analise_complex: { qtd: 'analise_qtd', lista: 'analise_lista' },
	relatorios_seint_complex: { qtd: 'relatorios_seint_qtd', lista: 'relatorios_seint_lista' },
	foragidos_complex: { qtd: 'foragidos_qtd', lista: 'foragidos_lista' },
	operacoes_seint_complex: { qtd: 'operacoes_seint_qtd', lista: 'operacoes_seint_lista' },
	operacoes_seint_pura: { qtd: 'operacoes_seint_qtd', lista: 'operacoes_seint_lista' }
};

/** O mínimo de uma pergunta para resolver as chaves dela. */
type PerguntaChaveavel = { tipo: string; key: string };

/**
 * Tipos que abrem o bloco "quantidade + listagem detalhada".
 *
 * `operacoes_seint_pura` está aqui, mas é o único sem par Sim/Não: a lista dele
 * aparece sempre, sem depender de resposta anterior.
 */
export const TIPOS_COM_LISTA: readonly string[] = [
	TIPO_LISTA_REUTILIZAVEL,
	'mandados_maiores',
	'prisoes_maiores',
	'apreensoes_menores',
	'celulares_complex',
	'analise_complex',
	'relatorios_seint_complex',
	'foragidos_complex',
	'operacoes_seint_complex',
	'operacoes_seint_pura'
];

/**
 * Tipos que aceitam SUB-PERGUNTA (o "se Sim, ...") — os de lista mais os dois
 * de seleção por chips e o `sim_nao` puro.
 */
export const TIPOS_COM_FILHOS: readonly string[] = [
	...TIPOS_COM_LISTA,
	'sim_nao',
	'drogas_complex',
	'armas_complex'
];

/**
 * As chaves do blob onde esta pergunta grava quantidade e lista, ou `null` se o
 * tipo não tem listagem. Fonte ÚNICA para quem escreve (formulário) e para quem
 * lê (relatório) — ver o cabeçalho.
 */
export function chavesLista(p: PerguntaChaveavel): { qtd: string; lista: string } | null {
	if (p.tipo === TIPO_LISTA_REUTILIZAVEL) {
		return { qtd: `${p.key}__qtd`, lista: `${p.key}__lista` };
	}
	return CHAVES_FIXAS[p.tipo] ?? null;
}

/**
 * Como `chavesLista`, mas nunca `null`.
 *
 * O snippet do formulário resolve as chaves no topo, ANTES de saber por qual
 * ramo de `tipo` vai passar, então precisa de um par mesmo para tipos sem
 * lista — em que ele nunca é lido. O valor de reserva é o histórico, mantido
 * para não mudar comportamento de blob já gravado.
 */
export function chavesListaComFallback(p: PerguntaChaveavel): { qtd: string; lista: string } {
	return chavesLista(p) ?? CHAVES_FIXAS.operacoes_seint_pura;
}

/**
 * As duas chaves de uma pergunta de COBERTURA (`total` e `parte`), ou `null` se
 * o tipo não for esse.
 *
 * Fonte única — quem escreve (o formulário), quem lê no relatório assinado e
 * quem soma no painel de indicadores resolvem as chaves por aqui. É a mesma
 * armadilha do cabeçalho: dois literais iguais em arquivos diferentes não
 * quebram nada visível quando divergem, só param de bater.
 */
export function chavesProporcao(p: PerguntaChaveavel): { total: string; parte: string } | null {
	if (p.tipo !== TIPO_PROPORCAO) return null;
	return { total: `${p.key}__total`, parte: `${p.key}__parte` };
}

/**
 * Tipos que PODEM virar gráfico de barras no painel de produtividade — os que
 * produzem um número por relatório, mais o `sim_nao`, que vira contagem de
 * ocorrências ("em quantos plantões houve").
 *
 * Poder e dever são coisas diferentes: quem decide se a pergunta ENTRA no painel
 * é a marca `grafico` dela, não o tipo. Esta lista só diz onde a marca faz
 * sentido — é ela que decide se a caixinha aparece no editor.
 *
 * Não é nem subconjunto nem superconjunto de `TIPOS_INDICADORAVEIS`
 * (`$lib/gise/indicadores`), e as duas diferenças são deliberadas:
 *
 * - `sim_nao` entra AQUI e não lá: agrega como volume de eventos, mas não tem
 *   meta nem linha de base a comparar. Um gráfico é uma leitura; um indicador é
 *   uma promessa;
 * - `proporcao` e os tipos de lista entram LÁ e não aqui: a resposta deles não
 *   mora em `key`, e sim em `key__parte` / `key__qtd`. O gráfico de barras lê
 *   por `mappedKey` (`$lib/produtividade/questions`), que só cobre os tipos
 *   listados em `KEY_MAP` — marcar um `proporcao` desenharia uma barra de zeros.
 *   Cobertura já tem lugar próprio: a seção de indicadores.
 *
 * `drogas_complex` e `armas_complex` entram, mas raramente como COLUNAS: o que
 * interessa neles é a quebra por tipo de droga e por tipo de arma, e é por isso
 * que são os dois únicos tipos que aceitam a forma `detalhe`.
 */
const TIPOS_GRAFICAVEIS: readonly string[] = [
	'numero',
	'select_99',
	'select_999',
	'sim_nao',
	'drogas_complex',
	'armas_complex',
	'celulares_complex',
	'analise_complex',
	'relatorios_seint_complex',
	'foragidos_complex',
	'operacoes_seint_complex',
	'operacoes_seint_pura'
];

/**
 * O tipo aceita a marca de gráfico? Único lugar que responde — usado pelo editor
 * (para mostrar as caixinhas) e por `mapQuestions` (para descartar marca herdada
 * de uma pergunta cujo tipo mudou depois).
 */
export function podeSerGrafico(tipo: string): boolean {
	return TIPOS_GRAFICAVEIS.includes(tipo);
}

/**
 * Tipos cuja resposta guarda uma quebra por CATEGORIA, e que por isso admitem a
 * forma `detalhe` no painel.
 *
 * São dois, e a lista é curta por um motivo estrutural e não por falta de
 * vontade: só `drogas_complex` e `armas_complex` gravam um objeto
 * `{ categoria: valor }` no blob (`drogas_detalhe`, `armas_detalhe`). Uma
 * pergunta de número guarda um número — não há segundo eixo para quebrar, e um
 * "detalhamento" dela seria um card de uma barra só.
 *
 * Os tipos de LISTA guardam array de objetos (`{nome, delegacia, situacao}`), e
 * dariam para quebrar por um dos campos. Não dá para adivinhar QUAL, então
 * ficam de fora até alguém pedir com o campo escolhido no editor.
 */
const TIPOS_COM_DETALHE: readonly string[] = ['drogas_complex', 'armas_complex'];

/**
 * A pergunta tem quebra por categoria para detalhar? Decide se a caixinha
 * "Detalhamento" aparece habilitada no editor e se `mapQuestions` respeita a
 * marca — mesmo par poder/dever de `podeSerGrafico`.
 */
export function podeDetalhar(tipo: string): boolean {
	return TIPOS_COM_DETALHE.includes(tipo);
}

/** Forma de um item vazio da lista, por tipo. */
export const ITEM_PADRAO: Record<string, Record<string, string>> = {
	[TIPO_LISTA_REUTILIZAVEL]: { nome: '', mandado: '' },
	mandados_maiores: { nome: '', mandado: '' },
	prisoes_maiores: { nome: '', mandado: '' },
	apreensoes_menores: { nome: '', mandado: '' },
	celulares_complex: { modelo: '', n_proc: '', delegacia: '', situacao: '' },
	analise_complex: { tamanho: '', modelo: '', n_proc: '', delegacia: '' },
	relatorios_seint_complex: { n_relat: '', q_alvos: '', proc_vinc: '', delegacia: '' },
	foragidos_complex: { nome: '', proc_vinc: '', delegacia: '', resultado: '' },
	operacoes_seint_complex: { nome: '', delegacia: '' },
	operacoes_seint_pura: { nome: '', delegacia: '' }
};
