/**
 * Testes das funções puras de pdf-signing-prepare. Foca em extração de dados
 * do CMS — caminho crítico de assinatura ICP-Brasil. Geração do CMS via
 * node-forge no próprio setup (evita dependência de fixtures binários).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import forge from 'node-forge';
import {
	extrairDadosCertificado,
	formatarDataHora,
	resolverHashPolitica
} from '../pdf-signing-prepare';

/**
 * Gera um CMS PKCS#7 detached signature mínimo, com um certificado cujo CN
 * pode incluir CPF ":12345678901" (estilo ICP-Brasil). Retorna o CMS em base64.
 */
function gerarCmsMinimo(opts: {
	commonName: string;
	serialNumberSubject?: string;
}): string {
	const keys = forge.pki.rsa.generateKeyPair(1024);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '02';
	cert.validity.notBefore = new Date(Date.now() - 86400000);
	cert.validity.notAfter = new Date(Date.now() + 86400000);
	const subj: { name?: string; type?: string; value: string }[] = [
		{ name: 'commonName', value: opts.commonName }
	];
	if (opts.serialNumberSubject) {
		// Em ICP-Brasil o CPF vai no atributo serialNumber do subject.
		subj.push({ type: '2.5.4.5', value: opts.serialNumberSubject });
	}
	cert.setSubject(subj);
	cert.setIssuer(subj);
	cert.sign(keys.privateKey, forge.md.sha256.create());

	const p7 = forge.pkcs7.createSignedData();
	p7.content = forge.util.createBuffer('payload');
	p7.addCertificate(cert);
	p7.addSigner({
		key: keys.privateKey,
		certificate: cert,
		digestAlgorithm: forge.pki.oids.sha256,
		authenticatedAttributes: [
			{ type: forge.pki.oids.contentType, value: forge.pki.oids.data },
			{ type: forge.pki.oids.messageDigest },
			// forge tipa `value` como string mas em runtime aceita Date para signingTime.
			{ type: forge.pki.oids.signingTime, value: new Date() as unknown as string }
		]
	});
	p7.sign({ detached: true });

	const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
	return forge.util.encode64(der);
}

describe('extrairDadosCertificado', () => {
	it('extrai nome e CPF quando CN tem formato "NOME:CPF"', () => {
		const cms = gerarCmsMinimo({ commonName: 'JOÃO DA SILVA:12345678901' });
		const r = extrairDadosCertificado(cms);
		expect(r.nome).toBe('JOÃO DA SILVA');
		expect(r.cpf).toBe('12345678901');
	});

	it('extrai CPF do atributo serialNumber do subject (formato ICP-Brasil)', () => {
		const cms = gerarCmsMinimo({
			commonName: 'MARIA DOS SANTOS',
			serialNumberSubject: '12345678901'
		});
		const r = extrairDadosCertificado(cms);
		expect(r.nome).toBe('MARIA DOS SANTOS');
		expect(r.cpf).toBe('12345678901');
	});

	it('strip de caracteres não-numéricos no CPF', () => {
		const cms = gerarCmsMinimo({
			commonName: 'PEDRO ALVES',
			serialNumberSubject: '123.456.789-01'
		});
		const r = extrairDadosCertificado(cms);
		expect(r.cpf).toBe('12345678901');
	});

	it('quando CPF excede 11 dígitos, pega os últimos 11 (CPF embutido em string maior)', () => {
		const cms = gerarCmsMinimo({
			commonName: 'JOSÉ',
			serialNumberSubject: 'BR-12345678901' // não-dígitos removidos, fica BR + 11 dígitos
		});
		const r = extrairDadosCertificado(cms);
		expect(r.cpf).toBe('12345678901');
	});

	it('CPF vazio se CN não tem ":" e não há serialNumber', () => {
		const cms = gerarCmsMinimo({ commonName: 'ANA APENAS' });
		const r = extrairDadosCertificado(cms);
		expect(r.nome).toBe('ANA APENAS');
		expect(r.cpf).toBe('');
	});

	it('throws com mensagem amigável para base64 inválido', () => {
		expect(() => extrairDadosCertificado('!!!nao-eh-cms!!!')).toThrow(
			/processar o certificado digital/i
		);
	});

	it('throws para base64 válido mas DER que não é PKCS#7', () => {
		// INTEGER mínimo: 02 01 00 → base64
		expect(() => extrairDadosCertificado('AgEA')).toThrow();
	});
});

describe('resolverHashPolitica (sigPolicyHash PA-AD-RB v2.3)', () => {
	// Hash interno do artefato oficial PA_AD_RB_v2_3.der (signPolicyHash):
	// SHA-256(DER(signPolicyHashAlg) ‖ DER(signPolicyInfo)).
	const HASH_OFICIAL = 'b16e88bbf77322a67995b79078778ed3d0ea7c88587b6f6d518b715e8f76a3d5';

	afterEach(() => {
		delete process.env.PA_AD_RB_HASH_HEX;
	});

	it('usa o hash oficial embutido por padrão (sem env)', () => {
		delete process.env.PA_AD_RB_HASH_HEX;
		expect(resolverHashPolitica()).toBe(HASH_OFICIAL);
	});

	it('respeita override válido via env (64 hex, normalizado p/ minúsculas)', () => {
		process.env.PA_AD_RB_HASH_HEX = 'A'.repeat(64);
		expect(resolverHashPolitica()).toBe('a'.repeat(64));
	});

	it('rejeita o placeholder de zeros e cai no hash oficial', () => {
		process.env.PA_AD_RB_HASH_HEX = '0'.repeat(64);
		expect(resolverHashPolitica()).toBe(HASH_OFICIAL);
	});

	it('ignora env malformado (não-hex / tamanho errado)', () => {
		process.env.PA_AD_RB_HASH_HEX = 'nao-eh-hash';
		expect(resolverHashPolitica()).toBe(HASH_OFICIAL);
	});
});

describe('formatarDataHora', () => {
	it('retorna string no formato dd/mm/yy HH:MM', () => {
		const r = formatarDataHora();
		expect(r).toMatch(/^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
	});

	it('é determinístico para uma data fixa (fuso America/Sao_Paulo)', () => {
		// 2026-03-15T12:30:00Z = 2026-03-15T09:30:00 -03:00 (BRT)
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-15T12:30:00Z'));
		expect(formatarDataHora()).toBe('15/03/26 09:30');
		vi.useRealTimers();
	});
});
