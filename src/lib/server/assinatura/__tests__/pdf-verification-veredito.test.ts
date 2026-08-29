/**
 * O VEREDITO de `verificarAssinaturaCompleta` — o `valid` que a página pública
 * `/validar/[hash]` transforma em "documento autêntico".
 *
 * Até esta data o módulo tinha ~67% de cobertura vinda dos sub-checks chamados
 * direto (integridade, ByteRange, política), mas o orquestrador que os COMPÕE
 * não era chamado por teste nenhum. Uma varredura de mutação mostrou o preço:
 * apagar `result.checks.cobertura &&` ou `result.checks.revogacao !== 'revoked'`
 * da conjunção final deixava a suíte inteira verde — um PDF com shadow attack,
 * ou assinado por certificado REVOGADO, passaria a ser reportado como válido e
 * nada acusaria.
 *
 * Testar isso exige um PDF que passe em TODOS os checks, para que o único termo
 * em disputa seja o que se quer prender. Daí as duas peças de infraestrutura
 * abaixo:
 *
 *   - `selarPdfInstitucional` produz uma assinatura CMS real sobre os bytes
 *     reais do PDF (RSA-2048, keyUsage de assinatura) — cobre integridade,
 *     assinatura e política criptográfica;
 *   - o trust store é substituído por um que contém o certificado do selo, para
 *     que a cadeia feche. É mock de DEPENDÊNCIA, não do módulo sob teste: a
 *     lógica de `verificarCadeiaIcpBrasil` roda inteira, só a lista de âncoras
 *     muda. Sem isso o certificado autoassinado reprovaria a cadeia e o
 *     `valid: false` do caso adulterado não provaria nada — passaria pelo
 *     motivo errado.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';

/**
 * Preenchido no `beforeAll` com o certificado do selo gerado para esta suíte.
 * O factory do `vi.mock` é içado para o topo do arquivo, então ele lê esta
 * variável de forma preguiçosa, na hora da chamada — nunca no momento do mock.
 */
let trustStoreFalso: {
	disponivel: boolean;
	roots: forge.pki.Certificate[];
	intermediates: forge.pki.Certificate[];
	caStore: forge.pki.CAStore;
} | null = null;

vi.mock('../icp-brasil/trust-store', async (importOriginal) => {
	const real = await importOriginal<typeof import('../icp-brasil/trust-store')>();
	return {
		...real,
		loadTrustStore: () => trustStoreFalso ?? real.loadTrustStore()
	};
});

const { selarPdfInstitucional } = await import('../server-seal');
const { verificarAssinaturaCompleta, extrairCmsDoPdf, parseCms } =
	await import('../pdf-verification');

const TE = new TextEncoder();

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
	const out = new Uint8Array(a.length + b.length);
	out.set(a, 0);
	out.set(b, a.length);
	return out;
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
function ocspRevogadoB64(
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

/** Bundle base64 (chave + cert) no mesmo formato que `SELO_INSTITUCIONAL_PEM`. */
function gerarSelo(bits = 2048): {
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
		{ name: 'commonName', value: 'Selo Veredito Teste' },
		{ name: 'organizationName', value: 'Teste' },
		{ name: 'countryName', value: 'BR' }
	];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);
	cert.setExtensions([
		// cA: true para que o próprio certificado sirva de âncora no caStore —
		// é autoassinado, então ele é a raiz da sua própria cadeia.
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

let pdfSelado: Uint8Array;
let seloKey: forge.pki.rsa.PrivateKey;
let seloCert: forge.pki.Certificate;

beforeAll(async () => {
	const { bundle, key } = gerarSelo();
	seloKey = key;

	const doc = await PDFDocument.create();
	doc.addPage([595, 842]).drawText('Documento para veredito', { x: 50, y: 800, size: 12 });
	const selado = await selarPdfInstitucional(await doc.save(), 'FULANO DE TAL', {
		env: { SELO_INSTITUCIONAL_PEM: bundle }
	});
	if (!selado.ok) throw new Error(`selo falhou: ${selado.motivo}`);
	pdfSelado = selado.pdf;

	// A âncora sai do PRÓPRIO PDF, não do objeto que assinou: o `caStore` do
	// node-forge indexa por hash do subject, e o certificado reconstruído a
	// partir do DER embarcado é o único que casa com o que a verificação vai
	// consultar. Montar a loja com o objeto em memória parece equivalente e não
	// é — a cadeia reprova sem dizer por quê.
	const cms = parseCms(extrairCmsDoPdf(pdfSelado)!.cmsDer)!;
	seloCert = cms.certificate;
	const caStore = forge.pki.createCaStore();
	caStore.addCertificate(cms.certificate);
	trustStoreFalso = {
		disponivel: true,
		roots: [cms.certificate],
		intermediates: [],
		caStore
	};
});

describe('verificarAssinaturaCompleta — a linha de base', () => {
	/**
	 * Este teste é o que dá sentido aos demais: sem um PDF que chegue a
	 * `valid: true`, qualquer `valid: false` adiante seria ambíguo.
	 */
	it('PDF íntegro e com cadeia reconhecida é VÁLIDO', async () => {
		const r = await verificarAssinaturaCompleta(pdfSelado);
		expect(r.erros).toEqual([]);
		expect(r.valid).toBe(true);
		expect(r.checks.integridade).toBe(true);
		expect(r.checks.assinaturaRsa).toBe(true);
		expect(r.checks.cobertura).toBe(true);
		expect(r.checks.cadeiaIcpBrasil).toBe(true);
	});

	/**
	 * Contrato documentado no cabeçalho de `verificarAssinaturaCompleta`:
	 * indisponibilidade de terceiro não é prova de revogação. Sem snapshot OCSP o
	 * status é `unknown` e isso NÃO reprova — só `revoked` reprova.
	 */
	it('sem snapshot OCSP a revogação fica `unknown` e não invalida', async () => {
		const r = await verificarAssinaturaCompleta(pdfSelado);
		expect(r.checks.revogacao).toBe('unknown');
		expect(r.valid).toBe(true);
	});

	/** Carimbo de tempo é reportado, não exigido — a distinção que a tela mostra. */
	it('ausência de carimbo qualificado não invalida a assinatura', async () => {
		const r = await verificarAssinaturaCompleta(pdfSelado);
		expect(r.checks.timestampQualificado).toBe(false);
		expect(r.valid).toBe(true);
	});
});

describe('verificarAssinaturaCompleta — cada termo reprova sozinho', () => {
	/**
	 * O caso que a mutação encontrou desprotegido. Todos os outros checks seguem
	 * verdes (mesma assinatura, mesmo certificado, mesma cadeia) — só a cobertura
	 * cai. Se o termo sair da conjunção, este teste fica vermelho.
	 */
	it('conteúdo anexado após a assinatura invalida, mesmo com o resto íntegro', async () => {
		const adulterado = concat(pdfSelado, TE.encode('\nconteudo injetado\n%%EOF\n'));
		const r = await verificarAssinaturaCompleta(adulterado);

		// A integridade CONTINUA passando: o hash dos trechos declarados bate.
		// É exatamente por isso que a cobertura precisa existir como check próprio.
		expect(r.checks.integridade).toBe(true);
		expect(r.checks.assinaturaRsa).toBe(true);
		expect(r.checks.cobertura).toBe(false);
		expect(r.valid).toBe(false);
		expect(r.erros.join(' ')).toMatch(/não cobre o documento completo/);
	});

	/**
	 * O espelho do caso acima. Lá a integridade passava e só a cobertura caía;
	 * aqui um byte é trocado DENTRO do segundo trecho assinado, então o digest
	 * deixa de bater enquanto a estrutura do /ByteRange, o CMS e a cadeia seguem
	 * intactos. Os dois juntos prendem os dois termos separadamente — nenhum
	 * pode sair da conjunção sem deixar um teste vermelho.
	 */
	it('byte trocado dentro da região assinada invalida, com a cobertura intacta', async () => {
		const [, , c, d] = extrairCmsDoPdf(pdfSelado)!.byteRange;
		const adulterado = new Uint8Array(pdfSelado);
		const alvo = c + Math.floor(d / 2);
		adulterado[alvo] = adulterado[alvo] ^ 0x01; // um bit basta

		const r = await verificarAssinaturaCompleta(adulterado);
		expect(r.checks.cobertura).toBe(true);
		expect(r.checks.assinaturaRsa).toBe(true);
		expect(r.checks.integridade).toBe(false);
		expect(r.valid).toBe(false);
		expect(r.erros.join(' ')).toMatch(/messageDigest/);
	});

	/**
	 * A assinatura do CMS mora no placeholder `/Contents`, que fica no GAP —
	 * região que o /ByteRange deliberadamente não assina. Trocar um dígito hex
	 * ali corrompe a assinatura sem tocar em um único byte assinado: integridade
	 * e cobertura seguem verdes, e só `assinaturaRsa` cai.
	 */
	it('assinatura CMS corrompida invalida, com integridade e cobertura intactas', async () => {
		const ex = extrairCmsDoPdf(pdfSelado)!;
		const [a, b] = ex.byteRange;
		const adulterado = new Uint8Array(pdfSelado);
		// Byte DER perto do fim do CMS: dentro do signatureValue, longe dos
		// cabeçalhos de comprimento — o DER continua parseável.
		const iDer = ex.cmsDer.length - 10;
		const posHex = a + b + 1 + iDer * 2; // '<' está em a+b
		const antes = adulterado[posHex];
		adulterado[posHex] = antes === 0x41 /* 'A' */ ? 0x42 /* 'B' */ : 0x41;

		const r = await verificarAssinaturaCompleta(adulterado);
		expect(r.checks.integridade).toBe(true);
		expect(r.checks.cobertura).toBe(true);
		expect(r.checks.assinaturaRsa).toBe(false);
		expect(r.valid).toBe(false);
	});

	/**
	 * Uma assinatura pode ser matematicamente perfeita e ainda assim não
	 * sustentar não-repúdio. RSA-1024 assina e verifica sem erro nenhum — o que
	 * reprova é a política, e é ela que este caso prende.
	 */
	it('chave RSA abaixo do mínimo invalida, mesmo com assinatura correta', async () => {
		const { bundle } = gerarSelo(1024);
		const doc = await PDFDocument.create();
		doc.addPage([595, 842]).drawText('Chave fraca', { x: 50, y: 800, size: 12 });
		const fraco = await selarPdfInstitucional(await doc.save(), 'FULANO DE TAL', {
			env: { SELO_INSTITUCIONAL_PEM: bundle }
		});
		if (!fraco.ok) throw new Error(`selo falhou: ${fraco.motivo}`);

		const cmsFraco = parseCms(extrairCmsDoPdf(fraco.pdf)!.cmsDer)!;
		const anterior = trustStoreFalso;
		const caStore = forge.pki.createCaStore();
		caStore.addCertificate(cmsFraco.certificate);
		trustStoreFalso = {
			disponivel: true,
			roots: [cmsFraco.certificate],
			intermediates: [],
			caStore
		};
		try {
			const r = await verificarAssinaturaCompleta(fraco.pdf);
			expect(r.checks.integridade).toBe(true);
			expect(r.checks.assinaturaRsa).toBe(true);
			expect(r.checks.cobertura).toBe(true);
			expect(r.checks.cadeiaIcpBrasil).toBe(true);
			expect(r.valid).toBe(false);
			expect(r.erros.join(' ')).toMatch(/1024 bits/);
		} finally {
			trustStoreFalso = anterior;
		}
	});

	/**
	 * O termo que faltava. Documento perfeito, cadeia fechada — e o certificado
	 * revogado depois da assinatura. É o cenário que o snapshot OCSP existe para
	 * capturar, e o único caso em que a revogação reprova (`unknown` não reprova).
	 */
	it('certificado REVOGADO invalida, com todo o resto íntegro', async () => {
		const snapshot = ocspRevogadoB64(seloCert, seloKey, seloCert);
		const r = await verificarAssinaturaCompleta(pdfSelado, { ocspSnapshotB64: snapshot });

		expect(r.checks.integridade).toBe(true);
		expect(r.checks.cobertura).toBe(true);
		expect(r.checks.assinaturaRsa).toBe(true);
		expect(r.checks.cadeiaIcpBrasil).toBe(true);
		expect(r.checks.revogacao).toBe('revoked');
		expect(r.valid).toBe(false);
		expect(r.erros.join(' ')).toMatch(/REVOGADO/);
	});

	/**
	 * O outro lado da revogação: um snapshot cuja assinatura do responder não
	 * confere não pode sustentar NADA — nem "good". Adulterar o status guardado
	 * seria o caminho óbvio para fazer um certificado revogado passar, e o
	 * `ocspNaoConfiavel` é o que fecha isso. Aqui o snapshot diz "revogado" mas
	 * vem com a assinatura corrompida: o veredito reprova, e por este motivo.
	 */
	it('snapshot OCSP com assinatura de responder corrompida não é confiável', async () => {
		const bom = forge.util.decode64(ocspRevogadoB64(seloCert, seloKey, seloCert));
		// Vira um bit no MEIO da resposta: pega a assinatura do responder, que é o
		// último campo do BasicOCSPResponse, sem desmontar a estrutura DER.
		const bytes = Array.from(bom, (ch) => ch.charCodeAt(0));
		bytes[bytes.length - 20] ^= 0x01;
		const ruim = forge.util.encode64(String.fromCharCode(...bytes));

		const r = await verificarAssinaturaCompleta(pdfSelado, { ocspSnapshotB64: ruim });
		expect(r.checks.revogacao).not.toBe('revoked'); // o status foi descartado
		expect(r.valid).toBe(false);
		expect(r.erros.join(' ')).toMatch(/responder OCSP/);
	});

	it('PDF sem assinatura nenhuma não é válido', async () => {
		const doc = await PDFDocument.create();
		doc.addPage([200, 200]);
		const r = await verificarAssinaturaCompleta(await doc.save());
		expect(r.valid).toBe(false);
	});

	/**
	 * A cadeia é o termo que separa "assinatura matematicamente correta" de
	 * "assinatura que a ICP-Brasil reconhece". Com o trust store vazio e
	 * `ICP_BRASIL_TRUST_STORE_REQUIRED` ligado, o mesmo PDF reprova.
	 */
	it('trust store indisponível reprova quando a env exige cadeia', async () => {
		const anterior = trustStoreFalso;
		trustStoreFalso = {
			disponivel: false,
			roots: [],
			intermediates: [],
			caStore: forge.pki.createCaStore()
		};
		try {
			const semExigir = await verificarAssinaturaCompleta(pdfSelado);
			expect(semExigir.checks.cadeiaIcpBrasil).toBe('indisponivel');
			expect(semExigir.valid).toBe(true); // default retrocompatível

			const exigindo = await verificarAssinaturaCompleta(pdfSelado, {
				env: { ICP_BRASIL_TRUST_STORE_REQUIRED: 'true' }
			});
			expect(exigindo.valid).toBe(false);
			expect(exigindo.erros.join(' ')).toMatch(/[Tt]rust store/);
		} finally {
			trustStoreFalso = anterior;
		}
	});
});
