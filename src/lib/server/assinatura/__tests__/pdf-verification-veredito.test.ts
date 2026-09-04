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
 *   - o PDF realmente assinado e as adulterações que quebram UM check cada vêm
 *     de `./selo-fixture`, compartilhada com `cades-finalizer-aceitacao` — que
 *     prende o outro lado da moeda, a decisão de GUARDAR a assinatura;
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
import {
	gerarSelo,
	selarPdfDeTeste,
	montarTrustStore,
	trustStoreVazio,
	ocspRevogadoB64,
	comConteudoAnexado,
	comBitTrocadoNaRegiaoAssinada,
	comAssinaturaCmsCorrompida,
	type TrustStoreFalso
} from './selo-fixture';

/**
 * Preenchido no `beforeAll` com o certificado do selo gerado para esta suíte.
 * O factory do `vi.mock` é içado para o topo do arquivo, então ele lê esta
 * variável de forma preguiçosa, na hora da chamada — nunca no momento do mock.
 */
let trustStoreFalso: TrustStoreFalso | null = null;

vi.mock('../icp-brasil/trust-store', async (importOriginal) => {
	const real = await importOriginal<typeof import('../icp-brasil/trust-store')>();
	return {
		...real,
		loadTrustStore: () => trustStoreFalso ?? real.loadTrustStore()
	};
});

const { verificarAssinaturaCompleta } = await import('../pdf-verification');

let pdfSelado: Uint8Array;
let seloKey: forge.pki.rsa.PrivateKey;
let seloCert: forge.pki.Certificate;

beforeAll(async () => {
	const { bundle, key } = gerarSelo();
	seloKey = key;
	pdfSelado = await selarPdfDeTeste(bundle, 'Documento para veredito');
	trustStoreFalso = await montarTrustStore(pdfSelado);
	seloCert = trustStoreFalso.roots[0];
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
		const adulterado = comConteudoAnexado(pdfSelado);
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
		const adulterado = await comBitTrocadoNaRegiaoAssinada(pdfSelado);
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
		const adulterado = await comAssinaturaCmsCorrompida(pdfSelado);
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
		const fraco = await selarPdfDeTeste(bundle, 'Chave fraca');
		const anterior = trustStoreFalso;
		trustStoreFalso = await montarTrustStore(fraco);
		try {
			const r = await verificarAssinaturaCompleta(fraco);
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
		trustStoreFalso = trustStoreVazio();
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

/**
 * `erros` × `avisos`: a separação que faz o achado APARECER.
 *
 * A página `/validar` listava `v.erros` sob `{#if !v.valid && ...}` — só quando o
 * veredito já era negativo. E TRÊS achados iam para `erros` sem entrar no
 * cálculo de `valid`: token TSA presente mas inválido, co-assinatura corrompida
 * no meio do PDF, e falha ao extrair os metadados do certificado. Resultado: o
 * sistema detectava, registrava, e a tela escondia exatamente nos casos em que o
 * veredito era favorável — que é quando quem confere o papel mais precisa saber.
 *
 * O que se prende aqui é a INVARIANTE, não um cenário: `erros` contém apenas o
 * que reprova. Colocar de novo um achado não-reprovante em `erros` quebra este
 * teste, mesmo que o cenário específico não esteja coberto.
 */
describe('verificarAssinaturaCompleta — erros reprovam, avisos ressalvam', () => {
	it('PDF íntegro: nenhum erro e nenhuma ressalva', async () => {
		const r = await verificarAssinaturaCompleta(pdfSelado);
		expect(r.erros).toEqual([]);
		expect(r.avisos).toEqual([]);
	});

	/** A invariante, sobre TODOS os cenários que a suíte sabe produzir. */
	it('`valid` é falso exatamente quando há erro — em todo cenário', async () => {
		const cenarios: Array<
			[string, () => Promise<Awaited<ReturnType<typeof verificarAssinaturaCompleta>>>]
		> = [
			['íntegro', () => verificarAssinaturaCompleta(pdfSelado)],
			['conteúdo anexado', async () => verificarAssinaturaCompleta(comConteudoAnexado(pdfSelado))],
			[
				'bit trocado na região assinada',
				async () => verificarAssinaturaCompleta(await comBitTrocadoNaRegiaoAssinada(pdfSelado))
			],
			[
				'CMS corrompido',
				async () => verificarAssinaturaCompleta(await comAssinaturaCmsCorrompida(pdfSelado))
			],
			[
				'certificado revogado',
				() =>
					verificarAssinaturaCompleta(pdfSelado, {
						ocspSnapshotB64: ocspRevogadoB64(seloCert, seloKey, seloCert)
					})
			],
			[
				'trust store exigido e vazio',
				() =>
					verificarAssinaturaCompleta(pdfSelado, {
						env: { ICP_BRASIL_TRUST_STORE_REQUIRED: 'true' }
					})
			]
		];

		for (const [nome, executar] of cenarios) {
			const r = await executar();
			expect(r.valid, `${nome}: valid=${r.valid} com erros=${JSON.stringify(r.erros)}`).toBe(
				r.erros.length === 0
			);
		}
	});

	it('o array de ressalvas existe sempre — a tela itera sem guarda de nulo', async () => {
		const r = await verificarAssinaturaCompleta(await comAssinaturaCmsCorrompida(pdfSelado));
		expect(Array.isArray(r.avisos)).toBe(true);
	});

	it('PDF sem assinatura: erro de estrutura, não ressalva', async () => {
		const doc = await PDFDocument.create();
		doc.addPage();
		const r = await verificarAssinaturaCompleta(await doc.save());
		expect(r.valid).toBe(false);
		expect(r.erros.length).toBeGreaterThan(0);
		expect(r.avisos).toEqual([]);
	});
});
