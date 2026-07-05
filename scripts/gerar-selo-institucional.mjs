/**
 * Gera o par de chaves do SELO INSTITUCIONAL (assinatura avançada, custo zero)
 * consumido por `src/lib/server/server-seal.ts` via env `SELO_INSTITUCIONAL_PEM`.
 *
 * Uso:
 *   node scripts/gerar-selo-institucional.mjs "CN do selo" "Organizacao" [anos]
 *   node scripts/gerar-selo-institucional.mjs "Sistema de Escalas - PCCE" "Policia Civil do Ceara"
 *
 * Saídas:
 *   - selo-institucional.key.pem  (chave privada — GITIGNORED, guardar em cofre)
 *   - selo-institucional.cert.pem (certificado público — versionado p/ conferência)
 *   - stdout: bundle base64 (key PEM + cert PEM) pronto para
 *       wrangler secret put SELO_INSTITUCIONAL_PEM
 *
 * Parâmetros espelham o certificado em produção: RSA 2048, autoassinado,
 * X.509 v3, validade 10 anos, keyUsage digitalSignature + nonRepudiation,
 * CA:FALSE. O formato do bundle (key primeiro, cert depois) é o que
 * `parseSeloBundle` espera — NÃO inverta a ordem.
 *
 * SEGURANÇA: se os arquivos de saída já existirem o script ABORTA (trocar a
 * chave = trocar a identidade do selo; PDFs antigos seguem verificáveis pelo
 * cert público antigo, mas você nunca re-gera a MESMA chave). Use --force
 * apenas se a troca de identidade for intencional e documentada.
 */

import { writeFileSync, existsSync } from 'node:fs';
import forge from 'node-forge';

const KEY_FILE = 'selo-institucional.key.pem';
const CERT_FILE = 'selo-institucional.cert.pem';

const args = process.argv.slice(2).filter((a) => a !== '--force');
const force = process.argv.includes('--force');
const cn = args[0] || 'Sistema de Escalas - PCCE';
const org = args[1] || 'Policia Civil do Ceara';
const anos = Number(args[2]) || 10;

if (!force) {
	for (const f of [KEY_FILE, CERT_FILE]) {
		if (existsSync(f)) {
			console.error(
				`ABORTADO: ${f} já existe. Gerar um novo par TROCA a identidade do selo.\n` +
					'Se for intencional, rode novamente com --force e atualize o secret\n' +
					'SELO_INSTITUCIONAL_PEM + o cert público versionado no mesmo PR.'
			);
			process.exit(1);
		}
	}
}

console.error(`Gerando RSA 2048 para CN="${cn}", O="${org}", validade ${anos} anos...`);
const keys = forge.pki.rsa.generateKeyPair(2048);

const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
// Serial aleatório positivo (16 bytes, primeiro nibble zerado para não ficar negativo).
cert.serialNumber = '00' + forge.util.bytesToHex(forge.random.getBytesSync(15));
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + anos);

const attrs = [
	{ shortName: 'CN', value: cn },
	{ shortName: 'O', value: org },
	{ shortName: 'C', value: 'BR' }
];
cert.setSubject(attrs);
cert.setIssuer(attrs); // autoassinado
cert.setExtensions([
	{ name: 'basicConstraints', cA: false },
	{ name: 'keyUsage', digitalSignature: true, nonRepudiation: true }
]);
cert.sign(keys.privateKey, forge.md.sha256.create());

const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
const certPem = forge.pki.certificateToPem(cert);

writeFileSync(KEY_FILE, keyPem, { mode: 0o600 });
writeFileSync(CERT_FILE, certPem);
console.error(`OK: ${KEY_FILE} (privada, NÃO comitar) e ${CERT_FILE} (pública) gravados.`);
console.error('');
console.error('Bundle base64 para o secret (stdout abaixo — não deixe em histórico de shell):');
console.error('  wrangler secret put SELO_INSTITUCIONAL_PEM');
console.error('');

// Ordem exigida por parseSeloBundle: chave privada primeiro, certificado depois.
process.stdout.write(forge.util.encode64(keyPem + '\n' + certPem) + '\n');
