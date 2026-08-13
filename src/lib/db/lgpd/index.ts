/**
 * Fachada da camada de dados de LGPD.
 *
 * Três assuntos que só se parecem por serem da mesma lei, e por isso um módulo
 * cada em vez de um `lgpd.ts`:
 *  - `solicitacoes.ts` — os pedidos do titular (acesso, correção, exclusão) e a
 *    resposta do controlador;
 *  - `incidentes.ts` — registro de incidente de segurança com dados pessoais;
 *  - `retencao.ts` — a política de prazos e a limpeza que a executa, mais o
 *    diagnóstico de saúde que `/api/health` consulta.
 *
 * Até ago/2026 os três viviam na raiz de `lib/db/` como `lgpd-*.ts`, junto de
 * mais dois domínios — o sintoma que o `CLAUDE.md` descreve para
 * `lib/server/`: "arquivo novo cujo nome só faz sentido com prefixo de domínio
 * pertence a uma subpasta".
 *
 * A autorização não mora aqui: quem pode ler ou responder uma solicitação é
 * decidido nas rotas de `/api/admin/lgpd/**` e em `/api/lgpd/solicitar`.
 */
export {
	criarSolicitacao,
	listarSolicitacoes,
	listarSolicitacoesPorUsuario,
	buscarSolicitacao,
	responderSolicitacao
} from './solicitacoes';

export {
	registrarIncidente,
	listarIncidentes,
	buscarIncidente,
	atualizarIncidente
} from './incidentes';

export {
	carregarConfigRetencao,
	executarLimpezaRetencao,
	verificarSaudeLimpezaRetencao
} from './retencao';
export type { SaudeLimpezaRetencao } from './retencao';
