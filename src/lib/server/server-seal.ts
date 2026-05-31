/**
 * Selo institucional — assinatura eletrônica AVANÇADA (Lei 14.063/2020 art. 4º II).
 *
 * Diferente do fluxo qualificado (token A3 ICP-Brasil do próprio signatário),
 * aqui o SERVIDOR sela o PDF com um certificado da INSTITUIÇÃO, gerado pelo
 * próprio projeto (autoassinado, não-ICP) — modelo análogo ao gov.br/SEI e ao
 * que plataformas comerciais (ZapSign, Clicksign) fazem com o e-CNPJ delas.
 *
 * O que o selo agrega à assinatura em tela:
 *   - o PDF vira um CMS real, AUTOCONTIDO e à prova de adulteração (qualquer
 *     alteração quebra a assinatura — independente do servidor/portal);
 *   - elimina o placeholder PKCS#7 vazio do fluxo antigo;
 *   - carimbo de tempo GRATUITO (RFC 3161, ex.: DigiCert) quando `TSA_URL`
 *     estiver configurado — âncora temporal real, custo zero.
 *
 * O que ele NÃO faz (limite honesto):
 *   - não é ICP-Brasil → o Adobe mostra "validade desconhecida/não confiável"
 *     (a confiança vem da publicação da chave pública + do portal /validar);
 *   - não carrega a presunção do art. 10 §1º da MP 2.200-2 (exclusiva da
 *     qualificada). A força jurídica vem do art. 4º II + aceitação + lastro.
 *
 * Configuração: a chave/cert vão na env `SELO_INSTITUCIONAL_PEM` (base64 do
 * bundle "private key PEM" + "certificate PEM"). Gere com
 * `scripts/gerar-selo-institucional.mjs`. SEM a env, `selarPdfInstitucional`
 * devolve `{ ok: false }` e o chamador degrada para o rodapé honesto.
 */

import forge from 'node-forge';
import { logger } from './logger';
import {
	prepararPdfParaSelo,
	finalizarAssinatura,
	embedCmsBytesNoPlaceholder
} from './pdf-signing-prepare';
import {
	extrairCmsDoPdf,
	parseCms,
	verificarIntegridadePdf,
	verificarAssinaturaCmsAsync,
	verificarTimestampToken
} from './pdf-verification';
import { solicitarCarimboTempo } from './tsa';
import { adicionarTimestampTokenAoCms } from './cms-tst';
import type { TipoCarimoTempo } from './document-utils';

interface SeloInstitucional {
	key: forge.pki.rsa.PrivateKey;
	/** Certificado do selo em DER base64 (formato esperado por finalizarAssinatura). */
	certDerB64: string;
	/** Common Name do certificado, para auditoria/log. */
	cn: string;
}

// Cache por-isolate: evita reparsear o PEM a cada requisição. Invalida quando a
// env muda (rotação de chave) porque a chave do cache é a própria string raw.
let _cache: { raw: string; selo: SeloInstitucional | null } | null = null;

/** Parseia o bundle PEM base64 em chave + cert. Nunca lança — devolve `null` em erro. */
function parseSeloBundle(raw: string): SeloInstitucional | null {
	try {
		const pem = forge.util.decode64(raw.trim());
		const certIdx = pem.indexOf('-----BEGIN CERTIFICATE-----');
		if (certIdx < 0) throw new Error('bundle PEM sem bloco CERTIFICATE');
		const keyPem = pem.slice(0, certIdx).trim();
		const certPem = pem.slice(certIdx).trim();
		const key = forge.pki.privateKeyFromPem(keyPem);
		const cert = forge.pki.certificateFromPem(certPem);
		const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
		const cn = (cert.subject.getField('CN')?.value as string) || 'Selo Institucional';
		logger.info('[selo] Selo institucional carregado', { cn });
		return { key, certDerB64: forge.util.encode64(certDer), cn };
	} catch (e) {
		logger.error(
			'[selo] Falha ao carregar SELO_INSTITUCIONAL_PEM — assinatura cairá para rodapé honesto',
			{ error: e instanceof Error ? e.message : String(e) }
		);
		return null;
	}
}

/**
 * Carrega (e cacheia) o selo institucional a partir da env `SELO_INSTITUCIONAL_PEM`.
 * Devolve `null` quando a env não está setada ou o bundle é inválido — nunca lança.
 */
export function carregarSeloInstitucional(
	env?: Record<string, string | undefined>
): SeloInstitucional | null {
	const raw =
		env?.SELO_INSTITUCIONAL_PEM ??
		(typeof process !== 'undefined' ? process.env?.SELO_INSTITUCIONAL_PEM : undefined);
	if (!raw) return null;
	if (_cache && _cache.raw === raw) return _cache.selo;

	const selo = parseSeloBundle(raw);
	_cache = { raw, selo };
	return selo;
}

/**
 * Tipo de carimbo de tempo que o selo VAI aplicar, previsto a partir da config.
 *
 * O manifesto (página de auditoria) é desenhado ANTES de `selarPdfInstitucional`
 * anexar o TST — então, sem isto, ele mostraria sempre "servidor" mesmo quando o
 * documento final carrega um carimbo RFC 3161. Como o selo só anexa TST quando há
 * chave (`SELO_INSTITUCIONAL_PEM`) E `TSA_URL`, prevemos:
 *   - `tsa_externa` quando ambos estão configurados (DigiCert/FreeTSA = não-ICP);
 *   - `servidor` caso contrário (sem selo ou sem TSA → sem carimbo).
 *
 * Em falha pontual da TSA no momento da assinatura, o selo degrada para sem-TST
 * e o manifesto pode superestimar — a `/validar` (autoritativa) mostra o estado real.
 */
export function tipoCarimboPrevisto(env?: Record<string, string | undefined>): TipoCarimoTempo {
	const tsaUrl =
		env?.TSA_URL ?? (typeof process !== 'undefined' ? process.env?.TSA_URL : undefined);
	const temSelo = !!carregarSeloInstitucional(env);
	return temSelo && !!tsaUrl ? 'tsa_externa' : 'servidor';
}

export interface ResultadoSelo {
	ok: true;
	pdf: Uint8Array;
	tipoCarimboTempo: TipoCarimoTempo;
	cn: string;
}
export interface FalhaSelo {
	ok: false;
	motivo: 'nao_configurado' | 'erro';
}

/**
 * Assina o PDF do fluxo avançado com a chave institucional (RSA PKCS#1 v1.5,
 * SHA-256) e, quando `TSA_URL` estiver configurado, anexa um carimbo de tempo
 * RFC 3161 (best-effort). Tudo é tolerante a falha: qualquer erro devolve
 * `{ ok: false }` para o chamador salvar o PDF com o rodapé honesto.
 *
 * `signerName` é o nome do POLICIAL (vai no campo /Name da assinatura). O ato de
 * vontade dele é evidenciado pelo rodapé/manifesto; o selo atesta a integridade
 * e a custódia institucional.
 */
export async function selarPdfInstitucional(
	pdfBytes: Uint8Array,
	signerName: string,
	options: { env?: Record<string, string | undefined> } = {}
): Promise<ResultadoSelo | FalhaSelo> {
	const selo = carregarSeloInstitucional(options.env);
	if (!selo) return { ok: false, motivo: 'nao_configurado' };

	try {
		const prep = await prepararPdfParaSelo(pdfBytes, signerName);

		// Assina o hash dos SignedAttributes com a chave institucional. forge usa
		// `md.algorithm` + `md.digest().getBytes()` para montar o DigestInfo PKCS#1 —
		// fornecemos o hash já calculado (mesmo contrato do fluxo Web PKI signHash).
		const digestBytes = forge.util.hexToBytes(prep.signedAttrsHashHex);
		const md = {
			algorithm: 'sha256',
			digest: () => forge.util.createBuffer(digestBytes)
		} as unknown as forge.md.MessageDigest;
		const signatureBytes = selo.key.sign(md);

		let signedPdf = await finalizarAssinatura(
			prep.preparedPdf,
			forge.util.encode64(signatureBytes),
			selo.certDerB64,
			prep.messageDigest,
			prep.signingTimeISO
		);

		// Carimbo de tempo GRATUITO (best-effort). Falha aqui NÃO invalida o selo —
		// apenas mantém o tipo 'servidor'. Se o TST não couber no placeholder,
		// embedCmsBytesNoPlaceholder lança e caímos para o selo sem TST.
		let tipoCarimboTempo: TipoCarimoTempo = 'servidor';
		const tsaUrl = options.env?.TSA_URL;
		if (tsaUrl) {
			try {
				const tsa = await solicitarCarimboTempo(signatureBytes, {
					url: tsaUrl,
					username: options.env?.TSA_USERNAME,
					password: options.env?.TSA_PASSWORD
				});
				if (tsa.ok) {
					const extra = extrairCmsDoPdf(signedPdf);
					if (extra) {
						const novoCmsDer = adicionarTimestampTokenAoCms(extra.cmsDer, tsa.tstAsn1);
						signedPdf = embedCmsBytesNoPlaceholder(signedPdf, novoCmsDer);
						tipoCarimboTempo = 'tsa_externa';
					}
				} else {
					logger.warn('[selo] TSA falhou — selo sem carimbo de tempo', {
						url: tsaUrl,
						error: tsa.error
					});
				}
			} catch (e) {
				logger.warn('[selo] Erro ao anexar carimbo de tempo — selo mantido sem TST', {
					error: e instanceof Error ? e.message : String(e)
				});
			}
		}

		return { ok: true, pdf: signedPdf, tipoCarimboTempo, cn: selo.cn };
	} catch (e) {
		logger.error('[selo] Falha ao selar PDF — caindo para rodapé honesto', {
			error: e instanceof Error ? e.message : String(e)
		});
		return { ok: false, motivo: 'erro' };
	}
}

export interface ResultadoVerificacaoSelo {
	/** O PDF contém um CMS (selo) embarcado. */
	presente: boolean;
	/** Integridade do byte-range + assinatura RSA conferem (documento não adulterado). */
	integro: boolean;
	/** O certificado do selo é EXATAMENTE o desta instituição (bate com a env atual). */
	autentico: boolean;
	/** Common Name do certificado que selou. */
	cn?: string;
	/** Momento do carimbo de tempo (ou signingTime do selo). */
	momento?: string;
	tipoCarimboTempo?: TipoCarimoTempo;
}

/**
 * Verifica o selo institucional embarcado num PDF do fluxo avançado (usado pela
 * página /validar). NÃO valida cadeia ICP-Brasil (o selo é autoassinado de
 * propósito) — valida (1) integridade do documento, (2) assinatura RSA do selo
 * e (3) se o certificado bate com o selo configurado neste servidor (autêntico).
 *
 * Documento sem CMS (rodapé honesto puro, sem chave configurada) → `presente:false`.
 */
export async function verificarSeloInstitucional(
	pdfBytes: Uint8Array,
	env?: Record<string, string | undefined>
): Promise<ResultadoVerificacaoSelo> {
	const vazio: ResultadoVerificacaoSelo = { presente: false, integro: false, autentico: false };
	const extra = extrairCmsDoPdf(pdfBytes);
	if (!extra) return vazio;
	const cms = parseCms(extra.cmsDer);
	if (!cms) return vazio;

	const integridade = await verificarIntegridadePdf(extra.bytesAssinados, cms.messageDigest);
	const rsaOk = await verificarAssinaturaCmsAsync(
		cms.certificate,
		cms.sigAlgOid,
		cms.signedAttrsAsSet,
		cms.signatureValue,
		cms.digestAlgOid
	);

	const cn = (cms.certificate.subject.getField('CN')?.value as string) || undefined;

	// Autenticidade: o certificado embarcado é exatamente o selo configurado aqui?
	let autentico = false;
	try {
		const selo = carregarSeloInstitucional(env);
		if (selo) {
			const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cms.certificate)).getBytes();
			autentico = forge.util.encode64(certDer) === selo.certDerB64;
		}
	} catch {
		/* sem selo configurado neste servidor — segue só com integridade */
	}

	// Carimbo de tempo (quando o selo recebeu TST RFC 3161).
	let tipoCarimboTempo: TipoCarimoTempo = 'servidor';
	let momento = cms.signingTimeISO ?? undefined;
	if (cms.timestampToken) {
		try {
			const tst = await verificarTimestampToken(cms.timestampToken, cms.signatureValue);
			if (tst) {
				tipoCarimboTempo = tst.classe === 'icp' ? 'act_icp' : 'tsa_externa';
				momento = tst.momento;
			}
		} catch {
			/* TST inválido — mantém servidor */
		}
	}

	return { presente: true, integro: integridade && rsaOk, autentico, cn, momento, tipoCarimboTempo };
}
