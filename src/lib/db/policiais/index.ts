/**
 * Fachada da camada de dados do POLICIAL — o cadastro e o que orbita a
 * identidade dele.
 *
 * Um módulo por assunto, porque as quatro perguntas são independentes:
 *  - `cadastro.ts` — CRUD, lotações, promoção (RBAC) e a rubrica do assinante;
 *  - `historico.ts` — a linha do tempo funcional, incluindo `afastamentoVigente`
 *    (o predicado que decide se o policial pode ser escalado hoje);
 *  - `exclusao.ts` — o impedimento de excluir quem tem vínculo ASSINADO, que é
 *    regra de integridade documental, não de cadastro;
 *  - `solicitacoes.ts` — os pedidos de correção de cadastro feitos pelo próprio
 *    policial e a decisão do admin.
 *
 * `atualizarPolicial` (cadastro) e `atualizarPolicialComHistorico` (histórico)
 * NÃO são intercambiáveis: a segunda grava o evento junto, na mesma transação.
 * Quem edita dado funcional pela UI usa a segunda.
 *
 * Até ago/2026 estes quatro viviam na raiz de `lib/db/` como `policiais.ts` +
 * `policial-*.ts` + `cadastro-solicitacoes.ts`, misturados a outros domínios —
 * o sintoma que o `CLAUDE.md` descreve para `lib/server/`.
 */
export {
	listarPoliciais,
	buscarPolicial,
	buscarPolicialPorMatricula,
	buscarRubricaAssinante,
	criarPolicial,
	upsertPolicial,
	atualizarPolicial,
	excluirPolicial,
	listarLotacoes,
	promoverPolicial
} from './cadastro';

export {
	registrarHistorico,
	atualizarPolicialComHistorico,
	listarHistoricoPolicial,
	buscarEventoHistorico,
	afastamentoVigente
} from './historico';

export { impedimentoParaExcluirPolicial } from './exclusao';

export {
	criarSolicitacoesCadastro,
	listarMinhasSolicitacoesCadastro,
	listarSolicitacoesCadastroPendentes,
	decidirSolicitacaoCadastro
} from './solicitacoes';
export type { CampoSolicitacao } from './solicitacoes';
