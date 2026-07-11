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
import { consultarOcsp, type OcspSnapshot } from './ocsp';
import { loadTrustStore, type TrustStore } from './icp-brasil/trust-store';
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

// ---------------------------------------------------------------------------
// Revogação (OCSP) no login — achado M-1 da auditoria de segurança 2026-07-10
// ---------------------------------------------------------------------------
//
// Cadeia válida + datas não cobrem e-CPF REVOGADO: um token perdido/roubado e
// reportado à AC continuaria autenticando até o certificado expirar. A política
// espelha a do fluxo de assinatura (`cades-finalizer`):
//   - `revoked`                      → nega o login (fail-closed);
//   - resposta com assinatura do responder inválida → nega (indistinguível de
//     MITM injetando "good" para um cert revogado);
//   - `unknown` (responder fora do ar / sem AIA / trust store sem o issuer)
//     → PERMITE com aviso em log e na trilha de auditoria (soft-fail): o
//     certificado já provou posse da chave + cadeia ICP-Brasil, e bloquear
//     por indisponibilidade da AC derrubaria o único canal de quem não tem
//     e-mail para o 2FA por senha.

/** Timeout da consulta OCSP no login — mais curto que o default (10 s) do
 *  fluxo de assinatura para não segurar o formulário de login. */
const OCSP_LOGIN_TIMEOUT_MS = 5_000;

export type DecisaoRevogacaoLogin =
	| { permitido: true; ocsp: 'good' | 'unknown'; aviso?: string }
	| { permitido: false; motivo: 'revogado' | 'resposta_nao_confiavel'; revokedAt?: string };

/**
 * Aplica a política de revogação do LOGIN a um snapshot OCSP. Pura — separada
 * de `verificarRevogacaoParaLogin` para ser testável sem rede/trust store.
 */
export function avaliarSnapshotOcspLogin(
	snap: Pick<OcspSnapshot, 'status' | 'assinaturaResponder' | 'revokedAt' | 'erro'>
): DecisaoRevogacaoLogin {
	// Resposta ATIVA cuja assinatura não confere: status inutilizável — não é o
	// mesmo que indisponibilidade (`consultarOcsp` já rebaixa para 'unknown',
	// mas o marcador `assinaturaResponder` distingue os dois casos).
	if (snap.assinaturaResponder === 'invalida') {
		return { permitido: false, motivo: 'resposta_nao_confiavel' };
	}
	if (snap.status === 'revoked') {
		return { permitido: false, motivo: 'revogado', revokedAt: snap.revokedAt };
	}
	if (snap.status === 'good') return { permitido: true, ocsp: 'good' };
	return { permitido: true, ocsp: 'unknown', aviso: snap.erro ?? 'status OCSP unknown' };
}

/**
 * Consulta a revogação do certificado de login junto ao responder OCSP da AC.
 *
 * Deve ser chamada DEPOIS de `forge.pki.verifyCertificateChain` (o issuer é
 * localizado no trust store pelo CN — só faz sentido para cadeia já validada).
 * Nunca lança: falhas de rede/parse degradam para `{ permitido: true,
 * ocsp: 'unknown' }`, cabendo ao caller registrar o aviso na auditoria.
 *
 * `deps` permite injetar `consultar`/`trustStore` nos testes (sem rede).
 */
export async function verificarRevogacaoParaLogin(
	certificado: forge.pki.Certificate,
	deps: {
		consultar?: typeof consultarOcsp;
		trustStore?: Pick<TrustStore, 'intermediates' | 'roots'>;
	} = {}
): Promise<DecisaoRevogacaoLogin> {
	try {
		const consultar = deps.consultar ?? consultarOcsp;
		const ts = deps.trustStore ?? loadTrustStore();
		const issuerCN = (certificado.issuer.getField('CN')?.value as string) || '';
		const issuer = [...ts.intermediates, ...ts.roots].find(
			(c) => (c.subject.getField('CN')?.value as string) === issuerCN
		);
		if (!issuer) {
			// Anômalo: a cadeia validou contra o caStore mas o CN não foi localizado
			// (ex.: mismatch de encoding do DN). Soft-fail auditável, como 'unknown'.
			logger.warn('[cert-login] Issuer não encontrado no trust store — OCSP pulado', {
				issuerCN
			});
			return { permitido: true, ocsp: 'unknown', aviso: 'issuer não localizado no trust store' };
		}
		const snap = await consultar(certificado, issuer, OCSP_LOGIN_TIMEOUT_MS);
		return avaliarSnapshotOcspLogin(snap);
	} catch (e) {
		// `consultarOcsp` não lança; exceção aqui é anômala (ex.: trust store
		// corrompido). Mesmo soft-fail do 'unknown'.
		const msg = e instanceof Error ? e.message : String(e);
		logger.warn('[cert-login] Falha inesperada na checagem de revogação', { error: msg });
		return { permitido: true, ocsp: 'unknown', aviso: msg };
	}
}
