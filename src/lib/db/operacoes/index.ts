/**
 * Fachada da camada de dados das OPERAÇÕES extraordinárias.
 *
 * Mesma divisão da fachada da GISE: os módulos vizinhos são por assunto
 * (`crud` = o cadastro em si, `linha-base` = os valores iniciais dos
 * indicadores) e este arquivo é o único ponto de importação — `src/lib/db.ts`
 * reexporta daqui.
 *
 * A autorização NÃO mora neste módulo. Quem responde "esse usuário pode escrever
 * a base dessa unidade?" é `$lib/server/operacoes/permissao`.
 */
export {
	TIPOS_EQUIPE,
	NOME_OPERACAO_PADRAO,
	tiposEquipeDaOperacao,
	operacaoAceitaTipoEquipe,
	normalizarTiposEquipe,
	listarOperacoes,
	buscarOperacao,
	buscarOperacaoPorNome,
	buscarOperacaoDaEscala,
	criarOperacao,
	atualizarOperacao,
	definirAtivoOperacao,
	excluirOperacao,
	contarEscalasPorOperacao,
	clonarModelosFormulario,
	type TipoEquipeOperacao
} from './crud';

export {
	listarLinhaBase,
	mapaLinhaBaseDaUnidade,
	upsertLinhaBase,
	unidadesParticipantesDaOperacao
} from './linha-base';
