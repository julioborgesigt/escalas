/**
 * Ponto central de acesso ao banco — a API que rotas e endpoints consomem
 * (`import { ... } from '$lib/db'`).
 *
 * Módulos internos (`src/lib/db/`):
 *  - `core.ts`       — `getDB`, bindings R2 e o tipo `Database`
 *  - `policiais.ts`  — cadastro e RBAC
 *  - `unidades.ts`   — unidades e a hierarquia entre elas
 *  - `escalas.ts`    — escalas e `escala_policiais`
 *  - `documentos.ts` — documentos assinados
 *  - `gise/`         — o módulo GISE inteiro
 *
 * **Regra do barrel:** aqui ficam as FUNÇÕES da camada de dados e só os TIPOS
 * que alguém realmente importa por este caminho. Tipo consumido por um módulo
 * só deve vir do módulo de origem — a dependência fica explícita, e o barrel
 * não vira uma segunda lista para manter em dia. Em jul/2026, 16 tipos
 * reexportados aqui não tinham um único consumidor pelo barrel e saíram.
 */

export { getDB, getR2, tryGetR2, hasR2, batchNonEmpty } from './db/core';
export type { Database } from './db/core';

export {
	auditar,
	registrarAuditComContexto,
	contextoDeEvento,
	listarAuditLog,
	resumoAuditoria,
	eventosCriticosRecentes,
	buscarAuditLog,
	cabecaCadeiaAudit,
	verificarIntegridadeAudit,
	metaDaAcao,
	CATALOGO_ACOES
} from './db/audit';
export type { AuditCriptoEnv } from './db/audit';

export { registrarAppLogs, listarAppLogs, resumoAppLogs } from './db/app-logs';

export { registrarAceite } from './db/termos';

export {
	salvarConfiguracao,
	buscarExigirFotoAssinatura,
	buscarExigirGpsAssinatura,
	buscarExigirCodigoEmailAssinatura,
	buscarRestringirSmartphone,
	buscarProvedorEmailPadrao,
	EMAIL_PROVEDOR_PADRAO
} from './db/configuracoes';
export type { EmailProvedor } from './db/configuracoes';

export {
	vincularAdminGeral,
	desvincularAdminGeral,
	ehAdminGeralVinculado,
	buscarAdminVinculadoPorPolicial
} from './db/admin-vinculado';

export {
	listarPoliciais,
	buscarPolicial,
	buscarPolicialPorMatricula,
	buscarRubricaAssinante,
	criarPolicial,
	atualizarPolicial,
	excluirPolicial,
	listarLotacoes,
	promoverPolicial
} from './db/policiais';

export {
	criarSolicitacoesCadastro,
	listarMinhasSolicitacoesCadastro,
	listarSolicitacoesCadastroPendentes,
	decidirSolicitacaoCadastro
} from './db/cadastro-solicitacoes';
export type { CampoSolicitacao } from './db/cadastro-solicitacoes';

export {
	registrarHistorico,
	atualizarPolicialComHistorico,
	listarHistoricoPolicial,
	buscarEventoHistorico,
	afastamentoVigente
} from './db/policial-historico';

export {
	listarUnidades,
	listarTodasUnidades,
	criarUnidade,
	atualizarUnidade,
	definirUnidadeAtiva,
	vinculosDaUnidade,
	descreverVinculosUnidade,
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
	salvarTermoPresencaGise,
	buscarTermosPresencaGise,
	buscarTermoPresencaGise,
	resolverParticipacaoGisePolicial,
	horarioGiseLiberado,
	verificarSaidaCompletaSeccional,
	sincronizarStatusGiseAposPresencaRelatorios,
	tentarPromoverGiseProntaParaFinalizar,
	buscarGiseSeccionalMembros,
	adicionarGiseSeccionalUnidade,
	atualizarGiseSeccionalUnidade,
	removerGiseSeccionalUnidade,
	buscarVagasPadraoEquipesGise,
	salvarVagasPadraoEquipesGise,
	DEFAULT_SEINT_QUESTIONS,
	DEFAULT_QUESTIONS_FORM_OPERACIONAL
} from './db/gise';
