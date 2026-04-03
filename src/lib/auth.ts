import { eq, and, gt } from 'drizzle-orm';
import { sessoes, administradores, policiais } from './server/schema';
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
	return Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Gera um hash seguro da senha usando PBKDF2 com salt aleatório.
 * Formato: `pbkdf2v1:<salt_hex>:<hash_hex>`
 */
export async function hashSenha(senha: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
	const saltHex = Array.from(salt)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
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
	// Suporte legado: SHA-256 sem salt — mantido para migração transparente
	const data = new TextEncoder().encode(senha);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const legacyHash = Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return legacyHash === storedHash;
}

/** Retorna true se o hash armazenado é legado (SHA-256 sem salt) e precisa ser migrado */
export function isHashLegado(storedHash: string): boolean {
	return !storedHash.startsWith(PBKDF2_PREFIX);
}

export function gerarToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
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

	if (sessao.tipo === 'admin') {
		const admin = await db
			.select()
			.from(administradores)
			.where(eq(administradores.id, sessao.usuario_id))
			.get();
		if (!admin) return null;
		return {
			id: admin.id,
			tipo: 'admin',
			nome: admin.nome,
			primeiro_acesso: admin.primeiro_acesso === 1
		};
	}

	const policial = await db
		.select()
		.from(policiais)
		.where(and(eq(policiais.id, sessao.usuario_id), eq(policiais.ativo, 1)))
		.get();
	if (!policial) return null;
	return {
		id: policial.id,
		tipo: 'policial',
		nome: policial.nome,
		matricula: policial.matricula,
		lotacao: policial.lotacao,
		primeiro_acesso: policial.primeiro_acesso === 1,
		papel: policial.papel ?? null,
		papel_unidade_id: policial.papel_unidade_id ?? null,
		cargo: policial.cargo as 'DPC' | 'OIP',
		cpf: policial.cpf ?? null
	};
}

export async function excluirSessao(db: Database, token: string): Promise<void> {
	await db.delete(sessoes).where(eq(sessoes.token, token));
}
