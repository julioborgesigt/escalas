/**
 * Guarda de reautenticação para a TROCA do e-mail pessoal (canal de
 * recuperação de senha) — achado L-1 da auditoria de segurança 2026-07-10.
 *
 * Regra: quem JÁ TEM e-mail pessoal cadastrado precisa reinserir a senha para
 * trocá-lo — uma sessão esquecida/roubada não basta para redirecionar o canal
 * de recuperação. O 1º cadastro (sem e-mail anterior) segue sem senha, como no
 * onboarding do /alterar-senha.
 *
 * Antes do L-1, a regra valia só para sessões de policial; sessões de admin
 * trocavam o e-mail sem senha. Aqui a credencial verificada espelha o
 * /alterar-senha: admin VINCULADO autentica com a senha do policial vinculado
 * (`adminPolicialId`); admin standalone, com a própria linha de
 * `administradores`; policial, com a sua.
 *
 * Throttle: mesma chave por usuário (`senha-atual:<tipo>:<id>`) e mesmo
 * propósito (`alterar_senha`) do /alterar-senha — os dois endpoints verificam
 * O MESMO segredo, então compartilham o orçamento de tentativas (5/15min).
 * Sem isso, este endpoint seria um caminho paralelo de brute-force online da
 * senha com sessão roubada.
 */

import { eq } from 'drizzle-orm';
import { verificarSenha, type UsuarioLogado } from '$lib/auth';
import { administradores, policiais } from './schema';
import { contarRecoveryAttempts, registrarRecoveryAttempt } from './recovery-rate-limit';
import type { Database } from '$lib/db';

const SENHA_ATUAL_MAX_TENTATIVAS = 5;
export const SENHA_ATUAL_JANELA_MIN = 15;

export type ResultadoGuardaEmailPessoal =
	| { ok: true; trocaDeEmailExistente: boolean }
	| { ok: false; erro: 'senha_ausente' | 'senha_incorreta' | 'bloqueado' };

/**
 * Verifica se a operação de cadastrar/trocar o e-mail pessoal pode prosseguir.
 *
 * - Sem e-mail pessoal atual → `{ ok: true, trocaDeEmailExistente: false }`
 *   (1º cadastro; senha não exigida).
 * - Com e-mail pessoal atual → exige `senha` correta (contra a credencial da
 *   conta, com throttle por usuário) ou devolve o erro correspondente.
 */
export async function exigirSenhaParaTrocaEmailPessoal(
	db: Database,
	u: UsuarioLogado,
	senha: string | undefined,
	pepper: string | undefined
): Promise<ResultadoGuardaEmailPessoal> {
	// O e-mail pessoal vive na tabela da SESSÃO (confirmar-verificacao persiste
	// em `administradores` para sessões admin, mesmo as vinculadas).
	const emailPessoalAtual =
		u.tipo === 'policial'
			? (
					await db
						.select({ email_pessoal: policiais.email_pessoal })
						.from(policiais)
						.where(eq(policiais.id, u.id))
						.get()
				)?.email_pessoal
			: (
					await db
						.select({ email_pessoal: administradores.email_pessoal })
						.from(administradores)
						.where(eq(administradores.id, u.id))
						.get()
				)?.email_pessoal;

	if (!emailPessoalAtual) return { ok: true, trocaDeEmailExistente: false };

	if (!senha) return { ok: false, erro: 'senha_ausente' };

	const chaveThrottle = `senha-atual:${u.tipo}:${u.id}`;
	const { blocked } = await contarRecoveryAttempts(
		db,
		chaveThrottle,
		'alterar_senha',
		SENHA_ATUAL_JANELA_MIN,
		SENHA_ATUAL_MAX_TENTATIVAS
	);
	if (blocked) return { ok: false, erro: 'bloqueado' };

	// Credencial: espelha /alterar-senha (admin vinculado → policial vinculado).
	const credencialEhPolicial = u.tipo === 'policial' || u.adminPolicialId != null;
	const credencialId = u.adminPolicialId ?? u.id;
	const registro = credencialEhPolicial
		? await db
				.select({ senha: policiais.senha })
				.from(policiais)
				.where(eq(policiais.id, credencialId))
				.get()
		: await db
				.select({ senha: administradores.senha })
				.from(administradores)
				.where(eq(administradores.id, credencialId))
				.get();

	// Nota: admin standalone criado por bootstrap tem `senha` placeholder
	// (aleatória, inverificável) — nesse estado a troca só é possível após
	// definir uma senha real (fluxo de redefinição). Fail-closed intencional.
	if (!registro || !(await verificarSenha(senha, registro.senha, pepper))) {
		await registrarRecoveryAttempt(db, chaveThrottle, 'alterar_senha');
		return { ok: false, erro: 'senha_incorreta' };
	}

	return { ok: true, trocaDeEmailExistente: true };
}
