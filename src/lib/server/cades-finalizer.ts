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
	verificarAssinaturaRsa,
	verificarCadeiaIcpBrasil,
	verificarIntegridadePdf,
	verificarTimestampToken
} from './pdf-verification';
import { consultarOcsp } from './ocsp';
import { loadTrustStore } from './icp-brasil/trust-store';
import type { AssinaturaCadesMetadata } from '$lib/db/documentos';
import type { TipoCarimoTempo } from './document-utils';

/**
 * Quando `true`, o endpoint REJEITA assinaturas qualificadas sem token TSA
 * RFC 3161 carimbado. Hoje fica em `false` para não quebrar o fluxo Web PKI
 * (Lacuna não emite TSA por padrão); ative via env após confirmar que todos
 * os clientes embarcam timestampToken.
 */
const EXIGIR_TSA_QUALIFICADA = false;

export interface CadesFinalizationResult {
	ok: true;
	metadata: AssinaturaCadesMetadata;
	tipoCarimboTempo: TipoCarimoTempo;
	signerName: string;
	signerCpf: string;
}

export interface CadesFinalizationError {
	ok: false;
	status: number;
	error: string;
}

export async function verificarECarimbarAssinatura(
	signedPdfBytes: Uint8Array
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
	const integridadeOk = await verificarIntegridadePdf(
		extracao.bytesAssinados,
		cms.messageDigest
	);
	if (!integridadeOk) {
		return {
			ok: false,
			status: 422,
			error: 'Hash do conteúdo assinado não confere com o messageDigest do CMS'
		};
	}

	// 3. Assinatura RSA dos SignedAttributes
	const rsaOk = verificarAssinaturaRsa(
		cms.certificate,
		cms.signedAttrsAsSet,
		cms.signatureValue
	);
	if (!rsaOk) {
		return {
			ok: false,
			status: 422,
			error: 'Assinatura RSA dos SignedAttributes inválida'
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
		logger.warn(
			'[CADES] Trust store ICP-Brasil vazio — cadeia não pôde ser validada (assinatura aceita)'
		);
	}

	// 5. Carimbo de tempo qualificado
	let tipoCarimboTempo: TipoCarimoTempo = 'servidor';
	let tstTokenB64: string | undefined;
	if (cms.timestampToken) {
		const tst = verificarTimestampToken(cms.timestampToken, cms.signatureValue);
		if (tst) {
			tipoCarimboTempo = 'act_icp';
			try {
				tstTokenB64 = forge.util.encode64(forge.asn1.toDer(cms.timestampToken).getBytes());
			} catch {
				/* ignore */
			}
		} else {
			return {
				ok: false,
				status: 422,
				error: 'Token TSA presente mas inválido (messageImprint não confere)'
			};
		}
	}
	if (tipoCarimboTempo === 'servidor' && EXIGIR_TSA_QUALIFICADA) {
		return {
			ok: false,
			status: 422,
			error:
				'Assinatura qualificada exige carimbo de tempo ACT/ICP-Brasil (RFC 3161). ' +
				'Habilite a emissão de timestampToken no Assinador antes de finalizar.'
		};
	}

	// 6. OCSP — tenta localizar o issuer para construir o request
	let ocspMetadata: {
		ocsp_response_b64?: string;
		ocsp_consultado_em?: string;
	} = {};
	try {
		const ts = loadTrustStore();
		const issuerCN =
			(cms.certificate.issuer.getField('CN')?.value as string) || '';
		const issuer = [...ts.intermediates, ...ts.roots].find(
			(c) => (c.subject.getField('CN')?.value as string) === issuerCN
		);
		if (issuer) {
			const snap = await consultarOcsp(cms.certificate, issuer);
			ocspMetadata = {
				ocsp_response_b64: snap.responseDerB64 || undefined,
				ocsp_consultado_em: snap.consultadoEm
			};
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

	// 7. Hash SHA-256 do CMS para detecção de adulteração do registro no banco
	const cmsHashBuf = await crypto.subtle.digest(
		'SHA-256',
		extracao.cmsDer as unknown as ArrayBuffer
	);
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

	return {
		ok: true,
		metadata,
		tipoCarimboTempo,
		signerName: cn.split(':')[0].trim(),
		signerCpf: cpf
	};
}
