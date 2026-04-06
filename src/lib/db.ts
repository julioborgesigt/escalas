/**
 * Ponto central de acesso ao banco de dados.
 * Re-exporta tudo dos módulos de domínio para manter compatibilidade
 * com todos os imports existentes (`import { ... } from '$lib/db'`).
 *
 * Módulos internos (src/lib/db/):
 *  - core.ts     — getDB + Database type
 *  - policiais.ts — operações de policiais e RBAC
 *  - unidades.ts  — operações de unidades
 *  - escalas.ts   — operações de escalas e escala_policiais
 *  - documentos.ts — operações de documentos assinados
 *  - gise.ts      — operações de GISE (escalas diárias de serviço)
 */

export { getDB } from './db/core';
export type { Database } from './db/core';

export {
	buscarConfiguracao,
	salvarConfiguracao,
	buscarExigirFotoAssinatura,
	buscarExigirGpsAssinatura
} from './db/configuracoes';

export {
	listarPoliciais,
	buscarPolicial,
	criarPolicial,
	atualizarPolicial,
	excluirPolicial,
	listarLotacoes,
	promoverPolicial
} from './db/policiais';

export {
	listarUnidades,
	criarUnidade,
	atualizarUnidade,
	excluirUnidade,
	buscarSeccionaisUnidades
} from './db/unidades';

export {
	listarEscalas,
	buscarEscala,
	criarEscala,
	excluirEscala,
	verificarEscalaExistente,
	marcarVisto,
	adicionarPolicialEscala,
	adicionarMultiplasDatasPlantao,
	atualizarEscalaPolicial,
	removerPolicialEscala,
	adicionarTodosPoliciais,
	listarPoliciaisEscala
} from './db/escalas';

export {
	salvarDocumentoEscala,
	buscarDocumentoEscala,
	excluirDocumentoEscala,
	buscarDocumentoPorHash
} from './db/documentos';

export type { GiseDetalhado } from './db/gise';
export {
	listarGiseEscalas,
	buscarGiseEscala,
	buscarGiseAtiva,
	criarGiseEscala,
	buscarGiseDetalhado,
	atualizarGiseEscala,
	upsertGiseSeccional,
	atualizarGiseSeccional,
	excluirGiseSeccional,
	atualizarGiseEquipe,
	excluirGiseEquipe,
	criarGiseEquipe,
	reabrirGiseEscala,
	revogarAssinaturasSeccional,
	adicionarGiseMembro,
	removerGiseMembro,
	verificarGiseCompleta,
	clonarGiseParaData,
	verificarSlotEquipe,
	verificarConflitoMembroGise,
	buscarRespostasProdutividadeSeccional,
	salvarGiseDocumento,
	buscarGiseDocumento,
	isSupervisorGiseAtiva,
	isMembroGiseAtiva,
	buscarGiseModeloFormulario,
	salvarGiseModeloFormulario,
	buscarRespostaGise,
	salvarRespostaGise,
	listarTodasRespostasGise,
	buscarPresencaGise,
	salvarEntradaGise,
	salvarSaidaGise,
	isDailyGiseSigned,
	buscarPresencasGise,
	buscarAssinaturasRelatoriosGise,
	buscarAssinaturaRelatorioGise,
	salvarAssinaturaRelatorioGise,
	verificarTodosSairam,
	verificarTodosRelatoriosEnviados,
	verificarTodosRelatoriosExtraAssinados,
	buscarGiseSeccionalMembros
} from './db/gise';
