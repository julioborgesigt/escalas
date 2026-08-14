/**
 * Reconferência da asserção guardada no documento assinado.
 *
 * O manifesto do PDF afirma que uma chave verificada por biometria assinou
 * aquele documento. Esta função é o que permite REFAZER essa verificação
 * depois — em perícia, numa contestação disciplinar, ou num teste.
 *
 * Sem ela as colunas `webauthn_*` de `escala_documentos` seriam decorativas: um
 * registro que ninguém sabe conferir prova tanto quanto registro nenhum.
 *
 * ## O que ela refaz, e o que não pode refazer
 *
 * Refaz o núcleo criptográfico: que a assinatura guardada é válida para a
 * chave pública da credencial, sobre exatamente aqueles `authenticatorData` e
 * `clientDataJSON`, e que o desafio embutido no `clientDataJSON` é o hash do
 * PDF que está no R2. É isso que amarra a assinatura ÀQUELE documento.
 *
 * **O contador não é reconferido.** Ele avança a cada assinatura, e a coluna
 * da credencial guarda o valor ATUAL — comparar contra ele reprovaria toda
 * assinatura antiga. A proteção anti-clone é do momento da assinatura
 * (`assercao.ts`), não da reconferência.
 *
 * **A credencial pode ter sido revogada depois**, e isso NÃO invalida a
 * assinatura: revogar é ato futuro, como revogar um certificado não anula o
 * que ele assinou antes. O resultado reporta a revogação como informação, e o
 * chamador decide o que dizer sobre ela.
 */
import { verificarAssercao } from './assercao';
import { base64UrlToBytes } from '$lib/crypto/bin';
import { hexToBytes } from '$lib/crypto/hex';

/** Colunas `webauthn_*` de `escala_documentos`, como vêm do banco. */
export interface AssercaoGuardada {
	webauthn_credential_id: string | null;
	webauthn_client_data: string | null;
	webauthn_authenticator_data: string | null;
	webauthn_assinatura: string | null;
}

export type ResultadoReconferencia =
	| { situacao: 'sem-passkey' }
	| { situacao: 'credencial-ausente'; credentialId: string }
	| { situacao: 'invalida'; motivo: string }
	| { situacao: 'valida'; credentialId: string; revogadaEm: string | null };

/**
 * Reconfere a asserção guardada contra a chave pública da credencial e o hash
 * do documento.
 *
 * @param documento colunas `webauthn_*` da linha do documento.
 * @param credencial credencial correspondente, ou `null` se já não existir.
 * @param documentoHashHex SHA-256 do PDF que foi assinado (o desafio).
 * @param origem origem canônica do app (`resolverAppOrigin`).
 */
export async function reconferirAssercaoDocumento(
	documento: AssercaoGuardada,
	credencial: { publicKeySpki: Uint8Array; revogadaEm: string | null } | null,
	documentoHashHex: string,
	origem: string
): Promise<ResultadoReconferencia> {
	const { webauthn_credential_id, webauthn_client_data, webauthn_authenticator_data } = documento;
	const assinatura = documento.webauthn_assinatura;

	// Documento assinado por token A3 ou em tela sem passkey: não há o que
	// reconferir, e isso não é falha.
	if (
		!webauthn_credential_id ||
		!webauthn_client_data ||
		!webauthn_authenticator_data ||
		!assinatura
	) {
		return { situacao: 'sem-passkey' };
	}

	if (!credencial) {
		// A credencial foi apagada (titular excluído do sistema). A assinatura
		// pode ter sido legítima; só não há mais com o que conferir.
		return { situacao: 'credencial-ausente', credentialId: webauthn_credential_id };
	}

	const desafio = hexToBytes(documentoHashHex);
	if (!desafio) return { situacao: 'invalida', motivo: 'hash-do-documento-invalido' };

	const r = await verificarAssercao({
		clientDataJSON: base64UrlToBytes(webauthn_client_data),
		authenticatorData: base64UrlToBytes(webauthn_authenticator_data),
		assinatura: base64UrlToBytes(assinatura),
		publicKeySpki: credencial.publicKeySpki,
		desafioEsperado: desafio,
		origemEsperada: origem,
		// Zero: o contador da credencial avançou desde então, e comparar contra o
		// valor de hoje reprovaria toda assinatura antiga. Ver o cabeçalho.
		contadorArmazenado: 0
	});

	if (!r.ok) return { situacao: 'invalida', motivo: r.motivo };

	return {
		situacao: 'valida',
		credentialId: webauthn_credential_id,
		revogadaEm: credencial.revogadaEm
	};
}
