/**
 * Fachada da camada de dados da GISE.
 *
 * Os módulos vizinhos são divididos por assunto (escalas, seccionais, equipes,
 * membros, presenças, respostas, documentos…) e este arquivo é o único ponto
 * de importação — `src/lib/db.ts` reexporta tudo daqui. Manter a fachada evita
 * que rotas dependam da divisão interna, que já mudou algumas vezes.
 *
 * É também um `entry` declarado no knip: exports listados aqui não são
 * apontados como órfãos, então convém não deixar aqui nada que já não seja
 * usado por alguma rota.
 */
export type { GiseMembro, GiseEquipeComMembros, GiseUnidadeSlot, GiseDetalhado } from './types';
export type { GiseRespostaListagemItem } from './respostas';

export {
	listarGiseEscalas,
	buscarGiseEscala,
	criarGiseEscala,
	buscarGiseDetalhado,
	atualizarGiseEscala,
	reabrirGiseEscala,
	clonarGiseParaData,
	verificarGiseCompleta,
	verificarSaidaCompletaSeccional,
	sincronizarStatusGiseAposPresencaRelatorios,
	tentarPromoverGiseProntaParaFinalizar,
	isSupervisorGiseAtiva,
	isMembroGiseAtiva,
	isSupervisaoGiseAtiva
} from './escalas';

export {
	upsertGiseSeccional,
	atualizarGiseSeccional,
	excluirGiseSeccional,
	buscarGiseSeccionalMembros,
	revogarAssinaturasSeccional,
	adicionarGiseSeccionalUnidade,
	atualizarGiseSeccionalUnidade,
	removerGiseSeccionalUnidade
} from './seccionais';

export {
	atualizarGiseEquipe,
	excluirGiseEquipe,
	criarGiseEquipe,
	verificarSlotEquipe
} from './equipes';

export {
	adicionarGiseMembro,
	removerGiseMembro,
	verificarConflitoMembroGise,
	verificarConflitoHorarioPolicial,
	verificarConflitoHorarioPorGise
} from './membros';

export {
	buscarRespostasProdutividadeSeccional,
	buscarGiseModeloFormulario,
	salvarGiseModeloFormulario,
	buscarRespostaGise,
	salvarRespostaGise,
	listarTodasRespostasGise,
	DEFAULT_SEINT_QUESTIONS,
	DEFAULT_QUESTIONS_FORM_OPERACIONAL
} from './respostas';

export { salvarGiseDocumento, buscarGiseDocumento } from './documentos';

export { salvarEntradaGise, salvarSaidaGise, buscarPresencasGise } from './presencas';

export { buscarVagasPadraoEquipesGise, salvarVagasPadraoEquipesGise } from './vagas-padrao';

export {
	buscarAssinaturasRelatoriosGise,
	buscarAssinaturaRelatorioGise,
	salvarAssinaturaRelatorioGise,
	salvarTermoPresencaGise,
	buscarTermosPresencaGise,
	buscarTermoPresencaGise,
	type TermoPresencaEvidencia
} from './assinaturas';

export {
	resolverParticipacaoGisePolicial,
	horarioGiseLiberado,
	type ParticipacaoGise
} from './participacao';
