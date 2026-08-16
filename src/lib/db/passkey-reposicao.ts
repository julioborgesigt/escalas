/**
 * 2FA da reposição da chave de assinatura.
 *
 * Dois canais — e-mail institucional e e-mail pessoal — só quando já há chave
 * ativa. O primeiro cadastro não passa por aqui: a caixa pessoal acabou de ser
 * verificada no `/alterar-senha`. Tabela própria (`passkey_reposicao`) porque
 * `dois_fatores_tokens` tem CHECK de `tipo` (migração 0028) e rebuild seria
 * caro para hospedar mais um nonce.
 *
 * TOKEN: o cliente recebe `desafio_id` opaco; o banco guarda o HASH do código
 * amarrado ao e-mail destino (`extra\x1f codigo`, o mesmo I-1 do 2FA de
 * verificação de e-mail). Expurga por `expires_at` ISO, com os demais
 * segredos de curta duração.
 */
import { and, eq, sql } from 'drizzle-orm';
import { passkeyReposicao } from '../server/schema';
import type { Database } from './core';
import { sha256Hex } from '../crypto/digest';
import { gerarTokenOpaco } from '../crypto/token';
import { comparacaoTimingSafe } from '../crypto/timing-safe';
import type { DonoCredencial } from './webauthn';

/** Mesma janela do 2FA de assinatura — 10 min para os dois códigos. */
const REPOSICAO_VALIDADE_MS = 10 * 60 * 1000;

export type CanalReposicao = 'institucional' | 'pessoal';

async function hashCodigo(codigo: string, emailDestino: string): Promise<string> {
	return sha256Hex(`${emailDestino}\x1f${codigo}`);
}

/**
 * Emite o desafio de UM canal e devolve o `desafioId` opaco.
 *
 * O código em claro existe só nesta chamada — vai ao e-mail e some. Quem
 * conferir precisa passar o mesmo `emailDestino` ou o hash não bate.
 */
export async function criarDesafioReposicao(
	db: Database,
	dono: DonoCredencial,
	canal: CanalReposicao,
	codigo: string,
	emailDestino: string
): Promise<string> {
	const desafioId = gerarTokenOpaco();
	await db.insert(passkeyReposicao).values({
		desafio_id: desafioId,
		usuario_tipo: dono.tipo,
		usuario_id: dono.id,
		canal,
		codigo_hash: await hashCodigo(codigo, emailDestino),
		expires_at: new Date(Date.now() + REPOSICAO_VALIDADE_MS).toISOString()
	});
	return desafioId;
}

export type RecusaReposicao = 'ausente' | 'invalido' | 'expirado' | 'esgotado';

/**
 * CONSOME o desafio de um canal. Uso único: `UPDATE ... WHERE usado = 0`.
 *
 * Recusa indistinguível entre "código errado" e "desafio de outra pessoa" —
 * não revela se o `desafioId` existe. Canal tem de bater: um código do
 * institucional não autentica o pessoal.
 */
export async function consumirDesafioReposicao(
	db: Database,
	desafioId: string | undefined | null,
	codigo: string | undefined | null,
	dono: DonoCredencial,
	canal: CanalReposicao,
	emailDestino: string
): Promise<{ ok: true } | { ok: false; motivo: RecusaReposicao }> {
	if (!desafioId || !codigo) return { ok: false, motivo: 'ausente' };

	const linha = await db
		.select()
		.from(passkeyReposicao)
		.where(eq(passkeyReposicao.desafio_id, desafioId))
		.get();

	if (
		!linha ||
		linha.usado === 1 ||
		linha.canal !== canal ||
		linha.usuario_tipo !== dono.tipo ||
		linha.usuario_id !== dono.id
	) {
		return { ok: false, motivo: 'invalido' };
	}
	if (new Date() > new Date(linha.expires_at)) return { ok: false, motivo: 'expirado' };
	if (linha.tentativas >= 5) return { ok: false, motivo: 'esgotado' };

	const esperado = await hashCodigo(codigo, emailDestino);
	if (!comparacaoTimingSafe(linha.codigo_hash, esperado)) {
		await db
			.update(passkeyReposicao)
			.set({ tentativas: sql`${passkeyReposicao.tentativas} + 1` })
			.where(eq(passkeyReposicao.id, linha.id));
		return { ok: false, motivo: 'invalido' };
	}

	const consumido = await db
		.update(passkeyReposicao)
		.set({ usado: 1 })
		.where(and(eq(passkeyReposicao.id, linha.id), eq(passkeyReposicao.usado, 0)))
		.returning({ id: passkeyReposicao.id });

	if (consumido.length !== 1) return { ok: false, motivo: 'invalido' };
	return { ok: true };
}

/**
 * Os dois canais, os dois. Ausência de qualquer código recusa sem consumir
 * nenhum desafio. Falha no institucional não consome o pessoal.
 */
export async function consumirDoisCodigosReposicao(
	db: Database,
	dados: {
		desafioInstitucional?: string | null;
		codigoInstitucional?: string | null;
		desafioPessoal?: string | null;
		codigoPessoal?: string | null;
		emailInstitucional: string;
		emailPessoal: string;
	},
	dono: DonoCredencial
): Promise<{ ok: true } | { ok: false; motivo: RecusaReposicao }> {
	if (
		!dados.desafioInstitucional ||
		!dados.codigoInstitucional ||
		!dados.desafioPessoal ||
		!dados.codigoPessoal
	) {
		return { ok: false, motivo: 'ausente' };
	}
	const inst = await consumirDesafioReposicao(
		db,
		dados.desafioInstitucional,
		dados.codigoInstitucional,
		dono,
		'institucional',
		dados.emailInstitucional
	);
	if (!inst.ok) return inst;
	return consumirDesafioReposicao(
		db,
		dados.desafioPessoal,
		dados.codigoPessoal,
		dono,
		'pessoal',
		dados.emailPessoal
	);
}

/** Mensagem única — não distingue qual canal falhou. */
export function mensagemRecusaReposicao(motivo: RecusaReposicao): string {
	if (motivo === 'expirado') {
		return 'Os códigos de reposição expiraram. Solicite novos códigos e tente novamente.';
	}
	if (motivo === 'esgotado') {
		return 'Muitas tentativas. Solicite novos códigos de reposição.';
	}
	if (motivo === 'ausente') {
		return 'A reposição da chave exige os códigos enviados ao e-mail institucional e ao pessoal.';
	}
	return 'Códigos de reposição inválidos. Confira os dois e-mails e tente novamente.';
}
