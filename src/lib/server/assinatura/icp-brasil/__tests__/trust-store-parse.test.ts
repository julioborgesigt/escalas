/**
 * Bloco PEM que não parseia tem de FALAR.
 *
 * O descarte era silencioso, e o sintoma não aparece no trust store: aparece no
 * `/validar` como "Certificado não encadeia até uma AC Raiz da ICP-Brasil
 * reconhecida" — o sistema acusando de inválido um documento autêntico, porque a
 * âncora dele sumiu do store sem que nada tenha sido dito. São 182 blocos hoje e
 * um cron mensal que regrava os dois arquivos.
 *
 * O cache é de módulo, então cada caso precisa de `resetModules` + import
 * dinâmico; e os PEM entram por `?raw`, então são mockados por caminho.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';

/** Um certificado autoassinado de verdade, para o caso "tudo parseia". */
function pemValido(): string {
	const keys = forge.pki.rsa.generateKeyPair(512);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '01';
	cert.validity.notBefore = new Date(Date.now() - 86_400_000);
	cert.validity.notAfter = new Date(Date.now() + 86_400_000);
	const attrs = [{ name: 'commonName', value: 'AC Teste' }];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);
	cert.sign(keys.privateKey);
	return forge.pki.certificateToPem(cert);
}

/** Casca de PEM com base64 que não é certificado — passa o regex, falha o parse. */
const PEM_CORROMPIDO =
	'-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydGlmaWNhdGUgYXQgYWxs\n-----END CERTIFICATE-----';

/**
 * AC intermediária ICP-Brasil REAL com chave Ed448 — o caso que existe em
 * produção (5 blocos, incluindo as raízes v6 e v7). Cert público de AC.
 */
const PEM_ED448 = readFileSync(
	fileURLToPath(new URL('./fixtures/ac-ed448-icp.pem', import.meta.url)),
	'utf8'
).match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)![0];

const erros: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
const avisos: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];

vi.mock('../../../logger', () => ({
	logger: {
		error: (msg: string, ctx?: Record<string, unknown>) => erros.push({ msg, ctx }),
		warn: (msg: string, ctx?: Record<string, unknown>) => avisos.push({ msg, ctx }),
		info: () => {},
		debug: () => {}
	}
}));

async function carregarCom(rootsPem: string, intermediatesPem: string) {
	vi.resetModules();
	erros.length = 0;
	avisos.length = 0;
	vi.doMock('../roots.pem?raw', () => ({ default: rootsPem }));
	vi.doMock('../intermediates.pem?raw', () => ({ default: intermediatesPem }));
	const mod = await import('../trust-store');
	return { store: mod.loadTrustStore(), erros, avisos };
}

describe('loadTrustStore — descarte de PEM não é silencioso', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('tudo parseia: nenhum erro registrado', async () => {
		const bom = pemValido();
		const { store, erros: e } = await carregarCom(bom, bom);
		expect(store.disponivel).toBe(true);
		expect(store.roots).toHaveLength(1);
		expect(e).toHaveLength(0);
	});

	it('raiz corrompida registra erro com as CONTAGENS (lidos × válidos)', async () => {
		const { store, erros: e } = await carregarCom(pemValido() + '\n' + PEM_CORROMPIDO, '');
		// O store segue utilizável com a raiz boa — a degradação é parcial, e é
		// isso que a torna difícil de notar sem o log.
		expect(store.disponivel).toBe(true);
		expect(store.roots).toHaveLength(1);
		expect(e).toHaveLength(1);
		expect(e[0].msg).toMatch(/PEM não parseou/);
		expect(e[0].ctx).toMatchObject({ rootsLidos: 2, rootsValidos: 1 });
	});

	it('intermediária corrompida também registra — é a maioria dos 182 blocos', async () => {
		const { erros: e } = await carregarCom(pemValido(), PEM_CORROMPIDO);
		expect(e).toHaveLength(1);
		expect(e[0].ctx).toMatchObject({ intermediariasLidas: 1, intermediariasValidas: 0 });
	});

	it('store VAZIO não é erro de parse — é ausência, e tem tratamento próprio', async () => {
		const { store, erros: e } = await carregarCom('', '');
		expect(store.disponivel).toBe(false);
		expect(e).toHaveLength(0);
	});

	it('lixo que nem parece PEM é ignorado sem erro — não passa o regex de bloco', async () => {
		const { store, erros: e } = await carregarCom('# só um comentário\n', 'nada aqui');
		expect(store.disponivel).toBe(false);
		expect(e).toHaveLength(0);
	});
});

/**
 * A calibragem: limitação CONHECIDA do node-forge × corrupção de verdade.
 *
 * O trust store real tem HOJE 5 blocos que o forge não lê — chaves Ed448, entre
 * elas as raízes v6 e v7 —, todos no ramo de metrologia da ICP-Brasil. Se isso
 * saísse como `error` a cada boot de isolate, viraria alarme permanente e
 * benigno; e um `error` que sempre foi benigno é um `error` que ninguém lê mais,
 * justamente no dia em que o bloco truncado do cron chegar junto.
 */
describe('loadTrustStore — chave não suportada não é o mesmo que corrupção', () => {
	it('chave EdDSA/EC vira AVISO, não erro', async () => {
		const { erros: e, avisos: a } = await carregarCom(pemValido() + '\n' + PEM_ED448, '');
		expect(e).toHaveLength(0);
		expect(a).toHaveLength(1);
		expect(a[0].msg).toMatch(/não-RSA|EdDSA/i);
		expect(a[0].ctx?.motivos).toEqual([expect.stringMatching(/OID is not RSA/i)]);
	});

	it('base64 corrompido vira ERRO — é o cenário do cron', async () => {
		const { erros: e, avisos: a } = await carregarCom(pemValido() + '\n' + PEM_CORROMPIDO, '');
		expect(a).toHaveLength(0);
		expect(e).toHaveLength(1);
		expect(e[0].msg).toMatch(/não parseou/);
	});

	it('os dois juntos: a corrupção manda, e o erro sai', async () => {
		const { erros: e, avisos: a } = await carregarCom(
			pemValido() + '\n' + PEM_ED448 + '\n' + PEM_CORROMPIDO,
			''
		);
		expect(a).toHaveLength(0);
		expect(e).toHaveLength(1);
		// Os DOIS motivos vão no contexto: esconder um deles ao reportar o outro
		// deixaria o operador consertando metade do problema.
		expect((e[0].ctx?.motivos as string[]).length).toBe(2);
	});
});
