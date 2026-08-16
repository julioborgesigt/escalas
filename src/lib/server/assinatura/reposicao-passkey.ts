/**
 * Reposição da chave de assinatura — lookup dos dois e-mails e consumo dos
 * códigos. A persistência mora em `$lib/db/passkey-reposicao`; aqui fica o
 * que o POST de registro precisa saber: "esta pessoa já tem chave? então os
 * dois códigos têm de conferir, amarrados aos e-mails atuais".
 */
import { eq } from 'drizzle-orm';
import { policiais, administradores } from '../schema';
import type { Database } from '$lib/db';
import type { DonoCredencial } from '$lib/db/webauthn';
import {
	consumirDoisCodigosReposicao,
	mensagemRecusaReposicao,
	type RecusaReposicao
} from '$lib/db/passkey-reposicao';

export type EmailsReposicao =
	| { ok: true; institucional: string; pessoal: string }
	| { ok: false; motivo: 'sem-institucional' | 'sem-pessoal-verificado' };

/**
 * Os dois endereços atuais do titular. Sem pessoal VERIFICADO a reposição
 * trava — melhor que TI sozinha repor a chave (decisão 5 / risco aceito).
 */
export async function buscarEmailsReposicao(
	db: Database,
	usuario: { tipo: 'policial' | 'admin'; id: number }
): Promise<EmailsReposicao> {
	if (usuario.tipo === 'policial') {
		const row = await db
			.select({
				email: policiais.email,
				pessoal: policiais.email_pessoal,
				verificado: policiais.email_pessoal_verificado
			})
			.from(policiais)
			.where(eq(policiais.id, usuario.id))
			.get();
		return deLinha(row);
	}
	const row = await db
		.select({
			email: administradores.email,
			pessoal: administradores.email_pessoal,
			verificado: administradores.email_pessoal_verificado
		})
		.from(administradores)
		.where(eq(administradores.id, usuario.id))
		.get();
	return deLinha(row);
}

function deLinha(
	row: { email: string | null; pessoal: string | null; verificado: number | null } | undefined
): EmailsReposicao {
	if (!row?.email) return { ok: false, motivo: 'sem-institucional' };
	if (!row.pessoal || row.verificado !== 1) {
		return { ok: false, motivo: 'sem-pessoal-verificado' };
	}
	return { ok: true, institucional: row.email, pessoal: row.pessoal };
}

export function mensagemSemEmailReposicao(
	motivo: 'sem-institucional' | 'sem-pessoal-verificado'
): string {
	if (motivo === 'sem-institucional') {
		return 'Você não possui e-mail institucional cadastrado. Contate o administrador.';
	}
	return (
		'A reposição da chave exige o e-mail pessoal verificado. ' +
		'Confirme-o em Meu Perfil e tente novamente.'
	);
}

/**
 * Consome os dois códigos. Caller já sabe que HÁ chave ativa — primeiro
 * cadastro não chega aqui.
 */
export async function exigirCodigosReposicao(
	db: Database,
	dono: DonoCredencial,
	emails: { institucional: string; pessoal: string },
	codigos: {
		desafioInstitucional?: string | null;
		codigoInstitucional?: string | null;
		desafioPessoal?: string | null;
		codigoPessoal?: string | null;
	}
): Promise<{ ok: true } | { ok: false; motivo: RecusaReposicao }> {
	return consumirDoisCodigosReposicao(
		db,
		{
			...codigos,
			emailInstitucional: emails.institucional,
			emailPessoal: emails.pessoal
		},
		dono
	);
}

export { mensagemRecusaReposicao };
