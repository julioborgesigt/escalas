import { eq, and, gt } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import { sessoes, administradores, policiais, doisFatoresTokens, resetSenhaTokens } from './server/schema';
import type { Database } from './db';
import {
	getLegacyPasswordDeadline,
	getLegacyPasswordDeadlineDefault
} from './server/auth-legacy-deadline-cache';

export interface UsuarioLogado {
	id: number;
	tipo: 'policial' | 'admin';
	nome: string;
	matricula?: string;
	lotacao?: string;
	primeiro_acesso: boolean;
	// RBAC
	papel?: 'admin_seccional' | 'admin_unidade' | null;
	papel_unidade_id?: number | null;
	cargo?: 'DPC' | 'OIP';
	cpf?: string | null;
	email?: string | null;
}

export type TipoDesafio2FA = 'policial' | 'admin' | 'assinatura' | 'reset_policial' | 'reset_admin';

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
// Formatos suportados (`verificarSenha` aceita os dois, `hashSenha` só emite o atual):
//   v1 (legado): `pbkdf2v1:<salt_hex>:<hash_hex>`        — iterations = 100 000 implícito
//   v2 (atual):  `pbkdf2v2:<iter>:<salt_hex>:<hash_hex>` — iterations explícito (≥ 600 000)
//
// OWASP 2023+ recomenda no mínimo 600 000 iterações para PBKDF2-SHA256.
// 100 000 (v1) deriva em ~5-10 ms e permite ~10⁹ tentativas/s em GPU; 600 000
// sobe para ~50-60 ms (aceitável no UX de login) e força o atacante a investir
// 6x mais por candidato. Hashes v1 continuam válidos para login — a verificação
// usa as 100k iterações fixadas — e são automaticamente re-hashados para v2 no
// próximo login bem-sucedido pelo mesmo caminho que já migra SHA-256 → PBKDF2
// (auth-flow.ts via `isHashLegado` + `hashSenha`).

const PBKDF2_V1_PREFIX = 'pbkdf2v1:';
const PBKDF2_V2_PREFIX = 'pbkdf2v2:';
const PBKDF2_V1_ITERATIONS = 100_000;
const PBKDF2_V2_ITERATIONS = 600_000;
/** Prefixo emitido por `hashSenha`. Mantido como `pbkdf2v` (qualquer versão) para `isHashLegado`. */
const PBKDF2_PREFIX = PBKDF2_V2_PREFIX;
/** Iterações usadas em hashes recém-criados. */
const PBKDF2_ITERATIONS = PBKDF2_V2_ITERATIONS;

async function derivarPBKDF2(
	senha: string,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number
): Promise<string> {
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(senha) as BufferSource,
		'PBKDF2',
		false,
		['deriveBits']
	);
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

function toHex(bytes: Uint8Array): string {
	const hex = new Array(bytes.length);
	for (let i = 0; i < bytes.length; i++) {
		hex[i] = bytes[i].toString(16).padStart(2, '0');
	}
	return hex.join('');
}

/**
 * Gera um hash seguro da senha usando PBKDF2 com salt aleatório.
 * Formato emitido: `pbkdf2v2:<iter>:<salt_hex>:<hash_hex>` (600 000 iterações).
 */
export async function hashSenha(senha: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
	const saltHex = toHex(salt);
	const hashHex = await derivarPBKDF2(senha, salt, PBKDF2_ITERATIONS);
	return `${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

/**
 * Verifica se uma senha corresponde ao hash armazenado.
 * Suporta hashes PBKDF2 v1 (100k implícito, legado), v2 (iterações explícitas, atual)
 * e SHA-256 sem salt (legado pré-PBKDF2, migração automática).
 * Com `db`, o prazo do SHA-256 vem de `configuracoes.auth.legacy_password_deadline` (cache 5 min).
 */
export async function verificarSenha(
	senha: string,
	storedHash: string,
	db?: Database
): Promise<boolean> {
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
	// Suporte legado: SHA-256 sem salt — DEPRECADO (prazo em `auth.legacy_password_deadline`).
	// Policiais com hash legado devem fazer login para migrar automaticamente para PBKDF2.
	const LEGACY_DEADLINE = db ? await getLegacyPasswordDeadline(db) : getLegacyPasswordDeadlineDefault();
	if (new Date() > LEGACY_DEADLINE) {
		// Após o deadline, hash legado não é mais aceito — forçar reset de senha
		return false;
	}
	const data = new TextEncoder().encode(senha);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const legacyHash = toHex(new Uint8Array(hashBuffer));
	// Timing-safe — espelha o tratamento do ramo PBKDF2 acima. Sem isto,
	// `legacyHash === storedHash` vaza por timing-oracle byte-a-byte (legacy
	// é SHA-256 sem salt, então um atacante com banco vazado poderia testar
	// candidatos online via diferença de tempo de comparação de string).
	const aBuf = Buffer.from(legacyHash.padEnd(64, '0').slice(0, 64));
	const bBuf = Buffer.from(storedHash.padEnd(64, '0').slice(0, 64));
	const hashMatch = timingSafeEqual(aBuf, bBuf) ? 1 : 0;
	const lenMatch = legacyHash.length === storedHash.length ? 1 : 0;
	return (hashMatch & lenMatch) === 1;
}

/**
 * Retorna true se o hash armazenado deve ser migrado para o formato atual.
 * Inclui SHA-256 sem salt (pré-PBKDF2) E PBKDF2 v1 (100k iterações — fraco
 * para 2026). O auth-flow chama `hashSenha` para re-hashar quando true.
 */
export function isHashLegado(storedHash: string): boolean {
	return !storedHash.startsWith(PBKDF2_V2_PREFIX);
}

export function gerarToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return toHex(bytes);
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
export const SESSION_SLIDING_THRESHOLD_MS = 30 * 60 * 1000; // 30 min

export async function criarSessao(
	db: Database,
	tipo: 'policial' | 'admin',
	usuarioId: number
): Promise<string> {
	const token = gerarToken();
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
	await db.insert(sessoes).values({
		token,
		tipo,
		usuario_id: usuarioId,
		expires_at: expiresAt
	});
	return token;
}

export async function validarSessao(
	db: Database,
	token: string | undefined
): Promise<UsuarioLogado | null> {
	if (!token) return null;

	const now = Date.now();
	const sessao = await db
		.select()
		.from(sessoes)
		.where(and(eq(sessoes.token, token), gt(sessoes.expires_at, new Date(now).toISOString())))
		.get();

	if (!sessao) return null;

	// Sliding: se a sessão está perto de expirar, estende para now + SESSION_TTL_MS.
	// Cap por threshold evita UPDATE em todo request.
	const expiresAtMs = new Date(sessao.expires_at).getTime();
	if (expiresAtMs - now < SESSION_TTL_MS - SESSION_SLIDING_THRESHOLD_MS) {
		const novoExpiresAt = new Date(now + SESSION_TTL_MS).toISOString();
		await db.update(sessoes).set({ expires_at: novoExpiresAt }).where(eq(sessoes.id, sessao.id));
	}

	// Query both tables in parallel — only one will match based on sessao.tipo
	const [admin, policial] = await Promise.all([
		sessao.tipo === 'admin'
			? db.select().from(administradores).where(eq(administradores.id, sessao.usuario_id)).get()
			: Promise.resolve(null),
		sessao.tipo === 'policial'
			? db.select().from(policiais).where(and(eq(policiais.id, sessao.usuario_id), eq(policiais.ativo, 1))).get()
			: Promise.resolve(null)
	]);

	if (sessao.tipo === 'admin') {
		if (!admin) return null;
		return {
			id: admin.id,
			tipo: 'admin' as const,
			nome: admin.nome,
			primeiro_acesso: admin.primeiro_acesso === 1
		};
	}

	if (!policial) return null;
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

export async function excluirSessao(db: Database, token: string): Promise<void> {
	await db.delete(sessoes).where(eq(sessoes.token, token));
}

/**
 * Invalida TODAS as sessões do usuário. Use após troca/redefinição de senha
 * para forçar re-login em todos os dispositivos (inclusive o atual). O caller
 * é responsável por emitir uma nova sessão e setar o cookie se quiser manter
 * o usuário logado.
 */
export async function invalidarTodasSessoes(
	db: Database,
	tipo: 'policial' | 'admin',
	usuarioId: number
): Promise<void> {
	await db
		.delete(sessoes)
		.where(and(eq(sessoes.tipo, tipo), eq(sessoes.usuario_id, usuarioId)));
}

// ---- Autenticação de Dois Fatores ----

/** Gera um código numérico de 6 dígitos para 2FA. */
export function gerarCodigo2FA(): string {
	const bytes = new Uint8Array(4);
	crypto.getRandomValues(bytes);
	const num = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
	return String(num % 1_000_000).padStart(6, '0');
}

/** SHA-256 do código 2FA — o código em texto nunca é persisted diretamente. */
async function hashCodigo2FA(codigo: string): Promise<string> {
	const enc = new TextEncoder();
	const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(codigo));
	return Array.from(new Uint8Array(hashBuf))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/** Persiste um desafio 2FA no banco e retorna o desafioId (UUID aleatório). */
export async function criarDesafio2FA(
	db: Database,
	tipo: TipoDesafio2FA,
	usuarioId: number,
	codigo: string
): Promise<string> {
	const desafioId = gerarToken();
	const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
	await db.insert(doisFatoresTokens).values({
		desafio_id: desafioId,
		tipo,
		usuario_id: usuarioId,
		codigo: await hashCodigo2FA(codigo),
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
		token,
		tipo_usuario: tipoUsuario,
		usuario_id: usuarioId,
		expires_at: expiresAt
	});
	return token;
}

/**
 * Verifica um token de redefinição de senha usando comparação timing-safe.
 * Retorna os dados do usuário se válido, 'expirado' ou 'invalido'.
 */
export async function verificarTokenRedefinicao(
	db: Database,
	tokenInput: string
): Promise<{ tipo: 'policial' | 'admin'; usuarioId: number } | 'expirado' | 'invalido'> {
	const SENTINEL = '0'.repeat(64); // mesmo tamanho de gerarToken()

	const row = await db
		.select()
		.from(resetSenhaTokens)
		.where(eq(resetSenhaTokens.token, tokenInput))
		.get();

	// Sempre executa timingSafeEqual para evitar timing oracle
	const storedToken = row?.token ?? SENTINEL;
	const bufA = Buffer.from(storedToken.padEnd(64, '0').slice(0, 64));
	const bufB = Buffer.from(tokenInput.padEnd(64, '0').slice(0, 64));
	const tokensMatch = timingSafeEqual(bufA, bufB) ? 1 : 0;
	const lenMatch = storedToken.length === tokenInput.length ? 1 : 0;

	if (!row || row.usado === 1 || (tokensMatch & lenMatch) !== 1) {
		return 'invalido';
	}
	if (new Date() > new Date(row.expires_at)) {
		return 'expirado';
	}

	return { tipo: row.tipo_usuario as 'policial' | 'admin', usuarioId: row.usuario_id };
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
 */
export async function verificarDesafio2FA(
	db: Database,
	desafioId: string,
	codigoInput: string,
	expectedTipos: readonly TipoDesafio2FA[]
): Promise<{ tipo: TipoDesafio2FA; usuarioId: number } | 'expirado' | 'esgotado' | null> {
	const desafio = await db
		.select()
		.from(doisFatoresTokens)
		.where(eq(doisFatoresTokens.desafio_id, desafioId))
		.get();

	if (!desafio || desafio.usado === 1) return null;
	if (!expectedTipos.includes(desafio.tipo as TipoDesafio2FA)) return null;
	if (new Date() > new Date(desafio.expires_at)) return 'expirado';
	if (desafio.tentativas >= 5) return 'esgotado';

	// stored codigo is now SHA-256 hex (64 chars); compare hashes timing-safe
	const hashedInput = await hashCodigo2FA(String(codigoInput));
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

	await db
		.update(doisFatoresTokens)
		.set({ usado: 1 })
		.where(eq(doisFatoresTokens.id, desafio.id));

	return { tipo: desafio.tipo as TipoDesafio2FA, usuarioId: desafio.usuario_id };
}
