/**
 * Trilha de auditoria forense.
 *
 * Registra ações relevantes do sistema de forma estruturada, classificada e à
 * prova de adulteração — inspirado em CloudTrail / Datadog Audit Trail / Stripe.
 *
 * Pilares:
 *  - Catálogo central de ações (`CATALOGO_ACOES`): cada ação carrega rótulo PT-BR,
 *    categoria e severidade padrão — fonte única para UI e relatórios.
 *  - Ator x Alvo: separa QUEM executou de SOBRE QUEM/O QUÊ recaiu a ação.
 *  - Resultado: sucesso / falha / negado como dado de 1ª classe.
 *  - Privacidade: `ip` anonimizado (LGPD) + `ip_cifrado` (AES-GCM, perícia).
 *  - Tamper-evidence: cadeia de hash encadeada (`seq`/`hash_anterior`/
 *    `hash_registro`) verificável por `verificarIntegridadeAudit`.
 *
 * A gravação NUNCA lança: falhas são logadas e jamais bloqueiam o fluxo principal.
 */

import { desc, asc, eq, and, gte, lte, isNotNull, sql } from 'drizzle-orm';
import { auditLog } from '../server/schema';
import type { Database } from './core';
import type { AuditLog } from '../server/schema';
import { logger } from '../server/logger';
import { getRequestCtx } from '../server/request-context';
import { cifrarTexto } from '../crypto/field-cripto';
import { bytesToHex, hexToBytes } from '../crypto/hex';

// ---- Classificação ----------------------------------------------------------

export type AuditCategoria =
	| 'autenticacao'
	| 'escala'
	| 'gise'
	| 'policial'
	| 'unidade'
	| 'configuracao'
	| 'documento'
	| 'lgpd'
	| 'sistema';

export type AuditSeveridade = 'info' | 'aviso' | 'critico';
export type AuditResultado = 'sucesso' | 'falha' | 'negado';
export type AuditActorTipo = 'policial' | 'admin' | 'sistema' | 'webhook';

interface AcaoMeta {
	label: string;
	categoria: AuditCategoria;
	severidade: AuditSeveridade;
}

/**
 * Catálogo central de ações auditáveis. Adicione AQUI ao instrumentar um novo
 * fluxo — o rótulo, a categoria e a severidade derivam deste mapa. A coluna
 * `acao` é texto livre no banco, então ações fora do catálogo ainda gravam
 * (com fallback em `metaDaAcao`), mas o ideal é mantê-las registradas aqui.
 */
export const CATALOGO_ACOES = {
	// Autenticação / sessão
	login: { label: 'Login', categoria: 'autenticacao', severidade: 'info' },
	logout: { label: 'Logout', categoria: 'autenticacao', severidade: 'info' },
	falha_login: { label: 'Falha de login', categoria: 'autenticacao', severidade: 'aviso' },
	login_bootstrap: {
		label: 'Login break-glass (Super Admin sem 2FA)',
		categoria: 'autenticacao',
		severidade: 'critico'
	},
	login_certificado: {
		label: 'Login por certificado A3',
		categoria: 'autenticacao',
		severidade: 'info'
	},
	alterar_senha: { label: 'Alteração de senha', categoria: 'autenticacao', severidade: 'aviso' },
	solicitar_redefinicao_senha: {
		label: 'Solicitação de redefinição de senha',
		categoria: 'autenticacao',
		severidade: 'info'
	},
	redefinir_senha: {
		label: 'Redefinição de senha concluída',
		categoria: 'autenticacao',
		severidade: 'aviso'
	},
	primeiro_acesso_link: {
		label: 'Link de primeiro acesso',
		categoria: 'autenticacao',
		severidade: 'info'
	},
	verificar_email_pessoal: {
		label: 'Verificação de e-mail pessoal',
		categoria: 'autenticacao',
		severidade: 'info'
	},
	alternar_modulo: {
		label: 'Alternância de módulo (GISE/Escalas)',
		categoria: 'autenticacao',
		severidade: 'info'
	},
	aceitar_termos: {
		label: 'Aceite do Termo de Uso',
		categoria: 'autenticacao',
		severidade: 'info'
	},

	// Policiais / RBAC
	criar_policial: { label: 'Criação de policial', categoria: 'policial', severidade: 'aviso' },
	editar_policial: { label: 'Edição de policial', categoria: 'policial', severidade: 'info' },
	excluir_policial: { label: 'Exclusão de policial', categoria: 'policial', severidade: 'critico' },
	mudar_papel: { label: 'Mudança de papel (RBAC)', categoria: 'policial', severidade: 'critico' },
	toggle_admin_geral: {
		label: 'Alteração de Admin Geral',
		categoria: 'policial',
		severidade: 'critico'
	},
	importar_policiais: {
		label: 'Importação de policiais em massa',
		categoria: 'policial',
		severidade: 'aviso'
	},
	registrar_movimentacao: {
		label: 'Movimentação de policial (transferência)',
		categoria: 'policial',
		severidade: 'aviso'
	},
	registrar_afastamento: {
		label: 'Registro de afastamento de policial',
		categoria: 'policial',
		severidade: 'info'
	},
	desvincular_policial: {
		label: 'Desvinculação (baixa) de policial',
		categoria: 'policial',
		severidade: 'critico'
	},

	// Unidades
	criar_unidade: { label: 'Criação de unidade', categoria: 'unidade', severidade: 'aviso' },
	editar_unidade: { label: 'Edição de unidade', categoria: 'unidade', severidade: 'info' },
	excluir_unidade: { label: 'Exclusão de unidade', categoria: 'unidade', severidade: 'critico' },

	// Escalas
	criar_escala: { label: 'Criação de escala', categoria: 'escala', severidade: 'info' },
	editar_escala: { label: 'Edição de escala', categoria: 'escala', severidade: 'info' },
	excluir_escala: { label: 'Exclusão de escala', categoria: 'escala', severidade: 'aviso' },
	adicionar_policial_escala: {
		label: 'Policial adicionado à escala',
		categoria: 'escala',
		severidade: 'info'
	},
	remover_policial_escala: {
		label: 'Policial removido da escala',
		categoria: 'escala',
		severidade: 'info'
	},
	assinar_escala: { label: 'Assinatura de escala', categoria: 'escala', severidade: 'aviso' },
	revogar_assinatura: {
		label: 'Revogação de assinatura',
		categoria: 'escala',
		severidade: 'critico'
	},
	finalizar_escala_fds: {
		label: 'Finalização de escala de fim de semana',
		categoria: 'escala',
		severidade: 'info'
	},
	solicitar_assinatura_escala: {
		label: 'Solicitação de assinatura de escala',
		categoria: 'escala',
		severidade: 'info'
	},
	exportar_escala: { label: 'Exportação de escala', categoria: 'escala', severidade: 'info' },

	// GISE
	criar_gise: { label: 'Criação de GISE', categoria: 'gise', severidade: 'info' },
	editar_gise: { label: 'Edição de GISE', categoria: 'gise', severidade: 'info' },
	finalizar_gise: { label: 'Finalização de GISE', categoria: 'gise', severidade: 'aviso' },
	reabrir_gise: { label: 'Reabertura de GISE', categoria: 'gise', severidade: 'critico' },
	assinar_gise: { label: 'Assinatura de GISE', categoria: 'gise', severidade: 'aviso' },
	assinar_relatorio_gise: {
		label: 'Assinatura de relatório GISE',
		categoria: 'gise',
		severidade: 'aviso'
	},
	presenca_gise_entrada: {
		label: 'Registro de entrada (presença GISE)',
		categoria: 'gise',
		severidade: 'info'
	},
	presenca_gise_saida: {
		label: 'Registro de saída (presença GISE)',
		categoria: 'gise',
		severidade: 'info'
	},
	rubrica_cadastrada: {
		label: 'Cadastro/atualização de rubrica reutilizável',
		categoria: 'policial',
		severidade: 'info'
	},
	rubrica_excluida: {
		label: 'Exclusão de rubrica reutilizável',
		categoria: 'policial',
		severidade: 'aviso'
	},
	solicitar_alteracao_cadastro: {
		label: 'Solicitação de alteração cadastral (Meu perfil)',
		categoria: 'policial',
		severidade: 'info'
	},
	aprovar_alteracao_cadastro: {
		label: 'Aprovação de alteração cadastral',
		categoria: 'policial',
		severidade: 'aviso'
	},
	rejeitar_alteracao_cadastro: {
		label: 'Rejeição de alteração cadastral',
		categoria: 'policial',
		severidade: 'info'
	},
	exportar_gise: { label: 'Exportação de GISE', categoria: 'gise', severidade: 'info' },
	salvar_config_gise: {
		label: 'Alteração de configuração do GISE',
		categoria: 'configuracao',
		severidade: 'aviso'
	},

	// Documentos / assinatura
	preparar_assinatura: {
		label: 'Preparação de assinatura',
		categoria: 'documento',
		severidade: 'info'
	},
	download_validar_forense: {
		label: 'Download forense de validação',
		categoria: 'documento',
		severidade: 'info'
	},

	// Configuração
	salvar_config_assinatura: {
		label: 'Alteração de configuração de assinatura',
		categoria: 'configuracao',
		severidade: 'aviso'
	},
	salvar_config_geral: {
		label: 'Alteração de configuração geral',
		categoria: 'configuracao',
		severidade: 'aviso'
	},

	// LGPD
	registrar_incidente: {
		label: 'Registro de incidente LGPD',
		categoria: 'lgpd',
		severidade: 'aviso'
	},
	atualizar_incidente: {
		label: 'Atualização de incidente LGPD',
		categoria: 'lgpd',
		severidade: 'info'
	},
	solicitar_direito_lgpd: {
		label: 'Solicitação de direito do titular (LGPD)',
		categoria: 'lgpd',
		severidade: 'info'
	},
	responder_solicitacao_lgpd: {
		label: 'Resposta a solicitação LGPD',
		categoria: 'lgpd',
		severidade: 'aviso'
	},

	// Sistema / integrações
	limpeza_retencao: {
		label: 'Limpeza de retenção (LGPD)',
		categoria: 'sistema',
		severidade: 'info'
	},
	sync_policiais: {
		label: 'Sincronização de policiais (webhook)',
		categoria: 'sistema',
		severidade: 'aviso'
	},
	sync_unidades: {
		label: 'Sincronização de unidades (webhook)',
		categoria: 'sistema',
		severidade: 'aviso'
	},
	reset_policiais: {
		label: 'Reset de policiais (webhook)',
		categoria: 'sistema',
		severidade: 'critico'
	},
	verificar_integridade_audit: {
		label: 'Verificação de integridade da trilha',
		categoria: 'sistema',
		severidade: 'info'
	}
} as const satisfies Record<string, AcaoMeta>;

export type AcaoAudit = keyof typeof CATALOGO_ACOES;

/** Metadados da ação (rótulo/categoria/severidade), com fallback para ações fora do catálogo. */
export function metaDaAcao(acao: string): AcaoMeta {
	return (
		(CATALOGO_ACOES as Record<string, AcaoMeta>)[acao] ?? {
			label: acao,
			categoria: 'sistema',
			severidade: 'info'
		}
	);
}

// ---- Configuração de criptografia ------------------------------------------

export interface AuditCriptoEnv {
	/** AES-256-GCM para o IP completo (hex 32 bytes). Sem ela: só IP anonimizado. */
	AUDIT_IP_ENCRYPTION_KEY?: string;
	/** HMAC-SHA256 da cadeia de hash (hex 32 bytes). Sem ela: cadeia em SHA-256 puro. */
	AUDIT_CHAIN_KEY?: string;
}

function lerChave(valor: string | undefined): string | undefined {
	const v = valor?.trim();
	return v ? v : undefined;
}

// ---- Cadeia de hash (tamper-evidence) --------------------------------------

const GENESIS = 'GENESIS';

async function sha256Hex(s: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s) as BufferSource);
	return bytesToHex(new Uint8Array(buf));
}

async function hmacHex(keyHex: string, s: string): Promise<string> {
	const raw = hexToBytes(keyHex);
	if (!raw || raw.length !== 32) {
		throw new Error('AUDIT_CHAIN_KEY inválida: esperado 32 bytes em hex (64 chars).');
	}
	const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign'
	]);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(s) as BufferSource);
	return bytesToHex(new Uint8Array(sig));
}

/** Campos que entram, em ordem fixa, na serialização canônica usada pelo hash. */
interface LinhaHashavel {
	seq: number;
	created_at: string;
	actor_tipo: string | null;
	usuario_id: number | null;
	usuario_nome: string;
	usuario_papel: string | null;
	acao: string;
	categoria: string | null;
	severidade: string | null;
	resultado: string | null;
	entidade: string;
	entidade_id: number | null;
	alvo_tipo: string | null;
	alvo_id: number | null;
	alvo_nome: string | null;
	detalhes: string | null;
	metadados: string | null;
	dados_antes: string | null;
	dados_depois: string | null;
	ip: string | null;
	ip_cifrado: string | null;
	user_agent: string | null;
	request_id: string | null;
	rota: string | null;
	metodo: string | null;
	hash_anterior: string;
}

/**
 * Serialização canônica e determinística da linha — o que entra no hash. A ordem
 * é FIXA; alterá-la quebra a verificação de linhas já gravadas. Em caso de
 * mudança de formato, introduza uma nova tag de versão no hash (ver `tagHash`).
 */
export function canonicalAudit(l: LinhaHashavel): string {
	return JSON.stringify([
		l.seq,
		l.created_at,
		l.actor_tipo,
		l.usuario_id,
		l.usuario_nome,
		l.usuario_papel,
		l.acao,
		l.categoria,
		l.severidade,
		l.resultado,
		l.entidade,
		l.entidade_id,
		l.alvo_tipo,
		l.alvo_id,
		l.alvo_nome,
		l.detalhes,
		l.metadados,
		l.dados_antes,
		l.dados_depois,
		l.ip,
		l.ip_cifrado,
		l.user_agent,
		l.request_id,
		l.rota,
		l.metodo,
		l.hash_anterior
	]);
}

/**
 * Calcula `hash_registro` a partir do hash anterior e do payload canônico.
 * Prefixo de algoritmo (`h:` HMAC / `s:` SHA-256) torna a cadeia verificável
 * mesmo se a chave HMAC for adotada no meio da vida do log.
 *
 * Resiliência: uma `AUDIT_CHAIN_KEY` inválida (hex fora do tamanho) NÃO pode
 * derrubar a auditoria inteira — neste caso caímos para SHA-256 (tag `s:`) e
 * registramos um aviso. Melhor uma cadeia degradada do que perder o evento.
 */
export async function calcularHashRegistro(
	hashAnterior: string,
	canonical: string,
	chainKey?: string
): Promise<string> {
	const material = hashAnterior + '\n' + canonical;
	if (chainKey) {
		try {
			return 'h:' + (await hmacHex(chainKey, material));
		} catch (err) {
			logger.warn('[audit] AUDIT_CHAIN_KEY inválida — usando SHA-256 neste registro', {
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}
	return 's:' + (await sha256Hex(material));
}

// ---- Anonimização de IP (LGPD) ---------------------------------------------

/**
 * Anonimiza IPs para conformidade LGPD.
 *  - IPv4: zera o último octeto (`/24`): 192.168.1.42 → 192.168.1.0
 *  - IPv6: zera os 64 bits finais (`/64`): 2001:db8::1 → 2001:db8:0:0::
 *
 * O `/64` (4 grupos) é o equivalente em granularidade do `/24` IPv4: identifica
 * a rede do ISP, não o assinante. Notação `::` é expandida antes do corte.
 */
export function anonimizarIp(ip: string | null | undefined): string | null {
	if (!ip) return null;
	if (ip.includes(':')) {
		try {
			let parts: string[];
			if (ip.includes('::')) {
				const [head, tail] = ip.split('::');
				const headParts = head ? head.split(':') : [];
				const tailParts = tail ? tail.split(':') : [];
				const zerosFaltando = 8 - headParts.length - tailParts.length;
				if (zerosFaltando < 0) return null;
				parts = [...headParts, ...Array<string>(zerosFaltando).fill('0'), ...tailParts];
			} else {
				parts = ip.split(':');
			}
			if (parts.length === 8) {
				return parts.slice(0, 4).join(':') + '::';
			}
		} catch {
			// fallback
		}
		return null;
	}
	const octets = ip.split('.');
	if (octets.length === 4) {
		return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
	}
	return null;
}

// ---- Gravação ---------------------------------------------------------------

/** Timestamp UTC no mesmo formato do default `datetime('now')` do SQLite. */
function agoraUtc(): string {
	return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function comoJson(v: Record<string, unknown> | null | undefined): string | null {
	if (v == null) return null;
	try {
		return JSON.stringify(v);
	} catch {
		return null;
	}
}

/** Evento de auditoria (modelo rico). */
export interface AuditEvento {
	acao: AcaoAudit | (string & {});
	/** Ator que executou. `null` = ação do sistema/automação. */
	usuario?: { id: number; nome: string; papel?: string | null; tipo?: AuditActorTipo } | null;
	actor_tipo?: AuditActorTipo;
	/** Tipo da entidade afetada (compat com o log original). */
	entidade: string;
	entidade_id?: number | null;
	/** Alvo explícito (quando difere do ator — ex.: admin reseta senha de OUTRO). */
	alvo_tipo?: string | null;
	alvo_id?: number | null;
	alvo_nome?: string | null;
	/** Override da classificação derivada do catálogo. */
	categoria?: AuditCategoria;
	severidade?: AuditSeveridade;
	resultado?: AuditResultado;
	/** Texto humano (equivale ao antigo `detalhes`). */
	detalhes?: string | null;
	metadados?: Record<string, unknown> | null;
	dados_antes?: Record<string, unknown> | null;
	dados_depois?: Record<string, unknown> | null;
	/** Contexto de request. */
	ip?: string | null;
	user_agent?: string | null;
	request_id?: string | null;
	rota?: string | null;
	metodo?: string | null;
}

/** Forma mínima de um RequestEvent do SvelteKit consumida pela auditoria. */
export interface EventoRequestLike {
	request: { method: string; headers: { get(name: string): string | null } };
	url: { pathname: string };
	getClientAddress?: () => string;
	locals?: { requestId?: string };
	// `env` fica `unknown` para aceitar o `App.Platform` real (cujo `env` é o tipo
	// `Env` completo do Cloudflare) sem acoplar a auditoria a ele — o cast para
	// `AuditCriptoEnv` acontece dentro de `contextoDeEvento`.
	platform?: { env?: unknown } | null;
}

/**
 * Extrai de um RequestEvent o contexto comum de auditoria (IP, user-agent,
 * request_id, rota, método) e a `env` de criptografia. Reduz a instrumentação
 * de cada handler a:
 *
 *   const { contexto, env } = contextoDeEvento(event);
 *   await auditar(db, { acao, usuario, entidade, ...contexto }, { env });
 */
export function contextoDeEvento(event: EventoRequestLike): {
	contexto: Pick<AuditEvento, 'ip' | 'user_agent' | 'request_id' | 'rota' | 'metodo'>;
	env?: AuditCriptoEnv;
} {
	let ip: string | null = null;
	try {
		ip = event.getClientAddress?.() ?? null;
	} catch {
		// getClientAddress pode lançar fora do contexto de uma request; mantém null.
	}
	return {
		contexto: {
			ip,
			user_agent: event.request.headers.get('user-agent'),
			request_id: event.locals?.requestId ?? null,
			rota: event.url.pathname,
			metodo: event.request.method
		},
		env: (event.platform?.env ?? undefined) as AuditCriptoEnv | undefined
	};
}

const MAX_TENTATIVAS_CHAIN = 5;

function ehViolacaoSeq(err: unknown): boolean {
	const msg = (err instanceof Error ? err.message : String(err)).toUpperCase();
	return msg.includes('UNIQUE') && (msg.includes('SEQ') || msg.includes('UQ_AUDIT_SEQ'));
}

/**
 * Registra um evento na trilha de auditoria. NUNCA lança — falhas são logadas.
 *
 * Faz, por gravação: cifra o IP completo (se houver chave), lê o topo da cadeia,
 * calcula o `hash_registro` encadeado e insere com `seq` único. Em corrida de
 * `seq` (dois appends simultâneos), relê o topo e refaz — até algumas tentativas.
 */
export async function auditar(
	db: Database,
	evento: AuditEvento,
	// `env` é `unknown` para aceitar o `App.Platform['env']` real (tipo `Env`
	// completo do Cloudflare) sem cast nos call sites; convertido internamente.
	ctx?: { env?: unknown }
): Promise<void> {
	try {
		const meta = metaDaAcao(evento.acao);
		const cryptoEnv = ctx?.env as AuditCriptoEnv | undefined;
		const ipKey = lerChave(cryptoEnv?.AUDIT_IP_ENCRYPTION_KEY);
		const chainKey = lerChave(cryptoEnv?.AUDIT_CHAIN_KEY);

		const ipCompleto = evento.ip ?? null;
		let ip_cifrado: string | null = null;
		if (ipCompleto && ipKey) {
			try {
				ip_cifrado = await cifrarTexto(ipCompleto, ipKey);
			} catch (err) {
				logger.warn('[audit] Falha ao cifrar IP', {
					error: err instanceof Error ? err.message : String(err)
				});
			}
		}

		// Fallback de contexto: mesmo chamadas que não passam request_id/rota
		// (as ~25 legadas) herdam esses campos do AsyncLocalStorage da request,
		// populado em hooks.server.ts. Mantém a trilha consistente sem tocar todos
		// os call sites. IP/user-agent não vivem no store — ficam por conta de quem
		// passa o contexto (contextoDeEvento).
		const reqCtx = getRequestCtx();

		const base = {
			actor_tipo: evento.actor_tipo ?? evento.usuario?.tipo ?? (evento.usuario ? null : 'sistema'),
			usuario_id: evento.usuario?.id ?? null,
			usuario_nome: evento.usuario?.nome ?? 'Sistema',
			usuario_papel: evento.usuario?.papel ?? null,
			acao: evento.acao,
			categoria: evento.categoria ?? meta.categoria,
			severidade: evento.severidade ?? meta.severidade,
			resultado: evento.resultado ?? 'sucesso',
			entidade: evento.entidade,
			entidade_id: evento.entidade_id ?? null,
			alvo_tipo: evento.alvo_tipo ?? null,
			alvo_id: evento.alvo_id ?? null,
			alvo_nome: evento.alvo_nome ?? null,
			detalhes: evento.detalhes ?? null,
			metadados: comoJson(evento.metadados),
			dados_antes: comoJson(evento.dados_antes),
			dados_depois: comoJson(evento.dados_depois),
			ip: anonimizarIp(ipCompleto),
			ip_cifrado,
			user_agent: evento.user_agent ?? null,
			request_id: evento.request_id ?? reqCtx?.requestId ?? null,
			rota: evento.rota ?? reqCtx?.path ?? null,
			metodo: evento.metodo ?? null,
			created_at: agoraUtc()
		} as const;

		for (let tentativa = 0; tentativa < MAX_TENTATIVAS_CHAIN; tentativa++) {
			const [topo] = await db
				.select({ seq: auditLog.seq, hash_registro: auditLog.hash_registro })
				.from(auditLog)
				.orderBy(desc(auditLog.seq))
				.limit(1);

			const seq = (topo?.seq ?? 0) + 1;
			const hash_anterior = topo?.hash_registro ?? GENESIS;
			const canonical = canonicalAudit({ ...base, seq, hash_anterior });
			const hash_registro = await calcularHashRegistro(hash_anterior, canonical, chainKey);

			try {
				await db.insert(auditLog).values({ ...base, seq, hash_anterior, hash_registro });
				return;
			} catch (err) {
				if (ehViolacaoSeq(err) && tentativa < MAX_TENTATIVAS_CHAIN - 1) continue;
				throw err;
			}
		}
	} catch (err) {
		logger.error('[audit] Falha ao registrar evento', {
			acao: evento.acao,
			entidade: evento.entidade,
			error: err instanceof Error ? err.message : String(err)
		});
	}
}

/**
 * Compat: mantém a assinatura usada pelas chamadas existentes. Delegada para
 * `auditar`, mapeando `detalhes` e aceitando opcionalmente `env` (cifragem do
 * IP + chave da cadeia) e os campos ricos.
 */
export async function registrarAuditComContexto(
	db: Database,
	opts: {
		usuario: { id: number; nome: string; papel?: string | null; tipo?: AuditActorTipo } | null;
		acao: AcaoAudit | (string & {});
		entidade: string;
		entidade_id?: number | null;
		detalhes?: string | null;
		ip?: string | null;
		user_agent?: string | null;
		// Extensões opcionais (não usadas pelas chamadas legadas).
		actor_tipo?: AuditActorTipo;
		alvo_tipo?: string | null;
		alvo_id?: number | null;
		alvo_nome?: string | null;
		resultado?: AuditResultado;
		metadados?: Record<string, unknown> | null;
		dados_antes?: Record<string, unknown> | null;
		dados_depois?: Record<string, unknown> | null;
		request_id?: string | null;
		rota?: string | null;
		metodo?: string | null;
		env?: unknown;
	}
): Promise<void> {
	return auditar(
		db,
		{
			acao: opts.acao,
			usuario: opts.usuario,
			actor_tipo: opts.actor_tipo,
			entidade: opts.entidade,
			entidade_id: opts.entidade_id,
			alvo_tipo: opts.alvo_tipo,
			alvo_id: opts.alvo_id,
			alvo_nome: opts.alvo_nome,
			resultado: opts.resultado,
			detalhes: opts.detalhes,
			metadados: opts.metadados,
			dados_antes: opts.dados_antes,
			dados_depois: opts.dados_depois,
			ip: opts.ip,
			user_agent: opts.user_agent,
			request_id: opts.request_id,
			rota: opts.rota,
			metodo: opts.metodo
		},
		{ env: opts.env }
	);
}

// ---- Consulta ---------------------------------------------------------------

/** Escapa caracteres especiais do LIKE para evitar wildcard injection. */
function escapeLike(str: string): string {
	return str.replace(/[%_\\]/g, '\\$&');
}

export interface ListarAuditOpts {
	usuario_id?: number;
	entidade?: string;
	acao?: string;
	categoria?: string;
	severidade?: string;
	resultado?: string;
	actor_tipo?: string;
	/** ISO/`YYYY-MM-DD` inclusivo. */
	de?: string;
	/** ISO/`YYYY-MM-DD` inclusivo. */
	ate?: string;
	busca?: string;
	page?: number;
	limit?: number;
}

/** Lista entradas do log de auditoria com filtros e paginação. */
export async function listarAuditLog(
	db: Database,
	opts?: ListarAuditOpts
): Promise<{
	logs: AuditLog[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}> {
	const conditions = [];

	if (opts?.usuario_id) conditions.push(eq(auditLog.usuario_id, opts.usuario_id));
	if (opts?.entidade) conditions.push(eq(auditLog.entidade, opts.entidade));
	if (opts?.acao) conditions.push(eq(auditLog.acao, opts.acao));
	if (opts?.categoria) conditions.push(eq(auditLog.categoria, opts.categoria));
	// Filtros vindos de query string: cast para o tipo do enum da coluna. Valor
	// fora do domínio simplesmente não casa nenhuma linha (filtro vazio).
	if (opts?.severidade)
		conditions.push(eq(auditLog.severidade, opts.severidade as AuditSeveridade));
	if (opts?.resultado) conditions.push(eq(auditLog.resultado, opts.resultado as AuditResultado));
	if (opts?.actor_tipo) conditions.push(eq(auditLog.actor_tipo, opts.actor_tipo as AuditActorTipo));
	if (opts?.de) conditions.push(gte(auditLog.created_at, opts.de));
	if (opts?.ate) conditions.push(lte(auditLog.created_at, opts.ate));
	if (opts?.busca) {
		const b = escapeLike(opts.busca);
		conditions.push(
			sql`${auditLog.usuario_nome} LIKE ${'%' + b + '%'} OR ${auditLog.detalhes} LIKE ${'%' + b + '%'} OR ${auditLog.alvo_nome} LIKE ${'%' + b + '%'}`
		);
	}

	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

	const page = Math.max(1, opts?.page ?? 1);
	const limit = Math.min(100, Math.max(1, opts?.limit ?? 20));
	const offset = (page - 1) * limit;

	// Query única com window function: evita um segundo count(*).
	const rows = await db
		.select({
			id: auditLog.id,
			usuario_id: auditLog.usuario_id,
			usuario_nome: auditLog.usuario_nome,
			usuario_papel: auditLog.usuario_papel,
			actor_tipo: auditLog.actor_tipo,
			acao: auditLog.acao,
			categoria: auditLog.categoria,
			severidade: auditLog.severidade,
			resultado: auditLog.resultado,
			entidade: auditLog.entidade,
			entidade_id: auditLog.entidade_id,
			alvo_tipo: auditLog.alvo_tipo,
			alvo_id: auditLog.alvo_id,
			alvo_nome: auditLog.alvo_nome,
			detalhes: auditLog.detalhes,
			metadados: auditLog.metadados,
			dados_antes: auditLog.dados_antes,
			dados_depois: auditLog.dados_depois,
			ip: auditLog.ip,
			ip_cifrado: auditLog.ip_cifrado,
			user_agent: auditLog.user_agent,
			request_id: auditLog.request_id,
			rota: auditLog.rota,
			metodo: auditLog.metodo,
			seq: auditLog.seq,
			hash_anterior: auditLog.hash_anterior,
			hash_registro: auditLog.hash_registro,
			created_at: auditLog.created_at,
			total: sql<number>`count(*) OVER()`
		})
		.from(auditLog)
		.where(whereClause)
		.orderBy(desc(auditLog.created_at), desc(auditLog.id))
		.limit(limit)
		.offset(offset);

	const total = rows.length > 0 ? (rows[0].total ?? 0) : 0;
	const totalPages = Math.ceil(total / limit);
	const logs = rows.map(({ total: _t, ...rest }) => rest);

	return { logs, total, page, limit, totalPages };
}

export interface ResumoAuditoria {
	total: number;
	falhasLogin24h: number;
	criticos7d: number;
	ultimoEvento: string | null;
}

/** Indicadores para o cabeçalho do console de auditoria (KPIs). */
export async function resumoAuditoria(db: Database): Promise<ResumoAuditoria> {
	const agora = Date.now();
	const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
	const h24 = fmt(agora - 24 * 3_600_000);
	const d7 = fmt(agora - 7 * 86_400_000);

	const [tot, fl, cr, ult] = await Promise.all([
		db.select({ n: sql<number>`count(*)` }).from(auditLog),
		db
			.select({ n: sql<number>`count(*)` })
			.from(auditLog)
			.where(and(eq(auditLog.acao, 'falha_login'), gte(auditLog.created_at, h24))),
		db
			.select({ n: sql<number>`count(*)` })
			.from(auditLog)
			.where(and(eq(auditLog.severidade, 'critico'), gte(auditLog.created_at, d7))),
		db
			.select({ c: auditLog.created_at })
			.from(auditLog)
			.orderBy(desc(auditLog.created_at), desc(auditLog.id))
			.limit(1)
	]);

	return {
		total: tot[0]?.n ?? 0,
		falhasLogin24h: fl[0]?.n ?? 0,
		criticos7d: cr[0]?.n ?? 0,
		ultimoEvento: ult[0]?.c ?? null
	};
}

/** Busca um único evento de auditoria pelo id (para exportar/inspecionar). */
export async function buscarAuditLog(db: Database, id: number): Promise<AuditLog | undefined> {
	return db.select().from(auditLog).where(eq(auditLog.id, id)).get();
}

/** Cabeça atual da cadeia de hash (âncora) — usada nos rodapés de exportação. */
export async function cabecaCadeiaAudit(
	db: Database
): Promise<{ seq: number; hash: string } | null> {
	const [t] = await db
		.select({ seq: auditLog.seq, hash: auditLog.hash_registro })
		.from(auditLog)
		.where(isNotNull(auditLog.seq))
		.orderBy(desc(auditLog.seq))
		.limit(1);
	return t?.seq != null && t.hash ? { seq: t.seq, hash: t.hash } : null;
}

// ---- Verificação de integridade (tamper-evidence) --------------------------

export interface ResultadoIntegridade {
	ok: boolean;
	/** Total de linhas encadeadas (com `seq`) examinadas. */
	verificados: number;
	/** `seq` da primeira inconsistência, se houver. */
	primeiroProblemaSeq?: number;
	/** Descrição da inconsistência. */
	problema?: string;
	/** Âncora atual: `seq` da última linha encadeada (cabeça da cadeia). */
	ultimoSeq?: number;
	/**
	 * Hash da cabeça da cadeia. O operador pode registrá-lo externamente
	 * (anchoring): se o log for adulterado depois, este valor não bate mais.
	 */
	ultimoHash?: string;
}

/**
 * Reexecuta a cadeia de hash e confirma que nenhuma linha encadeada foi alterada
 * ou removida. Detecta: (a) elo quebrado (`hash_anterior` ≠ hash do antecessor),
 * (b) hash recalculado divergente (linha adulterada), (c) buraco na sequência
 * (linha removida). Buracos podem também indicar purga de retenção — o operador
 * cruza com os eventos `limpeza_retencao` para distinguir.
 */
export async function verificarIntegridadeAudit(
	db: Database,
	env?: AuditCriptoEnv
): Promise<ResultadoIntegridade> {
	const chainKey = lerChave(env?.AUDIT_CHAIN_KEY);

	const rows = await db
		.select({
			seq: auditLog.seq,
			created_at: auditLog.created_at,
			actor_tipo: auditLog.actor_tipo,
			usuario_id: auditLog.usuario_id,
			usuario_nome: auditLog.usuario_nome,
			usuario_papel: auditLog.usuario_papel,
			acao: auditLog.acao,
			categoria: auditLog.categoria,
			severidade: auditLog.severidade,
			resultado: auditLog.resultado,
			entidade: auditLog.entidade,
			entidade_id: auditLog.entidade_id,
			alvo_tipo: auditLog.alvo_tipo,
			alvo_id: auditLog.alvo_id,
			alvo_nome: auditLog.alvo_nome,
			detalhes: auditLog.detalhes,
			metadados: auditLog.metadados,
			dados_antes: auditLog.dados_antes,
			dados_depois: auditLog.dados_depois,
			ip: auditLog.ip,
			ip_cifrado: auditLog.ip_cifrado,
			user_agent: auditLog.user_agent,
			request_id: auditLog.request_id,
			rota: auditLog.rota,
			metodo: auditLog.metodo,
			hash_anterior: auditLog.hash_anterior,
			hash_registro: auditLog.hash_registro
		})
		.from(auditLog)
		.where(isNotNull(auditLog.seq))
		.orderBy(asc(auditLog.seq));

	let anterior: { seq: number; hash_registro: string } | null = null;

	for (const r of rows) {
		const seq = r.seq as number;
		const hashAnterior = r.hash_anterior ?? GENESIS;
		const hashRegistro = r.hash_registro ?? '';

		// (a) Elo: o hash_anterior deve casar com o hash_registro do antecessor.
		// Na primeira linha sobrevivente (anterior === null) pulamos a checagem de
		// elo: aceitamos GENESIS ou um corte de retenção como ponto de partida.
		if (anterior) {
			if (seq !== anterior.seq + 1) {
				return {
					ok: false,
					verificados: rows.length,
					primeiroProblemaSeq: seq,
					problema: `Buraco na sequência: esperado seq ${anterior.seq + 1}, achei ${seq} (linha removida ou retenção).`
				};
			}
			if (hashAnterior !== anterior.hash_registro) {
				return {
					ok: false,
					verificados: rows.length,
					primeiroProblemaSeq: seq,
					problema: `Elo quebrado em seq ${seq}: hash_anterior não corresponde ao antecessor.`
				};
			}
		}

		// (b) Conteúdo: recalcular o hash e comparar (escolhe o algoritmo pela tag).
		const usaHmac = hashRegistro.startsWith('h:');
		if (usaHmac && !chainKey) {
			return {
				ok: false,
				verificados: rows.length,
				primeiroProblemaSeq: seq,
				problema: `Não foi possível verificar seq ${seq}: linha usa HMAC e AUDIT_CHAIN_KEY não está configurada.`
			};
		}
		const canonical = canonicalAudit({
			seq,
			created_at: r.created_at,
			actor_tipo: r.actor_tipo,
			usuario_id: r.usuario_id,
			usuario_nome: r.usuario_nome,
			usuario_papel: r.usuario_papel,
			acao: r.acao,
			categoria: r.categoria,
			severidade: r.severidade,
			resultado: r.resultado,
			entidade: r.entidade,
			entidade_id: r.entidade_id,
			alvo_tipo: r.alvo_tipo,
			alvo_id: r.alvo_id,
			alvo_nome: r.alvo_nome,
			detalhes: r.detalhes,
			metadados: r.metadados,
			dados_antes: r.dados_antes,
			dados_depois: r.dados_depois,
			ip: r.ip,
			ip_cifrado: r.ip_cifrado,
			user_agent: r.user_agent,
			request_id: r.request_id,
			rota: r.rota,
			metodo: r.metodo,
			hash_anterior: hashAnterior
		});
		const esperado = await calcularHashRegistro(
			hashAnterior,
			canonical,
			usaHmac ? chainKey : undefined
		);
		if (esperado !== hashRegistro) {
			return {
				ok: false,
				verificados: rows.length,
				primeiroProblemaSeq: seq,
				problema: `Conteúdo adulterado em seq ${seq}: hash recalculado diverge do gravado.`
			};
		}

		anterior = { seq, hash_registro: hashRegistro };
	}

	return {
		ok: true,
		verificados: rows.length,
		ultimoSeq: anterior?.seq,
		ultimoHash: anterior?.hash_registro
	};
}

/**
 * Eventos críticos recentes (para o painel de destaque do console). Não pagina —
 * é um resumo curto dos sinais de segurança mais relevantes.
 */
export async function eventosCriticosRecentes(
	db: Database,
	limite = 5
): Promise<Pick<AuditLog, 'id' | 'acao' | 'usuario_nome' | 'detalhes' | 'created_at'>[]> {
	return db
		.select({
			id: auditLog.id,
			acao: auditLog.acao,
			usuario_nome: auditLog.usuario_nome,
			detalhes: auditLog.detalhes,
			created_at: auditLog.created_at
		})
		.from(auditLog)
		.where(eq(auditLog.severidade, 'critico'))
		.orderBy(desc(auditLog.created_at), desc(auditLog.id))
		.limit(Math.min(20, Math.max(1, limite)));
}
