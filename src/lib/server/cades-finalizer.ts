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
	// Sempre false no fluxo qualificado: o carimbo server-side foi removido por
	// corromper o CMS do SERPRO (vide nota abaixo). Mantido para os ramos de metadados.
	const tstAplicadoServerSide = false;

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

	// Carimbo de tempo server-side (TSA) é DELIBERADAMENTE ausente no fluxo
	// qualificado. Anexá-lo exigiria re-serializar o CMS (adicionarTimestampTokenAoCms
	// usa forge.asn1.toDer), o que ALTERA os bytes do SignerInfo do SERPRO (BER) e
	// INVALIDA a assinatura — o mesmo motivo pelo qual embedSerproCms embute o CMS
	// SEM re-codificar. O resultado seria um PDF corrompido ("erro ao abrir").
	// Quando tempestividade qualificada for necessária, o carimbo deve ser emitido
	// pelo PRÓPRIO Assinador (ACT no SERPRO desktop): chega como cms.timestampToken
	// e é tratado no caminho (a) acima, sem re-codificar o CMS.

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
	const cmsDerFinal = tstAplicadoServerSide
		? (extrairCmsDoPdf(signedPdfBytes)?.cmsDer ?? extracao.cmsDer)
		: extracao.cmsDer;
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
	let pdfFinal = signedPdfBytes;
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

		if (certsDer.length > 0 || ocspsDer.length > 0) {
			pdfFinal = await aplicarDss(signedPdfBytes, {
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
		pdfFinal = signedPdfBytes;
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
