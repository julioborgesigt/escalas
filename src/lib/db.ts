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

export { getDB, getR2, hasR2 } from './db/core';
export type { Database } from './db/core';

export {
	auditar,
	registrarAuditComContexto,
	contextoDeEvento,
	listarAuditLog,
	resumoAuditoria,
	verificarIntegridadeAudit,
	metaDaAcao,
	CATALOGO_ACOES
} from './db/audit';
export type {
	AuditEvento,
	AcaoAudit,
	AuditCategoria,
	AuditSeveridade,
	AuditResultado,
	AuditActorTipo,
	AuditCriptoEnv,
	ListarAuditOpts,
	ResultadoIntegridade,
	ResumoAuditoria
} from './db/audit';

export { registrarAceite } from './db/termos';

export {
	salvarConfiguracao,
	buscarExigirFotoAssinatura,
	buscarExigirGpsAssinatura,
	buscarExigirCodigoEmailAssinatura,
	buscarRestringirSmartphone
} from './db/configuracoes';

export {
	vincularAdminGeral,
	desvincularAdminGeral,
	ehAdminGeralVinculado,
	listarPolicialIdsAdminGeral
} from './db/admin-vinculado';

export {
	listarPoliciais,
	buscarPolicial,
	buscarPolicialPorMatricula,
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
	finalizarEscalaFDS,
	desfinalizarEscalaFDS,
	adicionarMultiplasDatasPlantao,
	adicionarTodosPoliciais,
	listarPoliciaisEscala,
	listarPoliciaisEscalaQuery,
	criarSolicitacaoAssinatura,
	buscarSolicitacaoAssinatura,
	excluirSolicitacaoAssinatura,
	listarSolicitacoesEscalas,
	temSolicitacaoParaDpcAdmin
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
	verificarConflitoHorarioPolicial,
	verificarConflitoHorarioPorGise,
	buscarRespostasProdutividadeSeccional,
	salvarGiseDocumento,
	buscarGiseDocumento,
	isSupervisorGiseAtiva,
	isMembroGiseAtiva,
	isSupervisaoGiseAtiva,
	buscarGiseModeloFormulario,
	salvarGiseModeloFormulario,
	buscarRespostaGise,
	salvarRespostaGise,
	listarTodasRespostasGise,
	salvarEntradaGise,
	salvarSaidaGise,
	buscarPresencasGise,
	buscarAssinaturasRelatoriosGise,
	buscarAssinaturaRelatorioGise,
	salvarAssinaturaRelatorioGise,
	verificarSaidaCompletaSeccional,
	sincronizarStatusGiseAposPresencaRelatorios,
	tentarPromoverGiseProntaParaFinalizar,
	buscarGiseSeccionalMembros,
	adicionarGiseSeccionalUnidade,
	atualizarGiseSeccionalUnidade,
	removerGiseSeccionalUnidade,
	buscarVagasPadraoEquipesGise,
	salvarVagasPadraoEquipesGise
} from './db/gise';
