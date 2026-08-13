/**
 * Trilha de auditoria forense.
 *
 * Registra ações relevantes do sistema de forma estruturada, classificada e à
 * prova de adulteração — inspirado em CloudTrail / Datadog Audit Trail / Stripe.
 *
 * Pilares, um por módulo:
 *  - `catalogo.ts` — catálogo central de ações (`CATALOGO_ACOES`): rótulo PT-BR,
 *    categoria e severidade padrão. Fonte única para UI e relatórios;
 *  - `cadeia.ts` — cadeia de hash encadeada (`seq`/`hash_anterior`/
 *    `hash_registro`) e a forma canônica sobre a qual ela é calculada;
 *  - `escrita.ts` — gravação (Ator × Alvo, resultado como dado de 1ª classe, IP
 *    anonimizado para LGPD + `ip_cifrado` AES-GCM para perícia) e as pendências;
 *  - `consulta.ts` — listagem, resumo e `verificarIntegridadeAudit`.
 *
 * Este índice existe para que os call sites não precisem saber dessa divisão:
 * `import { auditar } from '$lib/db/audit'` continua valendo, e é o que os dez
 * consumidores usam.
 */
// Só o que os call sites de FORA consomem. Os tipos internos de cada módulo
// (`AuditEvento`, `ListarAuditOpts`, `ResultadoIntegridade`…) seguem exportados
// nos arquivos deles, para quem importa o módulo direto — republicá-los aqui
// sem consumidor engorda a fachada, e o `knip` cobra.
export { CATALOGO_ACOES, metaDaAcao, type AcaoAudit } from './catalogo';

export { canonicalAudit, calcularHashRegistro, type AuditCriptoEnv } from './cadeia';

export {
	anonimizarIp,
	contextoDeEvento,
	auditar,
	auditarDoEvento,
	registrarAuditComContexto,
	reprocessarPendenciasAudit,
	contarPendenciasAudit
} from './escrita';

export {
	listarAuditLog,
	resumoAuditoria,
	buscarAuditLog,
	cabecaCadeiaAudit,
	verificarIntegridadeAudit,
	eventosCriticosRecentes
} from './consulta';
