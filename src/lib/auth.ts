import { eq, and, gt, inArray } from 'drizzle-orm';
import { sessoes, administradores, policiais, doisFatoresTokens } from './server/schema';
import type { Database } from './db';

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

const PBKDF2_PREFIX = 'pbkdf2v1:';
const PBKDF2_ITERATIONS = 100_000;

async function derivarPBKDF2(senha: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(senha) as BufferSource,
		'PBKDF2',
		false,
		['deriveBits']
	);
	const hashBuffer = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
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
 * Formato: `pbkdf2v1:<salt_hex>:<hash_hex>`
 */
export async function hashSenha(senha: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
	const saltHex = toHex(salt);
	const hashHex = await derivarPBKDF2(senha, salt);
	return `${PBKDF2_PREFIX}${saltHex}:${hashHex}`;
}

/**
 * Verifica se uma senha corresponde ao hash armazenado.
 * Suporta hashes PBKDF2 (novo) e SHA-256 legado (migração automática).
 */
export async function verificarSenha(senha: string, storedHash: string): Promise<boolean> {
	if (storedHash.startsWith(PBKDF2_PREFIX)) {
		const parts = storedHash.slice(PBKDF2_PREFIX.length).split(':');
		if (parts.length !== 2) return false;
		const [saltHex, expectedHex] = parts;
		const saltBytes = saltHex.match(/.{2}/g)?.map((b) => parseInt(b, 16));
		if (!saltBytes) return false;
		const salt = new Uint8Array(saltBytes) as Uint8Array<ArrayBuffer>;
		const actualHex = await derivarPBKDF2(senha, salt);
		return actualHex === expectedHex;
	}
	// Suporte legado: SHA-256 sem salt — DEPRECADO, será removido em 2026-07-01.
	// Policiais com hash legado devem fazer login para migrar automaticamente para PBKDF2.
	const LEGACY_DEADLINE = new Date('2026-07-01T00:00:00Z');
	if (new Date() > LEGACY_DEADLINE) {
		// Após o deadline, hash legado não é mais aceito — forçar reset de senha
		return false;
	}
	const data = new TextEncoder().encode(senha);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const legacyHash = toHex(new Uint8Array(hashBuffer));
	return legacyHash === storedHash;
}

/** Retorna true se o hash armazenado é legado (SHA-256 sem salt) e precisa ser migrado */
export function isHashLegado(storedHash: string): boolean {
	return !storedHash.startsWith(PBKDF2_PREFIX);
}

export function gerarToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return toHex(bytes);
}

/**
 * Gera uma senha aleatória segura e retorna já com hash PBKDF2.
 * Usada para novos policiais que devem trocar a senha no primeiro acesso.
 */
export async function gerarSenhaAleatoriaHash(): Promise<string> {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	const senhaAleatoria = toHex(bytes); // 48 chars hex — impossível de adivinhar
	return hashSenha(senhaAleatoria);
}

export async function criarSessao(
	db: Database,
	tipo: 'policial' | 'admin',
	usuarioId: number
): Promise<string> {
	const token = gerarToken();
	const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
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

	const sessao = await db
		.select()
		.from(sessoes)
		.where(and(eq(sessoes.token, token), gt(sessoes.expires_at, new Date().toISOString())))
		.get();

	if (!sessao) return null;

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
 * Invalida todas as sessões do usuário, exceto a sessão atual.
 * Deve ser chamado após troca de senha para forçar re-login nos outros dispositivos.
 */
export async function invalidarOutrasSessoes(
	db: Database,
	tipo: 'policial' | 'admin',
	usuarioId: number,
	tokenAtual: string
): Promise<void> {
	// Buscar todas as sessões do usuário e excluir as que não são a atual
	const todasSessoes = await db
		.select({ id: sessoes.id, token: sessoes.token })
		.from(sessoes)
		.where(and(eq(sessoes.tipo, tipo), eq(sessoes.usuario_id, usuarioId)))
		.all();

	const idsParaExcluir = todasSessoes
		.filter((s) => s.token !== tokenAtual)
		.map((s) => s.id);

	if (idsParaExcluir.length > 0) {
		await db.delete(sessoes).where(inArray(sessoes.id, idsParaExcluir));
	}
}

// ---- Autenticação de Dois Fatores ----

/** Gera um código numérico de 6 dígitos para 2FA. */
export function gerarCodigo2FA(): string {
	const bytes = new Uint8Array(4);
	crypto.getRandomValues(bytes);
	const num = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
	return String(num % 1_000_000).padStart(6, '0');
}

/** Persiste um desafio 2FA no banco e retorna o desafioId (UUID aleatório). */
export async function criarDesafio2FA(
	db: Database,
	tipo: 'policial' | 'admin' | 'assinatura',
	usuarioId: number,
	codigo: string
): Promise<string> {
	const desafioId = gerarToken();
	const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
	await db.insert(doisFatoresTokens).values({
		desafio_id: desafioId,
		tipo,
		usuario_id: usuarioId,
		codigo,
		expires_at: expiresAt
	});
	return desafioId;
}

/**
 * Verifica um desafio 2FA.
 * Retorna os dados do usuário se válido, ou uma string descrevendo o erro.
 */
export async function verificarDesafio2FA(
	db: Database,
	desafioId: string,
	codigoInput: string
): Promise<{ tipo: 'policial' | 'admin' | 'assinatura'; usuarioId: number } | 'expirado' | 'esgotado' | null> {
	const desafio = await db
		.select()
		.from(doisFatoresTokens)
		.where(eq(doisFatoresTokens.desafio_id, desafioId))
		.get();

	if (!desafio || desafio.usado === 1) return null;
	if (new Date() > new Date(desafio.expires_at)) return 'expirado';
	if (desafio.tentativas >= 5) return 'esgotado';

	if (desafio.codigo !== codigoInput) {
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

	return { tipo: desafio.tipo as 'policial' | 'admin' | 'assinatura', usuarioId: desafio.usuario_id };
}
