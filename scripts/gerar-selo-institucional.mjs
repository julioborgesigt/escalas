/**
 * Gera o par de chaves + certificado AUTOASSINADO do "selo institucional"
 * (assinatura eletrônica avançada, Lei 14.063/2020 — custo zero, sem ICP-Brasil).
 *
 * Uso:
 *   node scripts/gerar-selo-institucional.mjs ["CN do selo"] ["Organização"]
 *
 * Exemplo:
 *   node scripts/gerar-selo-institucional.mjs "Sistema de Escalas - PCCE" "Policia Civil do Ceara"
 *
 * Saída:
 *   - selo-institucional.key.pem   (CHAVE PRIVADA — NÃO COMITAR, guardar em cofre)
 *   - selo-institucional.cert.pem  (certificado público — pode publicar p/ verificação)
 *   - imprime o valor base64 a colar na env/secret SELO_INSTITUCIONAL_PEM
 *
 * Rotação: rode de novo quando quiser trocar a chave (validade padrão: 10 anos).
 * PDFs antigos continuam verificáveis pelo certificado público correspondente.
 */

import forge from 'node-forge';
import { writeFileSync } from 'node:fs';

const CN = process.argv[2] || 'Sistema de Escalas - PCCE';
const O = process.argv[3] || 'Policia Civil do Ceara';
const ANOS_VALIDADE = 10;

console.log(`\nGerando selo institucional...\n  CN: ${CN}\n  O : ${O}\n  Validade: ${ANOS_VALIDADE} anos\n`);

// 1) Par de chaves RSA-2048 (compatível com o CMS PKCS#1 v1.5 / SHA-256 do projeto).
const keys = forge.pki.rsa.generateKeyPair(2048);

// 2) Certificado autoassinado.
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '00' + forge.util.bytesToHex(forge.random.getBytesSync(16));
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + ANOS_VALIDADE);

const attrs = [
	{ name: 'commonName', value: CN },
	{ name: 'organizationName', value: O },
	{ name: 'countryName', value: 'BR' }
];
cert.setSubject(attrs);
cert.setIssuer(attrs); // autoassinado: subject == issuer
cert.setExtensions([
	{ name: 'basicConstraints', cA: false },
	{ name: 'keyUsage', digitalSignature: true, nonRepudiation: true }
]);
cert.sign(keys.privateKey, forge.md.sha256.create());

// 3) PEMs + bundle base64 para a env.
const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
const certPem = forge.pki.certificateToPem(cert);
const bundleB64 = forge.util.encode64(keyPem.trim() + '\n' + certPem.trim());

// 4) Fingerprint SHA-256 do certificado (para publicar/conferir).
const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
const fp = forge.md.sha256.create();
fp.update(certDer);
const fingerprint = fp
	.digest()
	.toHex()
	.replace(/(.{2})/g, '$1:')
	.replace(/:$/, '')
	.toUpperCase();

writeFileSync('selo-institucional.key.pem', keyPem);
writeFileSync('selo-institucional.cert.pem', certPem);

console.log('Arquivos gravados:');
console.log('  selo-institucional.key.pem   (CHAVE PRIVADA — NUNCA comitar; guardar em cofre)');
console.log('  selo-institucional.cert.pem  (certificado PUBLICO — pode ser versionado no repo)\n');
console.log('Fingerprint SHA-256 do certificado (publique para conferência de terceiros):');
console.log('  ' + fingerprint + '\n');
console.log('====================================================================');
console.log('Configure a env/secret SELO_INSTITUCIONAL_PEM com o valor base64 abaixo:');
console.log('  Cloudflare Pages: Settings > Environment variables (Production)');
console.log('  Wrangler (Workers): npx wrangler secret put SELO_INSTITUCIONAL_PEM');
console.log('====================================================================\n');
console.log(bundleB64);
console.log('\n(Sem essa env, o sistema assina com o rodape honesto — sem o selo.)\n');
