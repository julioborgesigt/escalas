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

const erros: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];

vi.mock('../../../logger', () => ({
	logger: {
		error: (msg: string, ctx?: Record<string, unknown>) => erros.push({ msg, ctx }),
		warn: () => {},
		info: () => {},
		debug: () => {}
	}
}));

async function carregarCom(rootsPem: string, intermediatesPem: string) {
	vi.resetModules();
	erros.length = 0;
	vi.doMock('../roots.pem?raw', () => ({ default: rootsPem }));
	vi.doMock('../intermediates.pem?raw', () => ({ default: intermediatesPem }));
	const mod = await import('../trust-store');
	return { store: mod.loadTrustStore(), erros };
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
