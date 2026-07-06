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
import { bytesToHex } from './crypto/hex';
import { decifrarCpfDoDB } from './crypto/cpf-cripto';

// Hashing de senha (PBKDF2 + pepper) vive em ./crypto/password-hash — módulo
// PURO compartilhado com os scripts/e2e (item C6 da auditoria). Re-exportado
// aqui para manter a API pública `$lib/auth` estável.
export {
	hashSenha,
	verificarSenha,
	isHashLegado,
	gerarSenhaAleatoriaHash
} from './crypto/password-hash';

export interface UsuarioLogado {
	id: number;
	tipo: 'policial' | 'admin';
	nome: string;
	matricula?: string;
	lotacao?: string;
	primeiro_acesso: boolean;
	isSuperAdmin?: boolean;
	/**
	 * Sessão de admin VINCULADO a um policial (Admin Geral vinculado): id do
	 * policial cuja credencial autentica esta conta admin. Operações de
	 * credencial (troca de senha) miram este policial. Nulo/ausente = admin
	 * standalone (bootstrap por env).
	 */
	adminPolicialId?: number | null;
	// RBAC operacional (papel scoped do servidor; cumulativo com Admin Geral)
	papel?: 'admin_seccional' | 'admin_unidade' | null;
	papel_unidade_id?: number | null;
	cargo?: 'DPC' | 'OIP';
	cpf?: string | null;
	email?: string | null;
	/**
	 * Se o policial tem rubrica reutilizável cadastrada. Vem da própria linha
	 * carregada na validação da sessão (custo zero) e alimenta o aviso de
	 * cadastro de rubrica no layout. Pode ficar até o TTL do cache de sessão
	 * (60s) desatualizado após cadastrar/excluir — o cliente compensa localmente.
	 */
	temRubrica?: boolean;
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

/**
 * Retorna true se o usuário possui poder de Admin Geral — i.e., está numa
 * SESSÃO de admin (`tipo === 'admin'`). Pode ser o admin de bootstrap (env) ou
 * um policial promovido a Admin Geral via linha vinculada em `administradores`
 * (que loga escolhendo "Administrador"). NÃO concede os poderes EXCLUSIVOS do
 * Super Admin (`isSuperAdmin`).
 */
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

export function gerarToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return bytesToHex(bytes);
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
	return `${TOKEN_HASH_PREFIX}${bytesToHex(new Uint8Array(buf))}`;
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
		isSuperAdmin,
		adminPolicialId: admin.policial_id ?? null
	};
}

async function mapearPolicial(
	policial: typeof policiais.$inferSelect,
	platform?: App.Platform
): Promise<UsuarioLogado> {
	// CPF é cifrado em repouso (LGPD). Decifra aqui, no ponto único de montagem
	// da sessão, para que todo o restante (assinatura, exibição) receba o CPF em
	// claro em memória. Sem chave configurada, devolve o valor como está.
	const cpf = await decifrarCpfDoDB(policial.cpf, platform?.env as Env | undefined);
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
		cpf: cpf || null,
		email: policial.email ?? null,
		temRubrica: !!policial.rubrica
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
	return policial ? await mapearPolicial(policial, platform) : null;
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
		usuario = pols[0] ? await mapearPolicial(pols[0], platform) : null;
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
	return bytesToHex(new Uint8Array(hashBuf));
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
	// Super Admin tem console próprio (administração do sistema + auditoria).
	if (u.isSuperAdmin) {
		return '/super-admin';
	}
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
