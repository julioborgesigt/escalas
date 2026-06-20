import { eq, and, gt, inArray, desc } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import {
	sessoes,
	administradores,
	policiais,
	doisFatoresTokens,
	resetSenhaTokens,
	aceitesTermos
} from './server/schema';
import type { Database } from './db';
import { aceiteEhVigente } from './db/termos';

export interface UsuarioLogado {
	id: number;
	tipo: 'policial' | 'admin';
	nome: string;
	matricula?: string;
	lotacao?: string;
	primeiro_acesso: boolean;
	isSuperAdmin?: boolean;
	// RBAC
	papel?: 'admin_seccional' | 'admin_unidade' | null;
	papel_unidade_id?: number | null;
	cargo?: 'DPC' | 'OIP';
	cpf?: string | null;
	email?: string | null;
}

export type TipoDesafio2FA =
	| 'policial'
	| 'admin'
	| 'assinatura'
	| 'reset_policial'
	| 'reset_admin'
	// Verificação de e-mail pessoal (I-2 da auditoria): canal próprio, separado
	// de `assinatura`. Antes os dois compartilhavam o mesmo tipo, abrindo
	// confused-deputy se um caminho futuro aceitasse um sem o outro.
	| 'verificacao_email'
	// Desafio gerado para autenticação via Token A3 ICP-Brasil.
	// usuario_id = 0 até o CPF ser resolvido; codigo = hash do nonce.
	| 'login_certificado';

/** Retorna true se o usuário possui poder de Admin Geral */
export function isAdminGeral(u: UsuarioLogado | null): boolean {
	return u?.tipo === 'admin';
}

/** Retorna true se o usuário é Admin Seccional */
export function isAdminSeccional(u: UsuarioLogado | null): boolean {
	return u?.tipo === 'policial' && u.papel === 'admin_seccional';
}

/** Retorna true se o usuário é Admin de Unidade */
export function isAdminUnidade(u: UsuarioLogado | null): boolean {
	return u?.tipo === 'policial' && u.papel === 'admin_unidade';
}

/** Retorna true se o usuário possui qualquer papel administrativo */
export function isAnyAdmin(u: UsuarioLogado | null): boolean {
	return isAdminGeral(u) || isAdminSeccional(u) || isAdminUnidade(u);
}

// ---- Hashing de senha ----
//
// Formatos suportados (`verificarSenha` aceita todos; `hashSenha` emite v3 com
// pepper, senão v2):
//   v1 (legado): `pbkdf2v1:<salt_hex>:<hash_hex>`        — iterations = 100 000 implícito
//   v2 (atual):  `pbkdf2v2:<iter>:<salt_hex>:<hash_hex>` — iterations explícito
//   v3 (pepper): `pbkdf2v3:<iter>:<salt_hex>:<hash_hex>` — PBKDF2 sobre
//                HMAC-SHA256(PASSWORD_PEPPER, senha). Ver nota do A3 abaixo.
//
// Sobre as iterações e o achado A3 (IMPORTANTE — leia antes de mexer):
//
// OWASP 2023+ recomenda mínimo 600 000 iterações para PBKDF2-HMAC-SHA256.
// PORÉM, o runtime da Cloudflare (workerd — o MESMO no Pages e no Workers)
// IMPÕE UM TETO RÍGIDO DE 100 000 iterações na API `crypto.subtle` do WebCrypto:
// pedir mais devolve "Pbkdf2 failed: iteration counts above 100000 are not
// supported". NÃO é limite de CPU (não adianta `cpu_ms`), é um limite da API —
// idêntico no Pages e no Workers. (A auditoria A3 atribuiu o erro a CPU/Pages;
// a Fase 2 da migração provou empiricamente em staging que a causa é o teto de
// iterações, então migrar de plataforma NÃO destrava 600k via `crypto.subtle`.)
//
// COMO O A3 É RESOLVIDO ENTÃO — PEPPER (v3):
// Em vez de subir iterações, aplicamos um PEPPER: HMAC-SHA256 da senha com um
// segredo GLOBAL `PASSWORD_PEPPER` (que vive só no ambiente, nunca no banco)
// ANTES do PBKDF2. Custo de CPU ~zero (um HMAC) e dentro do teto de 100k. Com
// isso, um vazamento do D1 sozinho NÃO permite brute-force offline: sem o
// `PASSWORD_PEPPER`, o atacante nem consegue testar candidatos. É defesa melhor
// que 600k para o cenário real (DB dump), pois 600k só DESACELERA o ataque,
// enquanto o pepper o INVIABILIZA (assumindo que o segredo não vaze junto).
//
// FALLBACK: sem `PASSWORD_PEPPER` setado, `hashSenha` emite v2 (comportamento
// atual) e o sistema funciona normalmente — o pepper é opt-in por ambiente.
// Quando o segredo está presente, o login re-hasha v1/v2/legado → v3 (migração
// progressiva, sem big-bang no banco).
//
// Defesa em camadas que continua valendo:
//  - Rate-limit forte por IP + por conta em `login_attempts` (auth-flow.ts)
//  - Recovery isolado em `recovery_attempts` para não amplificar
//  - 2FA por e-mail obrigatório no login (fail-closed, A1) e em qualquer reset
//  - SENHAS_COMUNS blocklist em schemas/auth.ts

const PBKDF2_V1_PREFIX = 'pbkdf2v1:';
const PBKDF2_V2_PREFIX = 'pbkdf2v2:';
/** Pepper (A3): PBKDF2 sobre HMAC-SHA256(PASSWORD_PEPPER, senha). */
const PBKDF2_V3_PREFIX = 'pbkdf2v3:';
const PBKDF2_V1_ITERATIONS = 100_000;
/** Teto RÍGIDO da API `crypto.subtle` do workerd (Pages e Workers). Ver nota A3. */
const PBKDF2_V2_ITERATIONS = 100_000;
/** Prefixo do fake-hash de cadastro em massa (sempre v2). */
const PBKDF2_PREFIX = PBKDF2_V2_PREFIX;
/** Iterações usadas em hashes recém-criados (v2 e v3). */
const PBKDF2_ITERATIONS = PBKDF2_V2_ITERATIONS;

async function derivarPBKDF2Material(
	material: BufferSource,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number
): Promise<string> {
	const keyMaterial = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, [
		'deriveBits'
	]);
	const hashBuffer = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
		keyMaterial,
		256
	);
	const arr = new Uint8Array(hashBuffer);
	const hex = new Array(arr.length);
	for (let i = 0; i < arr.length; i++) {
		hex[i] = arr[i].toString(16).padStart(2, '0');
	}
	return hex.join('');
}

async function derivarPBKDF2(
	senha: string,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number
): Promise<string> {
	return derivarPBKDF2Material(new TextEncoder().encode(senha) as BufferSource, salt, iterations);
}

/**
 * Pepper (A3): HMAC-SHA256(PASSWORD_PEPPER, senha) → 32 bytes. Pré-tempera a
 * senha com um segredo GLOBAL (do ambiente, nunca no banco) antes do PBKDF2, de
 * modo que um dump do D1 sozinho não permita brute-force offline. Custo de CPU
 * desprezível e sem esbarrar no teto de 100k iterações do `crypto.subtle`.
 */
async function pepperizarSenha(senha: string, pepper: string): Promise<Uint8Array<ArrayBuffer>> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(pepper) as BufferSource,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign(
		'HMAC',
		key,
		new TextEncoder().encode(senha) as BufferSource
	);
	return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array): string {
	const hex = new Array(bytes.length);
	for (let i = 0; i < bytes.length; i++) {
		hex[i] = bytes[i].toString(16).padStart(2, '0');
	}
	return hex.join('');
}

/**
 * Gera um hash seguro da senha usando PBKDF2 (100 000 iterações — teto da API
 * `crypto.subtle` do workerd; ver nota A3 acima).
 *
 * Com `pepper` (PASSWORD_PEPPER do ambiente): emite o formato v3, aplicando
 * HMAC-SHA256(pepper, senha) antes do PBKDF2 — defesa contra brute-force offline
 * em caso de vazamento do D1. Sem `pepper`: emite v2 (fallback, comportamento
 * legado), preservando o funcionamento quando o segredo não está configurado.
 */
export async function hashSenha(senha: string, pepper?: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
	const saltHex = toHex(salt);
	if (pepper) {
		const material = await pepperizarSenha(senha, pepper);
		const hashHex = await derivarPBKDF2Material(material as BufferSource, salt, PBKDF2_ITERATIONS);
		return `${PBKDF2_V3_PREFIX}${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
	}
	const hashHex = await derivarPBKDF2(senha, salt, PBKDF2_ITERATIONS);
	return `${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

/**
 * Verifica se uma senha corresponde ao hash armazenado.
 * Suporta PBKDF2 v3 (pepper), v2 (atual) e v1 (legado). Hashes em qualquer
 * outro formato (ex.: SHA-256 sem salt, pré-PBKDF2) NÃO são mais aceitos — o
 * suporte legado expirou; contas nesse estado precisam redefinir a senha.
 */
export async function verificarSenha(
	senha: string,
	storedHash: string,
	pepper?: string
): Promise<boolean> {
	if (storedHash.startsWith(PBKDF2_V3_PREFIX)) {
		// Formato: pbkdf2v3:<iter>:<salt_hex>:<hash_hex> sobre HMAC(pepper, senha).
		// Sem o pepper o hash é inverificável — fail-closed (não dá pra autenticar).
		if (!pepper) return false;
		const parts = storedHash.slice(PBKDF2_V3_PREFIX.length).split(':');
		if (parts.length !== 3) return false;
		const [iterStr, saltHex, expectedHex] = parts;
		const iter = parseInt(iterStr, 10);
		if (!Number.isFinite(iter) || iter < PBKDF2_V1_ITERATIONS || iter > 10_000_000) return false;
		const saltBytes = saltHex.match(/.{2}/g)?.map((b) => parseInt(b, 16));
		if (!saltBytes) return false;
		const salt = new Uint8Array(saltBytes) as Uint8Array<ArrayBuffer>;
		const material = await pepperizarSenha(senha, pepper);
		const actualHex = await derivarPBKDF2Material(material as BufferSource, salt, iter);
		const a = Buffer.from(actualHex.padEnd(64, '0').slice(0, 64));
		const b = Buffer.from(expectedHex.padEnd(64, '0').slice(0, 64));
		const hashMatch = timingSafeEqual(a, b) ? 1 : 0;
		const lenMatch = actualHex.length === expectedHex.length ? 1 : 0;
		return (hashMatch & lenMatch) === 1;
	}
	if (storedHash.startsWith(PBKDF2_V2_PREFIX)) {
		// Formato: pbkdf2v2:<iter>:<salt_hex>:<hash_hex>
		const parts = storedHash.slice(PBKDF2_V2_PREFIX.length).split(':');
		if (parts.length !== 3) return false;
		const [iterStr, saltHex, expectedHex] = parts;
		const iter = parseInt(iterStr, 10);
		// Sanity: iter precisa ser numérico positivo e dentro de uma janela
		// razoável (impede DoS via iter gigante vindo de hash corrompido/banco
		// adulterado).
		if (!Number.isFinite(iter) || iter < PBKDF2_V1_ITERATIONS || iter > 10_000_000) return false;
		const saltBytes = saltHex.match(/.{2}/g)?.map((b) => parseInt(b, 16));
		if (!saltBytes) return false;
		const salt = new Uint8Array(saltBytes) as Uint8Array<ArrayBuffer>;
		const actualHex = await derivarPBKDF2(senha, salt, iter);
		const a = Buffer.from(actualHex.padEnd(64, '0').slice(0, 64));
		const b = Buffer.from(expectedHex.padEnd(64, '0').slice(0, 64));
		const hashMatch = timingSafeEqual(a, b) ? 1 : 0;
		const lenMatch = actualHex.length === expectedHex.length ? 1 : 0;
		return (hashMatch & lenMatch) === 1;
	}
	if (storedHash.startsWith(PBKDF2_V1_PREFIX)) {
		// Formato legado: pbkdf2v1:<salt_hex>:<hash_hex>, iter = 100 000 implícito.
		const parts = storedHash.slice(PBKDF2_V1_PREFIX.length).split(':');
		if (parts.length !== 2) return false;
		const [saltHex, expectedHex] = parts;
		const saltBytes = saltHex.match(/.{2}/g)?.map((b) => parseInt(b, 16));
		if (!saltBytes) return false;
		const salt = new Uint8Array(saltBytes) as Uint8Array<ArrayBuffer>;
		const actualHex = await derivarPBKDF2(senha, salt, PBKDF2_V1_ITERATIONS);
		const a = Buffer.from(actualHex.padEnd(64, '0').slice(0, 64));
		const b = Buffer.from(expectedHex.padEnd(64, '0').slice(0, 64));
		const hashMatch = timingSafeEqual(a, b) ? 1 : 0;
		const lenMatch = actualHex.length === expectedHex.length ? 1 : 0;
		return (hashMatch & lenMatch) === 1;
	}
	// Formato desconhecido (ex.: SHA-256 sem salt, pré-PBKDF2): suporte removido.
	// Contas nesse estado não autenticam — precisam redefinir a senha.
	return false;
}

/**
 * Retorna true se o hash deve ser migrado para o formato corrente. O auth-flow
 * chama `hashSenha` para re-hashar (no login bem-sucedido) quando true.
 *
 * - `pepperAtivo = true` (PASSWORD_PEPPER setado): o alvo é v3, então tudo
 *   abaixo de v3 (v2, v1, SHA-256 legado) é legado e sobe para v3 no login.
 * - `pepperAtivo = false` (sem segredo): o alvo é v2 (comportamento legado);
 *   v3 NUNCA é legado (não rebaixa, e sem o segredo nem seria reproduzível).
 *
 * O custo do re-hash no login é 1 derivação extra de 100k (~10-15 ms) + o HMAC
 * do pepper (desprezível) — dentro do orçamento de CPU.
 */
export function isHashLegado(storedHash: string, pepperAtivo: boolean = false): boolean {
	if (storedHash.startsWith(PBKDF2_V3_PREFIX)) return false;
	if (pepperAtivo) return true;
	return !storedHash.startsWith(PBKDF2_V2_PREFIX);
}

export function gerarToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return toHex(bytes);
}

// ---- Hash de tokens persistidos (sessão / redefinição) ----
//
// Tokens de sessão e de reset são armazenados como `sha256:<hex>` — o valor
// em claro só vive no cookie/link do usuário. Um dump/backup do D1 (ou acesso
// de operador) não permite sequestrar sessões ativas nem resets pendentes.
// O prefixo distingue hash de token legado em claro (ambos têm 64 hex chars);
// linhas legadas são aceitas em fallback e migradas para hash no primeiro uso.

const TOKEN_HASH_PREFIX = 'sha256:';

async function hashTokenArmazenado(token: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return `${TOKEN_HASH_PREFIX}${toHex(new Uint8Array(buf))}`;
}

/**
 * Compara dois segredos em texto (ex.: `ADMIN_GERAL_SENHA`) de forma timing-safe
 * sobre os bytes UTF-8: buffers com o mesmo tamanho máximo e `timingSafeEqual`.
 */
export function compararSegredoUtf8TimingSafe(input: string, expected: string): boolean {
	const a = Buffer.from(input, 'utf8');
	const b = Buffer.from(expected, 'utf8');
	const len = Math.max(a.length, b.length, 1);
	const bufA = Buffer.alloc(len);
	const bufB = Buffer.alloc(len);
	a.copy(bufA);
	b.copy(bufB);
	const match = timingSafeEqual(bufA, bufB);
	const sameLen = a.length === b.length;
	return match && sameLen;
}

/**
 * Retorna um hash no formato PBKDF2 **inválido para login**: não é derivado da senha.
 * Usado no cadastro/sincronização em massa para evitar Erro 1102 (CPU) na Cloudflare.
 *
 * **Invariantes:** quem recebe este hash deve ter `primeiro_acesso = 1` e só autenticar
 * após `hashSenha` real (primeiro acesso ou redefinição). `verificarSenha` continuará
 * falhando para qualquer senha digitada até lá — comportamento esperado.
 */
export async function gerarSenhaAleatoriaHash(): Promise<string> {
	// Gera payload PBKDF2-formatado sem derivação pesada para evitar estouro de CPU.
	// O hash não corresponde a senha real e continua inválido para autenticação.
	// Emite no formato v2 (`pbkdf2v2:<iter>:<salt>:<hash>`) para não disparar
	// re-hash desnecessário em `isHashLegado` quando o primeiro login real ocorrer.
	const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
	const fakeHash = toHex(crypto.getRandomValues(new Uint8Array(32)));
	return `${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}:${salt}:${fakeHash}`;
}

/** Tempo de vida da sessão (8h). Toda atividade reseta o relógio (sliding). */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
/**
 * Threshold para evitar UPDATE em todo request. Só estende `expires_at` quando
 * faltar menos que `SESSION_SLIDING_THRESHOLD_MS` do vencimento. Mantém o
 * throughput sem perder a propriedade sliding (no pior caso, a sessão é
 * estendida `SESSION_TTL_MS - threshold` antes do vencimento).
 */
const SESSION_SLIDING_THRESHOLD_MS = 30 * 60 * 1000; // 30 min

export async function criarSessao(
	db: Database,
	tipo: 'policial' | 'admin',
	usuarioId: number
): Promise<string> {
	const token = gerarToken();
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
	await db.insert(sessoes).values({
		token: await hashTokenArmazenado(token),
		tipo,
		usuario_id: usuarioId,
		expires_at: expiresAt
	});
	return token;
}

/**
 * Busca a linha de sessão válida para o token (cobrindo o fallback legado de
 * token em claro) e devolve também o UPDATE de sliding-expiration JÁ MONTADO
 * (mas não executado) quando aplicável — o chamador decide se o executa
 * isolado (`validarSessao`) ou dentro de um `db.batch` (`validarSessaoComAceite`).
 */
async function buscarSessaoValida(db: Database, token: string | undefined) {
	if (!token) return null;

	const now = Date.now();
	const nowISO = new Date(now).toISOString();
	const tokenHash = await hashTokenArmazenado(token);
	let sessao = await db
		.select()
		.from(sessoes)
		.where(and(eq(sessoes.token, tokenHash), gt(sessoes.expires_at, nowISO)))
		.get();

	if (!sessao) {
		// Fallback: sessão criada antes da migração para token hasheado (em
		// claro no banco). Aceita e migra a linha para o formato hasheado.
		sessao = await db
			.select()
			.from(sessoes)
			.where(and(eq(sessoes.token, token), gt(sessoes.expires_at, nowISO)))
			.get();
		if (sessao) {
			await db.update(sessoes).set({ token: tokenHash }).where(eq(sessoes.id, sessao.id));
		}
	}

	if (!sessao) return null;

	// Sliding: se a sessão está perto de expirar, estende para now + SESSION_TTL_MS.
	// Cap por threshold evita UPDATE em todo request.
	const expiresAtMs = new Date(sessao.expires_at).getTime();
	const slidingUpdate =
		expiresAtMs - now < SESSION_TTL_MS - SESSION_SLIDING_THRESHOLD_MS
			? db
					.update(sessoes)
					.set({ expires_at: new Date(now + SESSION_TTL_MS).toISOString() })
					.where(eq(sessoes.id, sessao.id))
			: null;

	return { sessao, slidingUpdate };
}

function mapearAdmin(
	admin: typeof administradores.$inferSelect,
	platform?: App.Platform
): UsuarioLogado {
	const _env = platform?.env as Env | undefined;
	const superAdminLogin = _env?.SUPER_ADMIN_LOGIN?.trim();
	const isSuperAdmin = !!superAdminLogin && admin.login === superAdminLogin;

	return {
		id: admin.id,
		tipo: 'admin' as const,
		nome: admin.nome,
		primeiro_acesso: admin.primeiro_acesso === 1,
		isSuperAdmin
	};
}

function mapearPolicial(policial: typeof policiais.$inferSelect): UsuarioLogado {
	return {
		id: policial.id,
		tipo: 'policial' as const,
		nome: policial.nome,
		matricula: policial.matricula,
		lotacao: policial.lotacao,
		primeiro_acesso: policial.primeiro_acesso === 1,
		papel: policial.papel ?? null,
		papel_unidade_id: policial.papel_unidade_id ?? null,
		cargo: policial.cargo as 'DPC' | 'OIP',
		cpf: policial.cpf ?? null,
		email: policial.email ?? null
	};
}

export async function validarSessao(
	db: Database,
	token: string | undefined,
	platform?: App.Platform
): Promise<UsuarioLogado | null> {
	const resultado = await buscarSessaoValida(db, token);
	if (!resultado) return null;
	const { sessao, slidingUpdate } = resultado;

	if (slidingUpdate) await slidingUpdate;

	if (sessao.tipo === 'admin') {
		const admin = await db
			.select()
			.from(administradores)
			.where(eq(administradores.id, sessao.usuario_id))
			.get();
		return admin ? mapearAdmin(admin, platform) : null;
	}

	const policial = await db
		.select()
		.from(policiais)
		.where(and(eq(policiais.id, sessao.usuario_id), eq(policiais.ativo, 1)))
		.get();
	return policial ? mapearPolicial(policial) : null;
}

/**
 * Variante de `validarSessao` usada pelo hooks.server.ts: além do usuário,
 * verifica o aceite do Termo de Uso vigente NO MESMO round-trip ao D1.
 *
 * Motivação (auditoria de performance, B-1): a sequência sessão → usuário →
 * aceite eram 3 queries D1 em série em todo request autenticado (~5-30ms
 * cada no Worker). Aqui, depois da busca da sessão, usuário + aceite
 * (+ sliding update, quando devido) vão juntos num `db.batch` — 2 round-trips
 * no total em vez de 3-4.
 *
 * Nota de semântica: como usuário e aceite compartilham o batch, uma falha de
 * D1 derruba os dois e o request cai no fluxo "sessão inválida" (redirect ao
 * /login, cookie preservado — basta recarregar). Antes, uma falha isolada da
 * query de aceite deixava o request passar com warning; esse cenário só
 * ocorria de fato com o banco já indisponível, onde a página quebraria adiante
 * de qualquer forma.
 */
export async function validarSessaoComAceite(
	db: Database,
	token: string | undefined,
	platform: App.Platform | undefined,
	termo: { versao: string; hash: string }
): Promise<{ usuario: UsuarioLogado | null; aceiteVigente: boolean }> {
	const resultado = await buscarSessaoValida(db, token);
	if (!resultado) return { usuario: null, aceiteVigente: false };
	const { sessao, slidingUpdate } = resultado;

	const aceiteQuery = db
		.select({ versao_termo: aceitesTermos.versao_termo, hash_termo: aceitesTermos.hash_termo })
		.from(aceitesTermos)
		.where(
			and(
				eq(aceitesTermos.usuario_tipo, sessao.tipo),
				eq(aceitesTermos.usuario_id, sessao.usuario_id)
			)
		)
		.orderBy(desc(aceitesTermos.aceitou_em))
		.limit(1);

	let usuario: UsuarioLogado | null;
	let ultimoAceite: { versao_termo: string; hash_termo: string } | undefined;

	if (sessao.tipo === 'admin') {
		const userQuery = db
			.select()
			.from(administradores)
			.where(eq(administradores.id, sessao.usuario_id))
			.limit(1);
		const [admins, aceites] = slidingUpdate
			? await db.batch([userQuery, aceiteQuery, slidingUpdate])
			: await db.batch([userQuery, aceiteQuery]);
		usuario = admins[0] ? mapearAdmin(admins[0], platform) : null;
		ultimoAceite = aceites[0];
	} else {
		const userQuery = db
			.select()
			.from(policiais)
			.where(and(eq(policiais.id, sessao.usuario_id), eq(policiais.ativo, 1)))
			.limit(1);
		const [pols, aceites] = slidingUpdate
			? await db.batch([userQuery, aceiteQuery, slidingUpdate])
			: await db.batch([userQuery, aceiteQuery]);
		usuario = pols[0] ? mapearPolicial(pols[0]) : null;
		ultimoAceite = aceites[0];
	}

	return { usuario, aceiteVigente: aceiteEhVigente(ultimoAceite, termo.versao, termo.hash) };
}

export async function excluirSessao(db: Database, token: string): Promise<void> {
	// Cobre tanto a forma hasheada (atual) quanto linhas legadas em claro.
	await db.delete(sessoes).where(inArray(sessoes.token, [await hashTokenArmazenado(token), token]));
}

// ---- Autenticação de Dois Fatores ----

/** Gera um código numérico de 6 dígitos para 2FA. */
export function gerarCodigo2FA(): string {
	const bytes = new Uint8Array(4);
	crypto.getRandomValues(bytes);
	const num = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
	return String(num % 1_000_000).padStart(6, '0');
}

/**
 * SHA-256 do código 2FA. O código em texto nunca é persisted diretamente.
 *
 * `extra` (I-1 da auditoria): quando presente, é misturado ao código antes
 * do hash. Usado pelo fluxo de verificação de e-mail pessoal para AMARRAR
 * o código ao endereço para o qual ele foi enviado. Sem isso, o usuário
 * podia receber o OTP em email_A, mas chamar `confirmar-verificacao`
 * passando email_B no body e persistir email_B sem verificação. O caller
 * `verificarDesafio2FA` precisa passar o mesmo `extra` da criação ou o
 * hash não confere.
 *
 * Separador `\x1f` (Unit Separator ASCII) impede colisão entre, por exemplo,
 * `extra="ab" + codigo="c"` e `extra="a" + codigo="bc"`.
 */
async function hashCodigo2FA(codigo: string, extra: string = ''): Promise<string> {
	const enc = new TextEncoder();
	const input = extra ? `${extra}\x1f${codigo}` : codigo;
	const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(input));
	return Array.from(new Uint8Array(hashBuf))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Persiste um desafio 2FA no banco e retorna o desafioId (UUID aleatório).
 *
 * `bindExtra` AMARRA o desafio a um dado externo (ex.: e-mail destino para
 * verificação de e-mail pessoal). Quem chamar `verificarDesafio2FA` precisa
 * passar o mesmo `bindExtra` ou a verificação falha — fecha I-1.
 */
export async function criarDesafio2FA(
	db: Database,
	tipo: TipoDesafio2FA,
	usuarioId: number,
	codigo: string,
	bindExtra: string = ''
): Promise<string> {
	const desafioId = gerarToken();
	const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
	await db.insert(doisFatoresTokens).values({
		desafio_id: desafioId,
		tipo,
		usuario_id: usuarioId,
		codigo: await hashCodigo2FA(codigo, bindExtra),
		expires_at: expiresAt
	});
	return desafioId;
}

// ---- Redefinição de Senha ----

/**
 * Cria um token de redefinição de senha (256 bits, expira em 1 hora) e o persiste.
 * Retorna o token gerado para ser incluído no link de redefinição.
 */
export async function criarTokenRedefinicao(
	db: Database,
	tipoUsuario: 'policial' | 'admin',
	usuarioId: number
): Promise<string> {
	const token = gerarToken();
	const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
	await db.insert(resetSenhaTokens).values({
		token: await hashTokenArmazenado(token),
		tipo_usuario: tipoUsuario,
		usuario_id: usuarioId,
		expires_at: expiresAt
	});
	return token;
}

/**
 * Verifica um token de redefinição de senha. O lookup é pelo HASH do token
 * (com fallback para linhas legadas em claro); a comparação final do hash é
 * timing-safe. Retorna os dados do usuário se válido, 'expirado' ou 'invalido'.
 */
export async function verificarTokenRedefinicao(
	db: Database,
	tokenInput: string
): Promise<{ tipo: 'policial' | 'admin'; usuarioId: number } | 'expirado' | 'invalido'> {
	const tokenHash = await hashTokenArmazenado(tokenInput);
	const row = await db
		.select()
		.from(resetSenhaTokens)
		.where(inArray(resetSenhaTokens.token, [tokenHash, tokenInput]))
		.get();

	// Sempre executa timingSafeEqual para evitar timing oracle
	const SENTINEL = '0'.repeat(tokenHash.length);
	const storedToken = row?.token ?? SENTINEL;
	const esperado = storedToken.startsWith(TOKEN_HASH_PREFIX) ? tokenHash : tokenInput;
	const bufA = Buffer.from(storedToken.padEnd(96, '0').slice(0, 96));
	const bufB = Buffer.from(esperado.padEnd(96, '0').slice(0, 96));
	const tokensMatch = timingSafeEqual(bufA, bufB) ? 1 : 0;
	const lenMatch = storedToken.length === esperado.length ? 1 : 0;

	if (!row || row.usado === 1 || (tokensMatch & lenMatch) !== 1) {
		return 'invalido';
	}
	if (new Date() > new Date(row.expires_at)) {
		return 'expirado';
	}

	return { tipo: row.tipo_usuario as 'policial' | 'admin', usuarioId: row.usuario_id };
}

/**
 * Marca um token de redefinição como usado (uso único). Cobre a forma
 * hasheada (atual) e linhas legadas em claro. Chamar ANTES de trocar a
 * senha (anti-race).
 */
export async function marcarTokenRedefinicaoUsado(db: Database, token: string): Promise<void> {
	await db
		.update(resetSenhaTokens)
		.set({ usado: 1 })
		.where(inArray(resetSenhaTokens.token, [await hashTokenArmazenado(token), token]));
}

/**
 * Verifica um desafio 2FA.
 *
 * `expectedTipos` é OBRIGATÓRIO e funciona como defense-in-depth: o canal
 * (login, reset, assinatura) precisa declarar quais tipos de desafio aceita.
 * Sem isso, um `desafioId` emitido para um canal (ex.: `'assinatura'`) poderia
 * ser submetido em outro (ex.: `/api/auth/verificar-2fa`) e gerar sessão
 * indevida. Mismatch retorna `null` indistinguível de código inválido.
 *
 * Retorna os dados do usuário se válido, ou uma string descrevendo o erro.
 *
 * `options.markUsed` (default `true`): quando `false`, o desafio NÃO é marcado
 * como usado em caso de sucesso — fica reutilizável até expirar (10 min). Use
 * para ASSINATURA EM LOTE: o usuário solicita um código e assina vários
 * documentos na mesma sessão, dentro da janela de validade. Login/reset/2FA de
 * sessão mantêm o default (uso único) para preservar a proteção anti-replay.
 */
export async function verificarDesafio2FA(
	db: Database,
	desafioId: string,
	codigoInput: string,
	expectedTipos: readonly TipoDesafio2FA[],
	bindExtra: string = '',
	options: { markUsed?: boolean } = {}
): Promise<{ tipo: TipoDesafio2FA; usuarioId: number } | 'expirado' | 'esgotado' | null> {
	const markUsed = options.markUsed ?? true;
	const desafio = await db
		.select()
		.from(doisFatoresTokens)
		.where(eq(doisFatoresTokens.desafio_id, desafioId))
		.get();

	if (!desafio || desafio.usado === 1) return null;
	if (!expectedTipos.includes(desafio.tipo as TipoDesafio2FA)) return null;
	if (new Date() > new Date(desafio.expires_at)) return 'expirado';
	if (desafio.tentativas >= 5) return 'esgotado';

	// `bindExtra` precisa coincidir com o passado em `criarDesafio2FA` — sem
	// isso o hash não confere (I-1 da auditoria). Caller passa `''` para
	// fluxos legados que não usam binding.
	const hashedInput = await hashCodigo2FA(String(codigoInput), bindExtra);
	const codigoA = Buffer.from(desafio.codigo);
	const codigoB = Buffer.from(hashedInput);
	const codesMatch = codigoA.length === codigoB.length && timingSafeEqual(codigoA, codigoB) ? 1 : 0;
	if (codesMatch !== 1) {
		await db
			.update(doisFatoresTokens)
			.set({ tentativas: desafio.tentativas + 1 })
			.where(eq(doisFatoresTokens.id, desafio.id));
		return null;
	}

	// Em lote (`markUsed: false`) o desafio permanece válido até expirar, para
	// autorizar várias assinaturas na mesma sessão sem novo código a cada uma.
	if (markUsed) {
		await db
			.update(doisFatoresTokens)
			.set({ usado: 1 })
			.where(eq(doisFatoresTokens.id, desafio.id));
	}

	return { tipo: desafio.tipo as TipoDesafio2FA, usuarioId: desafio.usuario_id };
}

/**
 * Retorna a rota de boas-vindas adequada para o usuário e módulo selecionado.
 */
export function obterRotaBemVindo(u: UsuarioLogado, adminModulo?: string | null): string {
	if (u.tipo === 'admin') {
		return adminModulo === 'gise' ? '/gise/bem-vindo' : '/escalas/bem-vindo';
	}
	if (u.papel === 'admin_seccional') {
		return '/escalas/bem-vindo';
	}
	if (u.papel === 'admin_unidade') {
		return '/escalas/bem-vindo';
	}
	return '/bem-vindo';
}
