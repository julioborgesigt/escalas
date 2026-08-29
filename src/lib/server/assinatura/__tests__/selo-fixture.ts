/**
 * Fixture compartilhada dos testes que precisam de um PDF ASSINADO DE VERDADE.
 *
 * Dois testes exercem os dois lados da mesma moeda e precisam do mesmo insumo:
 * `pdf-verification-veredito` (o documento já guardado é autêntico?) e
 * `cades-finalizer-aceitacao` (esta assinatura recém-embarcada entra no
 * acervo?). Os dois só conseguem isolar UM check por vez se todos os outros
 * passarem — e para isso o PDF precisa ter assinatura criptográfica real sobre
 * os bytes reais, não um CMS de mentira.
 *
 * `selarPdfDeTeste` resolve isso com o selo institucional: RSA-2048, keyUsage
 * de assinatura, CMS sobre o byte-range verdadeiro.
 *
 * **O `vi.mock` do trust store NÃO mora aqui, de propósito.** Ele é içado para
 * o topo do arquivo que o declara e não funciona importado de fora; cada teste
 * declara o seu e usa `montarTrustStore` para montar o valor. O que se
 * compartilha é o trabalho, não o mecanismo.
 */

import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';

/** O formato que `loadTrustStore` devolve — o mock de cada teste retorna isto. */
export interface TrustStoreFalso {
	disponivel: boolean;
	roots: forge.pki.Certificate[];
	intermediates: forge.pki.Certificate[];
	caStore: forge.pki.CAStore;
}

/**
 * Bundle base64 (chave + cert) no formato de `SELO_INSTITUCIONAL_PEM`.
 *
 * `cA: true` porque o certificado é autoassinado e serve de âncora da própria
 * cadeia; sem isso `verifyCertificateChain` recusa.
 */
export function gerarSelo(bits = 2048): {
	bundle: string;
	cert: forge.pki.Certificate;
	key: forge.pki.rsa.PrivateKey;
} {
	const keys = forge.pki.rsa.generateKeyPair(bits);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '0a';
	cert.validity.notBefore = new Date(Date.now() - 86_400_000);
	cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 86_400_000);
	const attrs = [
		{ name: 'commonName', value: 'Selo Fixture Teste' },
		{ name: 'organizationName', value: 'Teste' },
		{ name: 'countryName', value: 'BR' }
	];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);
	cert.setExtensions([
		{ name: 'basicConstraints', cA: true },
		{ name: 'keyUsage', digitalSignature: true, nonRepudiation: true, keyCertSign: true }
	]);
	cert.sign(keys.privateKey, forge.md.sha256.create());
	const bundle = forge.util.encode64(
		forge.pki.privateKeyToPem(keys.privateKey).trim() +
			'\n' +
			forge.pki.certificateToPem(cert).trim()
	);
	return { bundle, cert, key: keys.privateKey };
}

/** PDF de uma página, selado com o bundle informado. Lança se o selo falhar. */
export async function selarPdfDeTeste(
	bundle: string,
	texto = 'Documento de teste'
): Promise<Uint8Array> {
	const { selarPdfInstitucional } = await import('../server-seal');
	const doc = await PDFDocument.create();
	doc.addPage([595, 842]).drawText(texto, { x: 50, y: 800, size: 12 });
	const selado = await selarPdfInstitucional(await doc.save(), 'FULANO DE TAL', {
		env: { SELO_INSTITUCIONAL_PEM: bundle }
	});
	if (!selado.ok) throw new Error(`selo falhou: ${selado.motivo}`);
	return selado.pdf;
}

/**
 * Monta o trust store com o certificado extraído do PRÓPRIO PDF.
 *
 * A âncora precisa vir do DER embarcado, não do objeto que assinou: o `caStore`
 * do node-forge indexa por hash do subject, e a cópia parseada é a única que
 * casa com o que a verificação vai consultar. Passar o objeto em memória parece
 * equivalente e não é — a cadeia reprova sem dizer por quê.
 */
export async function montarTrustStore(pdfSelado: Uint8Array): Promise<TrustStoreFalso> {
	const { extrairCmsDoPdf, parseCms } = await import('../pdf-verification');
	const cms = parseCms(extrairCmsDoPdf(pdfSelado)!.cmsDer)!;
	const caStore = forge.pki.createCaStore();
	caStore.addCertificate(cms.certificate);
	return { disponivel: true, roots: [cms.certificate], intermediates: [], caStore };
}

/** Trust store VAZIO — para exercitar o ramo `'indisponivel'`. */
export function trustStoreVazio(): TrustStoreFalso {
	return {
		disponivel: false,
		roots: [],
		intermediates: [],
		caStore: forge.pki.createCaStore()
	};
}

// ── Adulterações ────────────────────────────────────────────────────────────
//
// Cada uma quebra UM check e deixa os outros intactos. É isso que permite
// atribuir a recusa ao termo certo.

const TE = new TextEncoder();

/** Anexa conteúdo após a região assinada: quebra a COBERTURA, não a integridade. */
export function comConteudoAnexado(pdf: Uint8Array): Uint8Array {
	const cauda = TE.encode('\nconteudo injetado\n%%EOF\n');
	const out = new Uint8Array(pdf.length + cauda.length);
	out.set(pdf, 0);
	out.set(cauda, pdf.length);
	return out;
}

/** Vira um bit DENTRO do segundo trecho assinado: quebra a INTEGRIDADE só. */
export async function comBitTrocadoNaRegiaoAssinada(pdf: Uint8Array): Promise<Uint8Array> {
	const { extrairCmsDoPdf } = await import('../pdf-verification');
	const [, , c, d] = extrairCmsDoPdf(pdf)!.byteRange;
	const out = new Uint8Array(pdf);
	const alvo = c + Math.floor(d / 2);
	out[alvo] = out[alvo] ^ 0x01;
	return out;
}

/**
 * Troca um dígito hex do `/Contents`, que mora no GAP não assinado: quebra a
 * ASSINATURA CMS deixando integridade e cobertura de pé.
 *
 * O byte alvo é LOCALIZADO, não estimado. A primeira versão mirava
 * `cmsDer.length - 10` — um chute em "perto do fim, deve ser o signatureValue"
 * — e virou teste intermitente: cada execução gera uma chave nova, os
 * comprimentos DER mudam, e às vezes aquela posição caía no carimbo de tempo
 * anexado depois da assinatura, onde corromper não derruba a verificação RSA.
 * Passava sozinho e falhava na suíte inteira, que é a pior forma de falhar.
 *
 * Agora o `signatureValue` é lido do CMS parseado e procurado no DER, e o bit
 * vira no meio dele.
 */
export async function comAssinaturaCmsCorrompida(pdf: Uint8Array): Promise<Uint8Array> {
	const { extrairCmsDoPdf, parseCms } = await import('../pdf-verification');
	const ex = extrairCmsDoPdf(pdf)!;
	const cms = parseCms(ex.cmsDer)!;

	const assinatura = Uint8Array.from(cms.signatureValue, (ch) => ch.charCodeAt(0) & 0xff);
	const iDer = indiceDaSubsequencia(ex.cmsDer, assinatura);
	if (iDer < 0) throw new Error('signatureValue não localizado no DER do CMS');

	const [a, b] = ex.byteRange;
	const out = new Uint8Array(pdf);
	// Meio do signatureValue: longe dos cabeçalhos de comprimento, então o DER
	// segue parseável e só a matemática da assinatura quebra. Cada byte DER
	// ocupa dois dígitos hex no /Contents, que começa no '<' em `a + b`.
	const posHex = a + b + 1 + (iDer + Math.floor(assinatura.length / 2)) * 2;
	out[posHex] = proximoDigitoHex(out[posHex]);
	return out;
}

/**
 * Devolve OUTRO dígito hex — em VALOR, não em grafia.
 *
 * A versão anterior fazia `'A' → 'B'`, senão `→ 'A'`, e isso deixava o teste
 * intermitente por um motivo silencioso: quando o dígito no lugar era `'a'`
 * minúsculo, ele virava `'A'` — mesmo valor, nenhuma corrupção, assinatura
 * ainda válida. O hex do `/Contents` não tem grafia garantida, então a troca
 * precisa ser aritmética.
 */
function proximoDigitoHex(codigo: number): number {
	const ch = String.fromCharCode(codigo);
	const valor = parseInt(ch, 16);
	if (Number.isNaN(valor)) throw new Error(`byte ${codigo} não é dígito hex`);
	return ((valor + 1) % 16).toString(16).toUpperCase().charCodeAt(0);
}

/** Índice da primeira ocorrência de `agulha` em `palheiro`, ou -1. */
function indiceDaSubsequencia(palheiro: Uint8Array, agulha: Uint8Array): number {
	if (agulha.length === 0 || agulha.length > palheiro.length) return -1;
	for (let i = 0; i <= palheiro.length - agulha.length; i++) {
		let bate = true;
		for (let j = 0; j < agulha.length; j++) {
			if (palheiro[i + j] !== agulha[j]) {
				bate = false;
				break;
			}
		}
		if (bate) return i;
	}
	return -1;
}

/**
 * Monta um OCSPResponse DER dizendo que o certificado está REVOGADO, assinado
 * pela chave do issuer — é o que o snapshot guarda no banco (modelo CAdES-LT).
 *
 * Precisa ser assinado de verdade: `statusDeSnapshot` reconfere a assinatura do
 * responder contra o issuer e, se ela não bater, descarta o status como não
 * confiável. Um snapshot forjado reprovaria pelo caminho errado — e o objetivo
 * aqui é justamente isolar o termo `revogacao !== 'revoked'` do veredito.
 */
export function ocspRevogadoB64(
	cert: forge.pki.Certificate,
	issuerKey: forge.pki.rsa.PrivateKey,
	issuer: forge.pki.Certificate
): string {
	const asn1 = forge.asn1;
	const { Class, Type } = asn1;
	const gt = (d: Date) =>
		d
			.toISOString()
			.replace(/[-:]/g, '')
			.replace(/\.\d{3}/, '');

	const algSha1 = asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, [
		asn1.create(Class.UNIVERSAL, Type.OID, false, asn1.oidToDer('1.3.14.3.2.26').getBytes()),
		asn1.create(Class.UNIVERSAL, Type.NULL, false, '')
	]);
	const nomeDer = asn1.toDer(forge.pki.distinguishedNameToAsn1(issuer.subject)).getBytes();
	const sha1 = (bin: string) => forge.md.sha1.create().update(bin).digest().getBytes();
	const chavePubBin = asn1.toDer(forge.pki.publicKeyToAsn1(issuer.publicKey)).getBytes();

	// CertID ::= SEQUENCE { hashAlgorithm, issuerNameHash, issuerKeyHash, serialNumber }
	const certId = asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, [
		algSha1,
		asn1.create(Class.UNIVERSAL, Type.OCTETSTRING, false, sha1(nomeDer)),
		asn1.create(Class.UNIVERSAL, Type.OCTETSTRING, false, sha1(chavePubBin)),
		asn1.create(
			Class.UNIVERSAL,
			Type.INTEGER,
			false,
			forge.util.hexToBytes(
				cert.serialNumber.length % 2 ? '0' + cert.serialNumber : cert.serialNumber
			)
		)
	]);

	// certStatus revoked = [1] IMPLICIT RevokedInfo { revocationTime GeneralizedTime }
	const revogado = asn1.create(Class.CONTEXT_SPECIFIC, 1, true, [
		asn1.create(Class.UNIVERSAL, Type.GENERALIZEDTIME, false, gt(new Date(Date.now() - 3_600_000)))
	]);

	const single = asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, [
		certId,
		revogado,
		asn1.create(Class.UNIVERSAL, Type.GENERALIZEDTIME, false, gt(new Date()))
	]);

	// ResponseData: responderID [1] EXPLICIT Name, producedAt, responses.
	// A versão (v1) é default e fica implícita — como nos responders reais.
	const tbs = asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, [
		asn1.create(Class.CONTEXT_SPECIFIC, 1, true, [
			forge.pki.distinguishedNameToAsn1(issuer.subject)
		]),
		asn1.create(Class.UNIVERSAL, Type.GENERALIZEDTIME, false, gt(new Date())),
		asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, [single])
	]);

	const tbsDer = asn1.toDer(tbs).getBytes();
	const md = forge.md.sha256.create();
	md.update(tbsDer);
	const assinatura = issuerKey.sign(md);

	const basic = asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, [
		tbs,
		asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, [
			asn1.create(
				Class.UNIVERSAL,
				Type.OID,
				false,
				asn1.oidToDer('1.2.840.113549.1.1.11').getBytes() // sha256WithRSA
			),
			asn1.create(Class.UNIVERSAL, Type.NULL, false, '')
		]),
		asn1.create(Class.UNIVERSAL, Type.BITSTRING, false, '\x00' + assinatura)
	]);

	const resposta = asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, [
		asn1.create(Class.UNIVERSAL, Type.ENUMERATED, false, '\x00'), // successful
		asn1.create(Class.CONTEXT_SPECIFIC, 0, true, [
			asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, [
				asn1.create(
					Class.UNIVERSAL,
					Type.OID,
					false,
					asn1.oidToDer('1.3.6.1.5.5.7.48.1.1').getBytes() // id-pkix-ocsp-basic
				),
				asn1.create(Class.UNIVERSAL, Type.OCTETSTRING, false, asn1.toDer(basic).getBytes())
			])
		])
	]);

	return forge.util.encode64(asn1.toDer(resposta).getBytes());
}
