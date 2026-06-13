/**
 * Verificação criptográfica da resposta de desafio do login por Token A3
 * (ICP-Brasil / Assinador SERPRO).
 *
 * ## Por que este módulo existe (correção de bypass crítico)
 *
 * O login por certificado é um desafio-resposta: `/iniciar` emite um `nonce`
 * aleatório; o cliente assina `SHA-256(nonce)` com a chave privada do Token A3
 * e devolve o CMS PKCS#7. Para que isso PROVE posse da chave — e não apenas
 * posse do certificado público, que é público e extraível de qualquer PDF
 * assinado pelo titular (inclusive os que este próprio sistema publica em
 * `/validar`) — o servidor precisa, ANTES de autenticar, confirmar três coisas:
 *
 *   1. **Assinatura válida** sobre os SignedAttributes do CMS — prova de que
 *      a chave privada do certificado assinou algo.
 *   2. **Vínculo ao desafio:** o `messageDigest` assinado é exatamente o hash
 *      do nonce DESTE desafio — impede replay e o reaproveitamento de um CMS
 *      assinado para outro fim.
 *   3. **Cadeia ICP-Brasil** (feito no handler, fail-closed): garante que o CPF
 *      lido do subject pertence de fato ao titular. Sem isso, um atacante geraria
 *      um certificado autoassinado com o CPF da vítima, assinaria o nonce com a
 *      PRÓPRIA chave (passando 1 e 2) e se autenticaria como a vítima.
 *
 * Este módulo cobre (1) e (2) e devolve o certificado do signatário já validado
 * para o handler aplicar (3) e extrair a identidade.
 */
import forge from 'node-forge';
import { parseCms, verificarAssinaturaCmsAsync } from './pdf-verification';
import { extrairDadosDoCertificado } from './pdf-signing-prepare';
import { compararSegredoUtf8TimingSafe } from '$lib/auth';
import { logger } from './logger';

type MotivoFalhaCert = 'cms_invalido' | 'assinatura_invalida' | 'nonce_nao_confere';

type ResultadoDesafioCert =
	| { ok: true; nome: string; cpf: string; certificado: forge.pki.Certificate }
	| { ok: false; motivo: MotivoFalhaCert };

function base64ParaBytes(b64: string): Uint8Array | null {
	try {
		const bin = forge.util.decode64(b64);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
		return out;
	} catch {
		return null;
	}
}

/**
 * Verifica a resposta do desafio de login por certificado (passos 1 e 2 acima).
 *
 * @param cmsBase64 CMS PKCS#7 (detached) produzido pelo assinador, em base64.
 * @param expectedMessageDigestHex hex (lowercase) do digest que o cliente deve
 *        ter assinado — i.e. `SHA-256(bytes do nonce)`. Gravado por `/iniciar`
 *        em `dois_fatores_tokens.codigo`.
 *
 * Nunca lança: qualquer erro vira `{ ok: false }`. Em sucesso, devolve também o
 * certificado do signatário (já parseado) para o handler validar a cadeia e
 * extrair a identidade sem reparsear o CMS.
 */
export async function verificarRespostaDesafioCertificado(
	cmsBase64: string,
	expectedMessageDigestHex: string
): Promise<ResultadoDesafioCert> {
	const der = base64ParaBytes(cmsBase64);
	if (!der) return { ok: false, motivo: 'cms_invalido' };

	const cms = parseCms(der);
	if (!cms) return { ok: false, motivo: 'cms_invalido' };

	// (1) Assinatura sobre os SignedAttributes — prova de posse da chave privada.
	const assinaturaOk = await verificarAssinaturaCmsAsync(
		cms.certificate,
		cms.sigAlgOid,
		cms.signedAttrsAsSet,
		cms.signatureValue,
		cms.digestAlgOid
	);
	if (!assinaturaOk) {
		logger.warn('[cert-login] Assinatura CMS inválida');
		return { ok: false, motivo: 'assinatura_invalida' };
	}

	// (2) O messageDigest assinado tem de ser o hash do nonce DESTE desafio.
	//     Comparação timing-safe; ambos os lados são hex SHA-256 (64 chars).
	const messageDigestHex = forge.util.bytesToHex(cms.messageDigest);
	const esperado = (expectedMessageDigestHex ?? '').toLowerCase();
	if (!esperado || !compararSegredoUtf8TimingSafe(messageDigestHex, esperado)) {
		logger.warn('[cert-login] messageDigest não corresponde ao nonce do desafio');
		return { ok: false, motivo: 'nonce_nao_confere' };
	}

	// Identidade extraída do MESMO certificado cuja assinatura acabou de ser
	// validada — nunca de um outro certificado embutido no CMS.
	const { nome, cpf } = extrairDadosDoCertificado(cms.certificate);
	return { ok: true, nome, cpf, certificado: cms.certificate };
}
