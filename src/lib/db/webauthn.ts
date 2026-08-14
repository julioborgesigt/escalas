/**
 * Credenciais WebAuthn (passkey de assinatura) — leitura e escrita.
 *
 * A chave privada correspondente vive no enclave do aparelho do policial e
 * nunca chega aqui. O que este módulo guarda é a chave PÚBLICA, o contador e
 * os flags que dizem se a credencial é sincronizada — o suficiente para
 * verificar a asserção em `server/assinatura/webauthn/assercao.ts` e para o
 * manifesto descrever, sem exagero, o que foi verificado.
 *
 * **O dono é a PESSOA.** Quem é Admin Geral vinculado tem duas linhas
 * (`policiais` + `administradores`), e a credencial registrada num modo tem de
 * valer no outro. A chave usada aqui é sempre o `dono` de
 * `server/auth/credencial.ts` — `credencialDoUsuario(locals.usuario)` devolve
 * exatamente isso sem ida ao banco. Gravar o par `(tipo, id)` cru da sessão
 * repetiria o FLW-AUTH-002, em que a senha nova ia para a linha que o login não
 * lê e o reset falhava em silêncio.
 *
 * **Uma credencial ativa por pessoa.** Registrar de novo revoga a anterior, e
 * isso não é limitação administrativa: com uma credencial só, o `preparar` sabe
 * QUAL credencial vai assinar e o manifesto sai completo, com a asserção
 * cobrindo um PDF que já nomeia a credencial que o assinou. Com N credenciais o
 * manifesto teria de ficar vago ou ser escrito depois do hash já assinado.
 *
 * **Revogar não apaga.** A credencial que assinou um documento continua
 * consultável depois da troca de aparelho — sem isso, conferir aquela
 * assinatura ficaria sem contraparte. É registro probatório, não cadastro.
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import { credenciaisWebauthn, webauthnDesafios } from '../server/schema';
import type { Database } from './core';
import { bytesToBase64, base64ToBytes, bytesToBase64Url, base64UrlToBytes } from '$lib/crypto/bin';
import { gerarTokenOpaco } from '$lib/crypto/token';

/** Identidade DONA da credencial — o `dono` de `resolverCredencial`. */
export interface DonoCredencial {
	tipo: 'policial' | 'admin';
	id: number;
}

/** Credencial ativa, já com os bytes decodificados para uso criptográfico. */
export interface CredencialWebauthn {
	id: number;
	credentialId: string;
	publicKeySpki: Uint8Array;
	contador: number;
	aaguid: string | null;
	backupElegivel: boolean;
	backupAtivo: boolean;
	apelido: string | null;
	criadoEm: string;
	ultimoUso: string | null;
}

/** Dados que a cerimônia de registro produziu (ver `webauthn/registro.ts`). */
export interface NovaCredencial {
	credentialId: string;
	publicKeySpki: Uint8Array;
	contador: number;
	aaguid: string | null;
	backupElegivel: boolean;
	backupAtivo: boolean;
	apelido?: string | null;
}

/**
 * Credencial ATIVA da pessoa, ou `null` se ela ainda não registrou (ou revogou).
 *
 * É o que decide se o fluxo de passkey pode sequer ser oferecido na tela.
 */
export async function buscarCredencialAtiva(
	db: Database,
	dono: DonoCredencial
): Promise<CredencialWebauthn | null> {
	const linha = await db
		.select()
		.from(credenciaisWebauthn)
		.where(
			and(
				eq(credenciaisWebauthn.usuario_tipo, dono.tipo),
				eq(credenciaisWebauthn.usuario_id, dono.id),
				isNull(credenciaisWebauthn.revogado_em)
			)
		)
		.get();

	return linha ? paraCredencial(linha) : null;
}

/**
 * Credencial pelo `credentialId` que a asserção declara.
 *
 * Devolve mesmo quando revogada: quem chama precisa distinguir "não existe" de
 * "existiu e foi revogada" — a segunda merece mensagem própria para o
 * assinante, que provavelmente trocou de aparelho.
 */
export async function buscarCredencialPorId(
	db: Database,
	credentialId: string
): Promise<(CredencialWebauthn & { revogadaEm: string | null; dono: DonoCredencial }) | null> {
	const linha = await db
		.select()
		.from(credenciaisWebauthn)
		.where(eq(credenciaisWebauthn.credential_id, credentialId))
		.get();
	if (!linha) return null;

	return {
		...paraCredencial(linha),
		revogadaEm: linha.revogado_em,
		dono: { tipo: linha.usuario_tipo, id: linha.usuario_id }
	};
}

/**
 * Registra a credencial, revogando a anterior da mesma pessoa.
 *
 * As duas escritas são sequenciais e não transacionais (D1 não expõe
 * transação interativa). A ordem escolhida — revogar e depois inserir — falha
 * para o lado seguro: se a inserção não acontecer, a pessoa fica sem
 * credencial ativa e refaz o cadastro. A ordem inversa poderia deixar duas
 * ativas, e aí o `preparar` não saberia qual nomear no manifesto.
 */
export async function registrarCredencial(
	db: Database,
	dono: DonoCredencial,
	nova: NovaCredencial
): Promise<void> {
	await revogarCredenciaisAtivas(db, dono);
	await db.insert(credenciaisWebauthn).values({
		usuario_tipo: dono.tipo,
		usuario_id: dono.id,
		credential_id: nova.credentialId,
		public_key_spki: bytesToBase64(nova.publicKeySpki),
		contador: nova.contador,
		aaguid: nova.aaguid,
		backup_elegivel: nova.backupElegivel ? 1 : 0,
		backup_ativo: nova.backupAtivo ? 1 : 0,
		apelido: nova.apelido ?? null
	});
}

/**
 * Revoga toda credencial ativa da pessoa. Idempotente.
 *
 * Usado pelo registro (para manter uma só) e pela revogação administrativa.
 */
export async function revogarCredenciaisAtivas(
	db: Database,
	dono: DonoCredencial
): Promise<number> {
	const linhas = await db
		.update(credenciaisWebauthn)
		.set({ revogado_em: new Date().toISOString() })
		.where(
			and(
				eq(credenciaisWebauthn.usuario_tipo, dono.tipo),
				eq(credenciaisWebauthn.usuario_id, dono.id),
				isNull(credenciaisWebauthn.revogado_em)
			)
		)
		.returning({ id: credenciaisWebauthn.id });
	return linhas.length;
}

/**
 * APAGA as credenciais da pessoa — inclusive as revogadas.
 *
 * Diferente de `revogarCredenciaisAtivas`, que preserva a linha porque ela é a
 * contraparte de assinaturas já dadas. Este DELETE só é legítimo quando a
 * pessoa sai do sistema sem documento assinado: aí não há assinatura para
 * conferir depois, e manter a chave pública seria guardar dado de um titular
 * que não existe mais (LGPD art. 16).
 *
 * Quem tem documento assinado não é excluído — é desvinculado
 * (FLW-POLICIAL-002), e a credencial continua onde está.
 */
export async function excluirCredenciaisDoDono(
	db: Database,
	dono: DonoCredencial
): Promise<number> {
	const linhas = await db
		.delete(credenciaisWebauthn)
		.where(
			and(
				eq(credenciaisWebauthn.usuario_tipo, dono.tipo),
				eq(credenciaisWebauthn.usuario_id, dono.id)
			)
		)
		.returning({ id: credenciaisWebauthn.id });
	return linhas.length;
}

/**
 * Grava o contador da asserção e a data de uso.
 *
 * O contador só avança: `assercao.ts` já recusou regressão antes de chegar
 * aqui. Autenticador que não implementa manda 0 sempre, e nesse caso a coluna
 * fica em 0 — a comparação de regressão trata esse caso.
 */
export async function registrarUsoCredencial(
	db: Database,
	id: number,
	contador: number
): Promise<void> {
	await db
		.update(credenciaisWebauthn)
		.set({ contador, ultimo_uso: new Date().toISOString() })
		.where(eq(credenciaisWebauthn.id, id));
}

// ---------------------------------------------------------------------------
// Desafio da cerimônia de registro
// ---------------------------------------------------------------------------

/**
 * 5 minutos. O tempo entre abrir a tela e encostar o dedo no leitor. Janela
 * maior só amplia o alcance de um desafio vazado, e refazer é um clique.
 */
const VALIDADE_DESAFIO_MS = 5 * 60 * 1000;

/**
 * Emite o desafio do REGISTRO e devolve `{ desafioId, desafio }`.
 *
 * O desafio da ASSINATURA não vem daqui: é o hash do PDF preparado, gravado em
 * `assinatura_intencoes` por `criarIntencaoAssinatura`. São coisas diferentes —
 * um prova frescor da cerimônia, o outro amarra a assinatura ao documento.
 */
export async function criarDesafioWebauthn(
	db: Database,
	dono: DonoCredencial
): Promise<{ desafioId: string; desafio: string }> {
	const desafioId = gerarTokenOpaco();
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const desafio = bytesToBase64Url(bytes);

	await db.insert(webauthnDesafios).values({
		desafio_id: desafioId,
		usuario_tipo: dono.tipo,
		usuario_id: dono.id,
		desafio,
		expires_at: new Date(Date.now() + VALIDADE_DESAFIO_MS).toISOString()
	});

	return { desafioId, desafio };
}

/**
 * CONSOME o desafio e devolve seus bytes, ou `null` se inválido.
 *
 * `UPDATE ... WHERE usado = 0 ... RETURNING`, o mesmo formato de
 * `consumirIntencaoAssinatura` e `consumirDesafio2FA`: o SQLite serializa e
 * exatamente um chamador vence a corrida. Confere também o dono — um desafio
 * emitido para outra pessoa não serve, mesmo dentro da validade.
 */
export async function consumirDesafioWebauthn(
	db: Database,
	desafioId: string | undefined | null,
	dono: DonoCredencial
): Promise<Uint8Array | null> {
	if (!desafioId) return null;

	const linhas = await db
		.update(webauthnDesafios)
		.set({ usado: 1 })
		.where(
			and(
				eq(webauthnDesafios.desafio_id, desafioId),
				eq(webauthnDesafios.usado, 0),
				eq(webauthnDesafios.usuario_tipo, dono.tipo),
				eq(webauthnDesafios.usuario_id, dono.id),
				gt(webauthnDesafios.expires_at, new Date().toISOString())
			)
		)
		.returning({ desafio: webauthnDesafios.desafio });

	const linha = linhas[0];
	return linha ? base64UrlToBytes(linha.desafio) : null;
}

type LinhaCredencial = typeof credenciaisWebauthn.$inferSelect;

function paraCredencial(linha: LinhaCredencial): CredencialWebauthn {
	return {
		id: linha.id,
		credentialId: linha.credential_id,
		publicKeySpki: base64ToBytes(linha.public_key_spki),
		contador: linha.contador,
		aaguid: linha.aaguid,
		backupElegivel: linha.backup_elegivel === 1,
		backupAtivo: linha.backup_ativo === 1,
		apelido: linha.apelido,
		criadoEm: linha.criado_em,
		ultimoUso: linha.ultimo_uso
	};
}
