/**
 * Gera a hierarquia de certificados de TESTE usada pela suíte E2E do fluxo
 * de assinatura qualificada por Token A3 (e2e/assinatura-qualificada-a3.spec.ts).
 *
 * Artefatos (em ./artefatos/, gitignored, regenerados a cada execução do
 * e2e/servidor-e2e.ts — ANTES do build, que inlina root.pem no trust store):
 *
 *   - root.pem / root.key.pem   — "AC" raiz de teste (autoassinada, CA:TRUE)
 *   - leaf.pem / leaf.key.pem   — "e-CPF" do Policial Fixture A, emitido pela
 *                                  raiz de teste (CN "NOME:CPF" + serialNumber,
 *                                  convenção ICP-Brasil que o servidor extrai)
 *   - outro-cpf.pem / .key.pem  — cert VÁLIDO na cadeia de teste mas de outro
 *                                  titular (prova a checagem CPF token × sessão)
 *   - rogue.pem / rogue.key.pem — cert de CA DESCONHECIDA (autoassinado) com o
 *                                  MESMO CN/CPF do leaf (prova que a cadeia
 *                                  continua sendo exigida com a raiz de teste
 *                                  injetada — só a raiz de teste é confiada)
 *
 * NUNCA use estes certificados fora do ambiente de teste: a raiz só é
 * reconhecida por builds feitos com E2E_TEST_CA=1 (vide vite.config.ts).
 */
import forge from 'node-forge';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'artefatos');

/** Titular do "e-CPF" de teste — precisa bater com a fixture do global-setup. */
export const TITULAR_TESTE = {
	nome: 'Policial Fixture A',
	cpf: '39053344705'
} as const;

export const OUTRO_TITULAR = {
	nome: 'Intruso Fixture B',
	cpf: '52998224725'
} as const;

/** "e-CPF" do supervisor DPC fixture — assina o relatório extraordinário.
 *  Nome/CPF precisam bater com FIXTURE.supervisor do global-setup. */
export const SUPERVISOR_TESTE = {
	nome: 'Supervisor Fixture DPC',
	cpf: '11144477735'
} as const;

type Cert = forge.pki.Certificate;
type KeyPair = forge.pki.rsa.KeyPair;

function novoCert(keys: KeyPair, serial: string): Cert {
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = serial;
	cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
	cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
	return cert;
}

function atributosTitular(t: { nome: string; cpf: string }) {
	return [
		// Convenção e-CPF: CN "NOME:CPF"; o CPF também vai no serialNumber
		// (OID 2.5.4.5) — o servidor extrai de qualquer um dos dois.
		{ name: 'commonName', value: `${t.nome}:${t.cpf}` },
		{ type: '2.5.4.5', value: t.cpf },
		{ name: 'countryName', value: 'BR' },
		{ name: 'organizationName', value: 'E2E TESTE - NAO CONFIAVEL' }
	];
}

function emitirLeaf(
	titular: { nome: string; cpf: string },
	caCert: Cert,
	caKey: forge.pki.PrivateKey
) {
	const keys = forge.pki.rsa.generateKeyPair(2048);
	const cert = novoCert(keys, '02' + forge.util.bytesToHex(forge.random.getBytesSync(8)));
	cert.setSubject(atributosTitular(titular));
	cert.setIssuer(caCert.subject.attributes);
	cert.setExtensions([
		{ name: 'basicConstraints', cA: false, critical: true },
		// keyUsage de assinatura — exigido pela política criptográfica do finalizador.
		{ name: 'keyUsage', digitalSignature: true, nonRepudiation: true, critical: true }
		// SEM authorityInfoAccess de propósito: sem URL OCSP, o finalizador
		// registra status 'unknown' sem sair para a rede (nenhum mock preciso).
	]);
	cert.sign(caKey, forge.md.sha256.create());
	return { cert, keys };
}

export function gerarArtefatos(): void {
	mkdirSync(DIR, { recursive: true });

	// ── Raiz de teste ────────────────────────────────────────────────────
	const rootKeys = forge.pki.rsa.generateKeyPair(2048);
	const root = novoCert(rootKeys, '01' + forge.util.bytesToHex(forge.random.getBytesSync(8)));
	const rootAttrs = [
		{ name: 'commonName', value: 'AC RAIZ DE TESTE E2E - NAO CONFIAVEL' },
		{ name: 'countryName', value: 'BR' },
		{ name: 'organizationName', value: 'E2E TESTE - NAO CONFIAVEL' }
	];
	root.setSubject(rootAttrs);
	root.setIssuer(rootAttrs);
	root.setExtensions([
		{ name: 'basicConstraints', cA: true, critical: true },
		{ name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }
	]);
	root.sign(rootKeys.privateKey, forge.md.sha256.create());

	// ── Leafs ────────────────────────────────────────────────────────────
	const leaf = emitirLeaf(TITULAR_TESTE, root, rootKeys.privateKey);
	const outroCpf = emitirLeaf(OUTRO_TITULAR, root, rootKeys.privateKey);
	const supervisor = emitirLeaf(SUPERVISOR_TESTE, root, rootKeys.privateKey);

	// Rogue: mesma identidade do leaf, mas AUTOASSINADO (CA desconhecida).
	const rogueKeys = forge.pki.rsa.generateKeyPair(2048);
	const rogue = novoCert(rogueKeys, '03' + forge.util.bytesToHex(forge.random.getBytesSync(8)));
	rogue.setSubject(atributosTitular(TITULAR_TESTE));
	rogue.setIssuer(atributosTitular(TITULAR_TESTE));
	rogue.setExtensions([
		{ name: 'basicConstraints', cA: false, critical: true },
		{ name: 'keyUsage', digitalSignature: true, nonRepudiation: true, critical: true }
	]);
	rogue.sign(rogueKeys.privateKey, forge.md.sha256.create());

	const pem = forge.pki.certificateToPem;
	const keyPem = forge.pki.privateKeyToPem;
	writeFileSync(join(DIR, 'root.pem'), pem(root));
	writeFileSync(join(DIR, 'root.key.pem'), keyPem(rootKeys.privateKey));
	writeFileSync(join(DIR, 'leaf.pem'), pem(leaf.cert));
	writeFileSync(join(DIR, 'leaf.key.pem'), keyPem(leaf.keys.privateKey));
	writeFileSync(join(DIR, 'outro-cpf.pem'), pem(outroCpf.cert));
	writeFileSync(join(DIR, 'outro-cpf.key.pem'), keyPem(outroCpf.keys.privateKey));
	writeFileSync(join(DIR, 'supervisor.pem'), pem(supervisor.cert));
	writeFileSync(join(DIR, 'supervisor.key.pem'), keyPem(supervisor.keys.privateKey));
	writeFileSync(join(DIR, 'rogue.pem'), pem(rogue));
	writeFileSync(join(DIR, 'rogue.key.pem'), keyPem(rogueKeys.privateKey));
	console.warn(`[ca-teste] Artefatos de CA de TESTE regenerados em ${DIR}`);
}

// Execução direta: npx tsx e2e/ca-teste/gerar-ca.ts
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	gerarArtefatos();
}
