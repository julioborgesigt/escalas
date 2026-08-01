/**
 * Identidade da Política de Assinatura ICP-Brasil (PA-AD-RB v2.3).
 *
 * Fonte ÚNICA compartilhada entre a assinatura (`pdf-signing-prepare`) e a
 * verificação (`pdf-verification`). Mantido deliberadamente SEM dependências
 * pesadas (nada de pdf-lib/node-forge no topo) para não inflar o bundle da
 * rota /validar, que só verifica.
 */

import { logger } from '../logger';

/**
 * OID do atributo `id-aa-ets-sigPolicyId` (RFC 5126 / DOC-ICP-15.03).
 * Aponta para a Política de Assinatura usada — sem este atributo, o
 * Validador ITI marca a assinatura como "Sem política aplicada" mesmo
 * quando todos os outros checks passam.
 */
export const OID_SIG_POLICY_ID = '1.2.840.113549.1.9.16.2.15';

/**
 * OID da PA-AD-RB v2.3 (Política de Assinatura — Assinatura Digital com
 * Referência Básica), definida no DOC-ICP-15.03 da ITI.
 *
 * Esta é a política mínima para assinaturas qualificadas ICP-Brasil sem
 * carimbo de tempo obrigatório embutido. Quando combinada com TSA RFC 3161
 * server-side (TSA_URL), o nível efetivo sobe para AD-RT (com Referência
 * para Tempo).
 *
 * Documento de referência:
 *   https://www.gov.br/iti/pt-br/centrais-de-conteudo/doc-icp-15-03-versao-7-3-pdf
 */
export const OID_PA_AD_RB_V2_3 = '2.16.76.1.7.1.1.2.3';

/**
 * Hash da Política de Assinatura PA-AD-RB v2.3, usado no `sigPolicyHash` do
 * atributo `id-aa-ets-sigPolicyId`.
 *
 * ⚠️ Cuidado — NÃO é o hash do PDF do DOC-ICP-15.03 (engano comum), NEM o
 * hash do arquivo `.der` da política (esse é o que a LPA usa p/ integridade
 * do artefato). Conforme a Nota Técnica 003/2016-CGNP/ITI, o valor que vai na
 * ASSINATURA é o hash INTERNO da própria PA — o campo `signPolicyHash`
 * embutido no artefato `.der`, que equivale a:
 *
 *   SHA-256( DER(signPolicyHashAlg) ‖ DER(signPolicyInfo) )
 *
 * Valor abaixo extraído do artefato oficial e reproduzido:
 *
 *   curl -O http://politicas.icpbrasil.gov.br/PA_AD_RB_v2_3.der
 *   # 3º elemento do SEQUENCE raiz (OCTET STRING, 32 bytes) = signPolicyHash:
 *   openssl asn1parse -inform DER -in PA_AD_RB_v2_3.der | tail -1
 *
 * Num bump de versão da PA, atualize JUNTOS `OID_PA_AD_RB_V2_3` e este hash
 * (ambos mudam). Para sobrescrever em node/staging sem rebuild, defina
 * `PA_AD_RB_HASH_HEX` (vide `resolverHashPolitica`).
 */
export const HASH_PA_AD_RB_V2_3_HEX =
	'b16e88bbf77322a67995b79078778ed3d0ea7c88587b6f6d518b715e8f76a3d5';

/** Placeholder histórico (zeros) — sabidamente inválido; rejeitado abaixo. */
const HASH_PLACEHOLDER_ZEROS = '0'.repeat(64);

/**
 * Resolve o hash da política (lado da ASSINATURA). Prioriza a env
 * `PA_AD_RB_HASH_HEX` (64 hex), mas REJEITA o placeholder histórico de zeros,
 * caindo no valor oficial embutido — assim nunca emitimos um `sigPolicyHash`
 * sabidamente inválido em produção.
 */
export function resolverHashPolitica(): string {
	const env = (typeof process !== 'undefined' && process.env?.PA_AD_RB_HASH_HEX) || '';
	const limpo = env.trim().toLowerCase();
	if (limpo === HASH_PLACEHOLDER_ZEROS) {
		logger.warn(
			'[PDF-SIGN] PA_AD_RB_HASH_HEX = zeros (placeholder) ignorado; usando hash oficial PA-AD-RB v2.3.'
		);
		return HASH_PA_AD_RB_V2_3_HEX;
	}
	if (/^[0-9a-f]{64}$/.test(limpo)) {
		return limpo;
	}
	return HASH_PA_AD_RB_V2_3_HEX;
}

/** Resultado da avaliação da política de assinatura (lado da VERIFICAÇÃO). */
export interface AvaliacaoPolitica {
	/** O atributo `id-aa-ets-sigPolicyId` está presente na assinatura. */
	presente: boolean;
	/** OID == PA-AD-RB v2.3 E sigPolicyHash == hash oficial. */
	conforme: boolean;
	/** OID da política declarada (quando presente). */
	oid?: string;
	/** Nome legível quando conforme (ex.: "PA-AD-RB v2.3"). */
	nome?: string;
}

/**
 * Avalia a política declarada numa assinatura, comparando OID + hash com a
 * PA-AD-RB v2.3 oficial. Informativo: não recomputamos a política, apenas
 * conferimos a referência embutida (o cumprimento PLENO é atestado pelo
 * Validador ITI).
 */
export function avaliarPoliticaAssinatura(oid?: string, hashHex?: string): AvaliacaoPolitica {
	if (!oid) return { presente: false, conforme: false };
	const conforme =
		oid === OID_PA_AD_RB_V2_3 && (hashHex ?? '').toLowerCase() === HASH_PA_AD_RB_V2_3_HEX;
	return { presente: true, conforme, oid, nome: conforme ? 'PA-AD-RB v2.3' : undefined };
}
