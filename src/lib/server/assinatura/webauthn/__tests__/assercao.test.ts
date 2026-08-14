/**
 * Verificação da asserção WebAuthn.
 *
 * As asserções são MONTADAS aqui a partir de um par de chaves P-256 gerado no
 * próprio teste, em vez de fixtures capturadas de um aparelho. Duas razões:
 * a asserção real depende de biometria de hardware (não roda em CI), e montar
 * exercita de verdade o caminho DER → IEEE P1363 — o autenticador devolve
 * ECDSA em DER e a Web Crypto assina em `r||s`, então o teste precisa fazer a
 * conversão inversa para simular o aparelho.
 *
 * O caso feliz vale pouco isolado: o que este arquivo protege são as recusas.
 * Uma asserção legítima capturada de outro fluxo continua criptograficamente
 * válida — o que a torna prova DESTE ato são os vínculos (desafio, origem,
 * tipo, UV).
 */
import { describe, it, expect } from 'vitest';
import { verificarAssercao } from '../assercao';
import { lerAuthenticatorData, descreverVinculoCredencial } from '../authenticator-data';
import { bytesToBase64Url } from '$lib/crypto/bin';

const ORIGEM = 'https://escalas.pc.ce.gov.br';
const RP_ID = 'escalas.pc.ce.gov.br';

/** Hash do PDF preparado — é este valor que vira o `challenge`. */
const DESAFIO = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;

async function gerarChaves() {
	const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify'
	]);
	const spki = new Uint8Array(await crypto.subtle.exportKey('spki', par.publicKey));
	return { par, spki };
}

async function montarAuthenticatorData(opts: { flags: number; contador: number }) {
	const rpIdHash = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(RP_ID))
	);
	const out = new Uint8Array(37);
	out.set(rpIdHash, 0);
	out[32] = opts.flags;
	new DataView(out.buffer).setUint32(33, opts.contador, false);
	return out;
}

/** P1363 (`r||s`, o que a Web Crypto assina) → DER, que é o que o aparelho devolve. */
function p1363ParaDer(sig: Uint8Array): Uint8Array {
	const inteiro = (bytes: Uint8Array): number[] => {
		let i = 0;
		while (i < bytes.length - 1 && bytes[i] === 0) i++;
		const corpo = Array.from(bytes.slice(i));
		// Bit alto ligado seria lido como negativo: prefixa 0x00.
		if (corpo[0] & 0x80) corpo.unshift(0x00);
		return [0x02, corpo.length, ...corpo];
	};
	const conteudo = [...inteiro(sig.slice(0, 32)), ...inteiro(sig.slice(32))];
	return new Uint8Array([0x30, conteudo.length, ...conteudo]);
}

async function montarAssercao(
	opts: {
		flags?: number;
		contador?: number;
		tipo?: string;
		desafio?: Uint8Array;
		origem?: string;
	} = {}
) {
	const { par, spki } = await gerarChaves();
	const authenticatorData = await montarAuthenticatorData({
		flags: opts.flags ?? FLAG_UP | FLAG_UV,
		contador: opts.contador ?? 5
	});
	const clientDataJSON = new TextEncoder().encode(
		JSON.stringify({
			type: opts.tipo ?? 'webauthn.get',
			challenge: bytesToBase64Url(opts.desafio ?? DESAFIO),
			origin: opts.origem ?? ORIGEM,
			crossOrigin: false
		})
	);

	const assinado = new Uint8Array(authenticatorData.length + 32);
	assinado.set(authenticatorData, 0);
	assinado.set(
		new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON)),
		authenticatorData.length
	);
	const bruta = new Uint8Array(
		await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, par.privateKey, assinado)
	);

	return {
		clientDataJSON,
		authenticatorData,
		assinatura: p1363ParaDer(bruta),
		publicKeySpki: spki,
		desafioEsperado: DESAFIO,
		origemEsperada: ORIGEM,
		contadorArmazenado: 4
	};
}

describe('lerAuthenticatorData', () => {
	it('lê flags e contador', async () => {
		const dados = lerAuthenticatorData(
			await montarAuthenticatorData({ flags: FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS, contador: 9 })
		);
		expect(dados.usuarioPresente).toBe(true);
		expect(dados.usuarioVerificado).toBe(true);
		expect(dados.backupElegivel).toBe(true);
		expect(dados.backupAtivo).toBe(true);
		expect(dados.contador).toBe(9);
		// Sem o flag AT (registro), não há AAGUID a extrair.
		expect(dados.aaguid).toBeNull();
	});

	it('recusa buffer curto demais', () => {
		expect(() => lerAuthenticatorData(new Uint8Array(10))).toThrow();
	});
});

describe('descreverVinculoCredencial', () => {
	it('só fala em "aparelho" quando a credencial NÃO é sincronizável', () => {
		const local = descreverVinculoCredencial({ backupElegivel: false, backupAtivo: false });
		expect(local).toMatch(/aparelho/);

		// O caso comum em iOS/Android: a frase não pode prometer aparelho.
		const sincronizada = descreverVinculoCredencial({ backupElegivel: true, backupAtivo: true });
		expect(sincronizada).not.toMatch(/\baparelho\b(?!s)/);
		expect(sincronizada).toMatch(/titular/);
	});
});

describe('verificarAssercao', () => {
	it('aceita asserção íntegra e devolve os flags para o manifesto', async () => {
		const r = await verificarAssercao(
			await montarAssercao({ flags: FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS })
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.dados.usuarioVerificado).toBe(true);
		expect(r.dados.backupAtivo).toBe(true);
	});

	it('recusa desafio de OUTRO documento — o vínculo com o PDF é o ponto', async () => {
		const outro = new Uint8Array(32).fill(0xab);
		const r = await verificarAssercao(await montarAssercao({ desafio: outro }));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('desafio-divergente');
	});

	it('recusa cerimônia de REGISTRO usada como assinatura', async () => {
		const r = await verificarAssercao(await montarAssercao({ tipo: 'webauthn.create' }));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('tipo-divergente');
	});

	it('recusa origem divergente (preview, phishing)', async () => {
		const r = await verificarAssercao(
			await montarAssercao({ origem: 'https://escalas.pages.dev' })
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('origem-divergente');
	});

	it('recusa sem verificação do usuário — biometria é o que sustenta o art. 4º II "b"', async () => {
		const r = await verificarAssercao(await montarAssercao({ flags: FLAG_UP }));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('usuario-nao-verificado');
	});

	it('recusa contador regredido (indício de clone)', async () => {
		const r = await verificarAssercao(await montarAssercao({ contador: 3 }));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('contador-regredido');
	});

	it('aceita contador 0 — autenticador que não implementa manda sempre 0', async () => {
		const r = await verificarAssercao(await montarAssercao({ contador: 0 }));
		expect(r.ok).toBe(true);
	});

	it('recusa assinatura de OUTRA chave', async () => {
		const entrada = await montarAssercao();
		const { spki } = await gerarChaves();
		const r = await verificarAssercao({ ...entrada, publicKeySpki: spki });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('assinatura-invalida');
	});

	it('recusa authenticatorData adulterado depois de assinado', async () => {
		const entrada = await montarAssercao();
		const adulterado = new Uint8Array(entrada.authenticatorData);
		adulterado[36] ^= 0xff; // mexe no contador
		const r = await verificarAssercao({ ...entrada, authenticatorData: adulterado });
		expect(r.ok).toBe(false);
	});

	it('recusa clientDataJSON que não é JSON', async () => {
		const entrada = await montarAssercao();
		const r = await verificarAssercao({
			...entrada,
			clientDataJSON: new TextEncoder().encode('não é json')
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('client-data-invalido');
	});
});
