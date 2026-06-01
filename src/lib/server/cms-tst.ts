/**
 * Adiciona um `TimeStampToken` RFC 3161 como `UnsignedAttribute` ao
 * `SignerInfo` de um CMS PKCS#7 já assinado.
 *
 * Esta operação NÃO invalida a assinatura RSA original:
 *   - Os `SignedAttributes` (sobre os quais a RSA foi computada) ficam intactos.
 *   - O `signatureValue` (bytes RSA) fica intacto.
 *   - O TST vai num campo NOVO, `unsignedAttrs`, que é opcional pela RFC 5652.
 *
 * Estrutura do CMS após inserção:
 *
 *   SignerInfo ::= SEQUENCE {
 *     version, sid, digestAlgorithm,
 *     signedAttrs           [0] IMPLICIT,
 *     signatureAlgorithm,
 *     signature             OCTET STRING,
 *     unsignedAttrs         [1] IMPLICIT SET OF Attribute   ← inserido aqui
 *   }
 *
 *   Attribute (id-aa-timeStampToken) ::= SEQUENCE {
 *     attrType   OBJECT IDENTIFIER  (1.2.840.113549.1.9.16.2.14),
 *     attrValues SET OF AttributeValue   (1 valor: o ContentInfo do TST)
 *   }
 *
 * Promove o CMS de **CAdES-BES** para **CAdES-T** (Time-Stamped).
 */

import forge from 'node-forge';

const OID_SIGNATURE_TIME_STAMP_TOKEN = '1.2.840.113549.1.9.16.2.14';

function uint8ToBinaryString(b: Uint8Array): string {
	let s = '';
	for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
	return s;
}

function asn1ToUint8(a: forge.asn1.Asn1): Uint8Array {
	const bin = forge.asn1.toDer(a).getBytes();
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
	return out;
}

/**
 * Constrói o `Attribute` (id-aa-timeStampToken) que será inserido em
 * `unsignedAttrs`.
 */
function montarTstAttribute(tstAsn1: forge.asn1.Asn1): forge.asn1.Asn1 {
	return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.OID,
			false,
			forge.asn1.oidToDer(OID_SIGNATURE_TIME_STAMP_TOKEN).getBytes()
		),
		forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [tstAsn1])
	]);
}

/**
 * Encontra o `SignerInfo` dentro do CMS parseado e devolve o caminho
 * (índices) necessário para reconstruir a árvore alterada.
 *
 * Estrutura esperada:
 *   ContentInfo
 *     [0] OID (id-signedData)
 *     [1] [0] EXPLICIT
 *       [0] SignedData
 *         [0] version
 *         [1] digestAlgorithms
 *         [2] encapContentInfo
 *         [...] certificates? crls? (context-specific [0]/[1])
 *         [N] signerInfos (SET OF SignerInfo)
 *           [0] SignerInfo  ← onde inserimos unsignedAttrs
 */
function localizarSignerInfo(cmsAsn1: forge.asn1.Asn1): {
	signedData: forge.asn1.Asn1;
	signerInfos: forge.asn1.Asn1;
	signerInfo: forge.asn1.Asn1;
} {
	const contentInfoChildren = cmsAsn1.value as forge.asn1.Asn1[];
	const wrap = contentInfoChildren[1];
	const signedData = (wrap.value as forge.asn1.Asn1[])[0];

	// Em SignedData há DOIS SETs universais:
	//   - digestAlgorithms (primeiro)
	//   - signerInfos (último — após cert/crl context-specific)
	// Por isso usamos o *último* SET, não o primeiro.
	let signerInfos: forge.asn1.Asn1 | null = null;
	for (const f of signedData.value as forge.asn1.Asn1[]) {
		if (f.tagClass === forge.asn1.Class.UNIVERSAL && (f.type as number) === forge.asn1.Type.SET) {
			signerInfos = f; // sobrescreve para ficar com o último
		}
	}
	if (!signerInfos) throw new Error('CMS sem signerInfos detectável');

	const signerInfo = (signerInfos.value as forge.asn1.Asn1[])[0];
	if (!signerInfo) throw new Error('signerInfos vazio');

	return { signedData, signerInfos, signerInfo };
}

/**
 * Adiciona o `TimeStampToken` como `UnsignedAttribute` do primeiro
 * `SignerInfo` do CMS.
 *
 * - Se `unsignedAttrs` já existe (caso raro: cliente já anexou outro TST),
 *   acrescentamos o nosso ao SET existente.
 * - Se não existe, criamos `[1] IMPLICIT` com nosso atributo único.
 *
 * Devolve o CMS reconstruído em DER (Uint8Array), pronto para re-embed
 * no placeholder do PDF.
 */
export function adicionarTimestampTokenAoCms(
	cmsDer: Uint8Array,
	tstAsn1: forge.asn1.Asn1
): Uint8Array {
	const cmsAsn1 = forge.asn1.fromDer(forge.util.createBuffer(uint8ToBinaryString(cmsDer)));
	const { signerInfo } = localizarSignerInfo(cmsAsn1);

	const tstAttr = montarTstAttribute(tstAsn1);
	const siChildren = signerInfo.value as forge.asn1.Asn1[];

	// Localiza unsignedAttrs existente: [1] IMPLICIT (context-specific, type 1).
	let unsignedAttrs: forge.asn1.Asn1 | null = null;
	for (const f of siChildren) {
		if (
			f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC &&
			(f.type as number) === 1 &&
			Array.isArray(f.value)
		) {
			unsignedAttrs = f;
			break;
		}
	}

	if (unsignedAttrs) {
		// Já existe — acrescentamos nosso TST como mais um atributo.
		(unsignedAttrs.value as forge.asn1.Asn1[]).push(tstAttr);
	} else {
		// Criamos `[1] IMPLICIT SET OF Attribute` com nosso TST.
		const novo = forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 1, true, [tstAttr]);
		siChildren.push(novo);
	}

	return asn1ToUint8(cmsAsn1);
}
