import { eq } from 'drizzle-orm';
import { administradores, policiais } from '../server/schema';
import { gerarSenhaAleatoriaHash } from '../auth';
import type { Database } from './core';

/**
 * Admin Geral VINCULADO: cria (ou mantém) uma linha em `administradores`
 * ligada a um policial. A conta admin NÃO tem senha própria — o login de
 * administrador autentica contra as credenciais do policial (mesma senha/
 * e-mail/2FA). `login` = matrícula, então a pessoa loga com a MESMA matrícula
 * escolhendo "Administrador". `senha` recebe um placeholder aleatório (nunca
 * usado). `primeiro_acesso=0`: o policial já se onboardou como servidor.
 */
export async function vincularAdminGeral(
	db: Database,
	policial: typeof policiais.$inferSelect
): Promise<void> {
	const existente = await db
		.select({ id: administradores.id })
		.from(administradores)
		.where(eq(administradores.policial_id, policial.id))
		.get();
	if (existente) return; // já vinculado — idempotente

	const senhaPlaceholder = await gerarSenhaAleatoriaHash();
	await db.insert(administradores).values({
		login: policial.matricula,
		senha: senhaPlaceholder,
		nome: policial.nome,
		email: policial.email ?? null,
		email_pessoal: policial.email_pessoal ?? null,
		email_pessoal_verificado: policial.email_pessoal_verificado,
		primeiro_acesso: 0,
		policial_id: policial.id
	});
}

/** Remove a condição de Admin Geral vinculado de um policial. */
export async function desvincularAdminGeral(db: Database, policialId: number): Promise<void> {
	await db.delete(administradores).where(eq(administradores.policial_id, policialId));
}

/** True se o policial tem uma conta Admin Geral vinculada. */
export async function ehAdminGeralVinculado(db: Database, policialId: number): Promise<boolean> {
	const row = await db
		.select({ id: administradores.id })
		.from(administradores)
		.where(eq(administradores.policial_id, policialId))
		.get();
	return !!row;
}

/**
 * Devolve a conta admin (id/nome) vinculada a um policial, ou `undefined`.
 * Usado pela alternância de sessão Usuário → ADM Geral (a pessoa já poderia
 * logar como admin com as mesmas credenciais; aqui só evitamos o relogin).
 */
export async function buscarAdminVinculadoPorPolicial(
	db: Database,
	policialId: number
): Promise<{ id: number; nome: string } | undefined> {
	return db
		.select({ id: administradores.id, nome: administradores.nome })
		.from(administradores)
		.where(eq(administradores.policial_id, policialId))
		.get();
}
