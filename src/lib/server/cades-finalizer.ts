/**
 * Helper compartilhado pelos endpoints `finalizar-assinatura`:
 * verifica criptograficamente a assinatura recém-embarcada, consulta o OCSP
 * e devolve os metadados a persistir junto com o documento (CAdES-LT).
 *
 * Centraliza a lógica que antes estava implícita "confiamos no CMS embutido".
 *
 * Resultado:
 *   - { ok: true, metadata, ... } → endpoint salva e responde 200
 *   - { ok: false, status, error } → endpoint retorna o status HTTP indicado
 */

import forge from 'node-forge';
import { logger } from './logger';
import {
	extrairCmsDoPdf,
	parseCms,
	verificarAssinaturaCmsAsync,
	verificarCadeiaIcpBrasil,
	verificarIntegridadePdf,
	verificarTimestampToken,
	type TstVerificado
} from './pdf-verification';
import { consultarOcsp } from './ocsp';
import { loadTrustStore, trustStoreRequerido } from './icp-brasil/trust-store';
import { aplicarDss } from './pades-lt';
import { solicitarCarimboTempo } from './tsa';
import { adicionarTimestampTokenAoCms } from './cms-tst';
import { embedCmsBytesNoPlaceholder } from './pdf-signing-prepare';
import type { AssinaturaCadesMetadata } from '$lib/db/documentos';
import type { TipoCarimoTempo } from './document-utils';

/**
 * Lê a env `EXIGIR_TSA_QUALIFICADA` com semântica truthy (1/true/yes/on).
 * Quando ligada, o sistema rejeita assinaturas qualificadas que não tenham
 * `TimeStampToken` RFC 3161 — nem do cliente (Web PKI/SERPRO), nem do TSA
 * server-side configurado em `TSA_URL`.
 *
 * Recomendado ligar em produção para garantir tempestividade oponível
 * (DOC-ICP-15 PA-AD-RB v2.3, Decreto 10.278/2020 art. 5º).
 */
export function exigirTsa(env?: Record<string, string | undefined>): boolean {
	const raw =
		env?.EXIGIR_TSA_QUALIFICADA ??
		(typeof process !== 'undefined' ? process.env?.EXIGIR_TSA_QUALIFICADA : undefined);
	if (!raw) return false;
	return /^(1|true|yes|on)$/i.test(raw.trim());
}

/**
 * Rótulo do carimbo a partir do resultado da verificação do TST.
 *
 * `null` (carimbo NÃO verificável) → `'servidor'`: no fluxo de assinatura o TST
 * vem da ferramenta do próprio signatário (sem adversário), então NÃO bloqueamos
 * a finalização por um carimbo que não conseguimos verificar — degradamos o
 * rótulo e seguimos. A porta de rigor é `EXIGIR_TSA_QUALIFICADA` (que só aceita
 * `act_icp`). Na verificação (/validar), ao contrário, um TST inválido é
 * sinalizado como erro.
 */
export function rotuloDoCarimbo(tst: TstVerificado | null): TipoCarimoTempo {
	if (!tst) return 'servidor';
	return tst.classe === 'icp' ? 'act_icp' : 'tsa_externa';
}

export interface CadesFinalizationResult {
	ok: true;
	metadata: AssinaturaCadesMetadata;
	tipoCarimboTempo: TipoCarimoTempo;
	signerName: string;
	signerCpf: string;
	/**
	 * Bytes do PDF final a serem persistidos no R2. Quando possível, é o PDF
	 * com DSS embarcado (PAdES-LT). Em caso de falha no DSS, retorna o PDF
	 * original (CAdES-LT continua válido por meio do snapshot OCSP no banco).
	 */
	pdfFinal: Uint8Array;
	/** Indica se o DSS foi aplicado com sucesso (PAdES-LT auto-contido). */
	padesLt: boolean;
}

export interface CadesFinalizationError {
	ok: false;
	status: number;
	error: string;
}

export async function verificarECarimbarAssinatura(
	signedPdfBytes: Uint8Array,
	options: {
		/** Env do `platform.env` para checar `ICP_BRASIL_TRUST_STORE_REQUIRED`. */
		env?: Record<string, string | undefined>;
	} = {}
): Promise<CadesFinalizationResult | CadesFinalizationError> {
	// 1. Extrair e parsear CMS
	const extracao = extrairCmsDoPdf(signedPdfBytes);
	if (!extracao) {
		return {
			ok: false,
			status: 422,
			error: 'PDF assinado não contém estrutura CMS detectável'
		};
	}
	const cms = parseCms(extracao.cmsDer);
	if (!cms) {
		return {
			ok: false,
			status: 422,
			error: 'Estrutura CMS embarcada está malformada'
		};
	}

	// 2. Integridade do byte-range vs messageDigest
	const integridadeOk = await verificarIntegridadePdf(extracao.bytesAssinados, cms.messageDigest);
	if (!integridadeOk) {
		return {
			ok: false,
			status: 422,
			error: 'Hash do conteúdo assinado não confere com o messageDigest do CMS'
		};
	}

	// 3. Assinatura RSA dos SignedAttributes
	const rsaOk = await verificarAssinaturaCmsAsync(
		cms.certificate,
		cms.sigAlgOid,
		cms.signedAttrsAsSet,
		cms.signatureValue,
		cms.digestAlgOid
	);
	if (!rsaOk) {
		return {
			ok: false,
			status: 422,
			error: 'Assinatura criptográfica dos SignedAttributes inválida (RSA/RSA-PSS/ECDSA)'
		};
	}

	// 4. Cadeia ICP-Brasil
	const cadeia = verificarCadeiaIcpBrasil(cms.certificate);
	if (cadeia === false) {
		return {
			ok: false,
			status: 422,
			error: 'Certificado não encadeia até uma AC Raiz da ICP-Brasil reconhecida'
		};
	}
	if (cadeia === 'indisponivel') {
		// Trust store vazio: a postura depende da env ICP_BRASIL_TRUST_STORE_REQUIRED.
		// Em produção, esta env DEVE estar ligada — sem ela, qualquer certificado
		// auto-assinado passaria pela verificação RSA (que só checa a integridade
		// do CMS) e seria erroneamente classificado como "qualificada ICP-Brasil".
		if (trustStoreRequerido(options.env)) {
			return {
				ok: false,
				status: 422,
				error:
					'Trust store ICP-Brasil não populado neste servidor. ' +
					'Execute src/lib/server/icp-brasil/update-trust-store.sh, ' +
					'comite roots.pem e intermediates.pem, e refaça o deploy.'
			};
		}
		logger.warn(
			'[CADES] Trust store ICP-Brasil vazio — cadeia não pôde ser validada (assinatura aceita). ' +
				'Em produção, defina ICP_BRASIL_TRUST_STORE_REQUIRED=true para fazer disso um hard error.'
		);
	}

	// 5. Carimbo de tempo qualificado — três caminhos:
	//
	//   (a) cliente já anexou TST (SERPRO v4+ com TSA habilitado):
	//       valida o messageImprint e adota como ACT-ICP.
	//
	//   (b) cliente NÃO anexou + env TSA_URL configurada:
	//       solicitamos TST à TSA do operador, reescrevemos o CMS
	//       incluindo o TST como UnsignedAttribute, e re-embedamos
	//       no PDF (promovendo CAdES-BES → CAdES-T).
	//
	//   (c) nenhum dos dois: ficamos com signingTime do servidor.
	//       Em produção, EXIGIR_TSA_QUALIFICADA=true transforma este caso
	//       em erro 422 (sem TST não há tempestividade oponível).
	let tipoCarimboTempo: TipoCarimoTempo = 'servidor';
	let tstTokenB64: string | undefined;
	let tstAplicadoServerSide = false;
	// PDF e CMS "correntes" — atualizados se anexarmos um TST server-side (path b).
	let pdfComTst = signedPdfBytes;
	let cmsDerComTst = extracao.cmsDer;

	if (cms.timestampToken) {
		// (a) — TST veio do cliente. Verifica, classifica e (se não verificável)
		// degrada para 'servidor' SEM bloquear a finalização — vide rotuloDoCarimbo.
		const tst = await verificarTimestampToken(cms.timestampToken, cms.signatureValue);
		tipoCarimboTempo = rotuloDoCarimbo(tst);
		if (tst) {
			try {
				tstTokenB64 = forge.util.encode64(forge.asn1.toDer(cms.timestampToken).getBytes());
			} catch {
				/* ignore */
			}
		} else {
			logger.warn(
				'[CADES] TST do cliente não verificável — rebaixado para servidor (sem bloquear).'
			);
		}
	}

	// (b) Sem TST do cliente + `TSA_URL` configurada: solicitamos um carimbo de tempo
	// RFC 3161 (ex.: DigiCert grátis) e o anexamos como UnsignedAttribute, promovendo
	// CAdES-BES → CAdES-T. É BEST-EFFORT: qualquer falha (rede, TSA fora, placeholder
	// cheio) mantém a assinatura SEM TST — nunca a quebra.
	//
	// Por que é seguro (verificado em PDF real do token, e-CPF SERPRO):
	//   - O TST vive DENTRO do /Contents (no gap do ByteRange) — não altera os bytes
	//     assinados nem adiciona revisão pós-assinatura. Logo NÃO dispara o "documento
	//     modificado" do Adobe (diferente do DSS), e o ByteRange continua idêntico.
	//   - adicionarTimestampTokenAoCms só ACRESCENTA unsignedAttrs; a assinatura RSA é
	//     sobre os signedAttrs (intactos). Testado: forge round-trip do CMS do SERPRO é
	//     byte-idêntico e integridade + RSA continuam válidos após o re-embed.
	//
	// Observação jurídica: DigiCert/FreeTSA NÃO são ACT credenciada ICP-Brasil, então
	// isto é 'tsa_externa' (atestação de tempo de terceiro confiável, não carimbo
	// qualificado). Ainda assim é muito superior ao relógio do signatário.
	const tsaUrl = options.env?.TSA_URL;
	if (!cms.timestampToken && tsaUrl) {
		try {
			const tsa = await solicitarCarimboTempo(cms.signatureValue, {
				url: tsaUrl,
				username: options.env?.TSA_USERNAME,
				password: options.env?.TSA_PASSWORD
			});
			if (tsa.ok) {
				const novoCmsDer = adicionarTimestampTokenAoCms(extracao.cmsDer, tsa.tstAsn1);
				pdfComTst = embedCmsBytesNoPlaceholder(signedPdfBytes, novoCmsDer);
				cmsDerComTst = novoCmsDer;
				tstAplicadoServerSide = true;
				tipoCarimboTempo = 'tsa_externa';
				try {
					tstTokenB64 = forge.util.encode64(forge.asn1.toDer(tsa.tstAsn1).getBytes());
				} catch {
					/* metadado opcional */
				}
			} else {
				logger.warn('[CADES] TSA falhou — assinatura mantida sem carimbo de tempo', {
					url: tsaUrl,
					error: tsa.error
				});
			}
		} catch (e) {
			logger.warn('[CADES] Erro ao anexar carimbo de tempo — assinatura mantida sem TST', {
				error: e instanceof Error ? e.message : String(e)
			});
		}
	}

	if (tipoCarimboTempo !== 'act_icp' && exigirTsa(options.env)) {
		return {
			ok: false,
			status: 422,
			error:
				'Assinatura qualificada exige carimbo de tempo de ACT credenciada ICP-Brasil (RFC 3161). ' +
				(tipoCarimboTempo === 'tsa_externa'
					? 'O carimbo presente é de uma TSA externa não-ICP (ex.: DigiCert), que não confere tempestividade oponível a terceiros. '
					: 'A assinatura tem apenas o horário do servidor. ') +
				'Aponte TSA_URL para uma ACT ICP-Brasil, ou habilite a emissão de ' +
				'timestampToken por ACT no Assinador desktop antes de finalizar.'
		};
	}
	if (tstAplicadoServerSide) {
		logger.info('[CADES] TST anexado server-side via TSA', {
			url: options.env?.TSA_URL
		});
	}

	// 6. OCSP — tenta localizar o issuer para construir o request.
	//
	// TODO(crl-fallback): hoje só consultamos OCSP. CAdES-LT também aceita
	// CRL como fonte de revogação (ETSI EN 319 122-1 §6.3.4). Toda AC ICP-Brasil
	// publica OCSP, então a falta de fallback CRL não bloqueia validação na
	// prática. Implementar quando aparecer cert ICP-Brasil sem OCSP no AIA
	// — exigirá download/parse/verify de CRL (~1-5 MB por AC) e cache local
	// das CRLs ativas. Por ora, em ausência de OCSP devolvemos status='unknown'
	// e o cades-finalizer aceita (rejeita só 'revoked'); o validador da UI
	// destaca "OCSP indisponível".
	let ocspMetadata: {
		ocsp_response_b64?: string;
		ocsp_consultado_em?: string;
	} = {};
	let issuerCertParaDss: forge.pki.Certificate | null = null;
	let ocspDerParaDss: Uint8Array | null = null;
	try {
		const ts = loadTrustStore();
		const issuerCN = (cms.certificate.issuer.getField('CN')?.value as string) || '';
		const issuer = [...ts.intermediates, ...ts.roots].find(
			(c) => (c.subject.getField('CN')?.value as string) === issuerCN
		);
		if (issuer) {
			issuerCertParaDss = issuer;
			const snap = await consultarOcsp(cms.certificate, issuer);
			ocspMetadata = {
				ocsp_response_b64: snap.responseDerB64 || undefined,
				ocsp_consultado_em: snap.consultadoEm
			};
			if (snap.responseDerB64) {
				try {
					const der = forge.util.decode64(snap.responseDerB64);
					ocspDerParaDss = new Uint8Array(der.length);
					for (let i = 0; i < der.length; i++) {
						ocspDerParaDss[i] = der.charCodeAt(i) & 0xff;
					}
				} catch {
					/* ignore */
				}
			}
			if (snap.status === 'revoked') {
				return {
					ok: false,
					status: 422,
					error:
						'Certificado REVOGADO segundo o responder OCSP da AC' +
						(snap.revokedAt ? ` (revogado em ${snap.revokedAt})` : '')
				};
			}
		} else if (ts.disponivel) {
			logger.warn('[CADES] Issuer não encontrado no trust store — OCSP pulado', {
				issuerCN
			});
		}
	} catch (e) {
		logger.warn('[CADES] Falha ao consultar OCSP', {
			error: e instanceof Error ? e.message : String(e)
		});
	}

	// 7. Hash SHA-256 do CMS para detecção de adulteração do registro no banco.
	// Quando aplicamos TST server-side, reextraímos o CMS do PDF atualizado
	// para que o hash reflita o conteúdo final (com UnsignedAttribute TST).
	// Quando anexamos TST server-side, o hash precisa refletir o CMS final (com o
	// UnsignedAttribute TST) — já o temos em memória em `cmsDerComTst`.
	const cmsDerFinal = cmsDerComTst;
	const cmsHashBuf = await crypto.subtle.digest('SHA-256', cmsDerFinal as unknown as ArrayBuffer);
	const cmsSha256 = Array.from(new Uint8Array(cmsHashBuf))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

	// 8. Metadados do certificado
	const cn = (cms.certificate.subject.getField('CN')?.value as string) || '';
	let cpf = '';
	const sn = cms.certificate.subject.getField('serialNumber');
	if (sn) cpf = String(sn.value).replace(/\D/g, '');
	if (!cpf && cn.includes(':')) {
		cpf = cn.split(':').pop()?.replace(/\D/g, '') || '';
	}
	if (cpf.length > 11) cpf = cpf.slice(-11);

	const metadata: AssinaturaCadesMetadata = {
		cert_issuer: (cms.certificate.issuer.getField('CN')?.value as string) || undefined,
		cert_serial: cms.certificate.serialNumber,
		cert_valido_de: cms.certificate.validity.notBefore.toISOString(),
		cert_valido_ate: cms.certificate.validity.notAfter.toISOString(),
		cms_sha256: cmsSha256,
		ocsp_response_b64: ocspMetadata.ocsp_response_b64,
		ocsp_consultado_em: ocspMetadata.ocsp_consultado_em,
		tst_token_b64: tstTokenB64
	};

	// 9. PAdES-LT: embarcar DSS (cadeia + OCSP) no PDF.
	// Falha de DSS NÃO invalida a assinatura — CAdES-LT no banco é fallback.
	// Partimos do PDF corrente (já com TST, se anexado no path b).
	let pdfFinal = pdfComTst;
	let padesLt = false;
	try {
		const certsDer: Uint8Array[] = [];
		// Adiciona o issuer (intermediário da AC) se identificado.
		if (issuerCertParaDss) {
			const der = forge.asn1.toDer(forge.pki.certificateToAsn1(issuerCertParaDss)).getBytes();
			const arr = new Uint8Array(der.length);
			for (let i = 0; i < der.length; i++) arr[i] = der.charCodeAt(i) & 0xff;
			certsDer.push(arr);
		}
		// Adiciona raiz se trust store disponível e o issuer não é raiz.
		if (issuerCertParaDss) {
			const ts = loadTrustStore();
			const rootMatch = ts.roots.find(
				(r) =>
					(r.subject.getField('CN')?.value as string) ===
					(issuerCertParaDss!.issuer.getField('CN')?.value as string)
			);
			if (rootMatch && rootMatch !== issuerCertParaDss) {
				const der = forge.asn1.toDer(forge.pki.certificateToAsn1(rootMatch)).getBytes();
				const arr = new Uint8Array(der.length);
				for (let i = 0; i < der.length; i++) arr[i] = der.charCodeAt(i) & 0xff;
				certsDer.push(arr);
			}
		}

		const ocspsDer = ocspDerParaDss ? [ocspDerParaDss] : [];

		// PAdES-LT (DSS via incremental update) DESABILITADO por padrão.
		//
		// A correção de colisão de número de objeto (pades-lt.ts deriva o próximo número
		// do /Size REAL + auto-verificação) eliminou o "erro 43": o incremental update
		// agora é estruturalmente válido (qpdf limpo). PORÉM o Adobe ainda marca a
		// assinatura como INVÁLIDA quando o DSS é anexado.
		//
		// Causa: nossas assinaturas usam SubFilter `adbe.pkcs7.detached` (Adobe legado),
		// não `ETSI.CAdES.detached` (PAdES). O Adobe NÃO reconhece um DSS anexado a uma
		// assinatura de aprovação legada como LTV — ele enxerga a revisão pós-assinatura
		// como MODIFICAÇÃO do documento e invalida a assinatura (verificado em PDF real:
		// cripto íntegra — messageDigest e RSA conferem — mas Adobe diz "inválida").
		//
		// A validade jurídica NÃO depende do DSS: a assinatura é qualificada ICP-Brasil
		// (e-CPF A3) e a página /validar valida server-side com o snapshot OCSP do banco.
		// O DSS só agregaria LTV self-contained no Adobe — o que, neste tipo de assinatura,
		// sai pela culatra. Reabilitar só após migrar para PAdES (ETSI.CAdES.detached) e
		// validar no Adobe. Opt-in: EMBED_PADES_LT_DSS=1/true/on.
		const dssHabilitado = /^(1|true|yes|on)$/i.test(
			(options.env?.EMBED_PADES_LT_DSS ?? '').trim()
		);
		if (dssHabilitado && (certsDer.length > 0 || ocspsDer.length > 0)) {
			pdfFinal = await aplicarDss(pdfComTst, {
				certs: certsDer,
				ocsps: ocspsDer,
				crls: []
			});
			padesLt = true;
		}
	} catch (e) {
		logger.warn('[CADES] Falha ao aplicar DSS — PDF salvo sem PAdES-LT', {
			error: e instanceof Error ? e.message : String(e)
		});
		pdfFinal = pdfComTst;
		padesLt = false;
	}

	return {
		ok: true,
		metadata,
		tipoCarimboTempo,
		signerName: cn.split(':')[0].trim(),
		signerCpf: cpf,
		pdfFinal,
		padesLt
	};
}
