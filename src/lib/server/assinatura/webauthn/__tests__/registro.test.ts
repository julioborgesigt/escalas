/**
 * Cerimônia de registro da credencial.
 *
 * O registro confia na chave que o cliente entrega (`getPublicKey()`), e isso
 * é decisão registrada em `registro.ts`: o adversário deste passo é o próprio
 * titular autenticado. O que estes testes protegem é o resto — que a cerimônia
 * pertença a ESTE desafio e a ESTA origem, e que não nasça uma credencial que
 * a assinatura recusaria depois (algoritmo incompatível, sem UV).
 */
import { describe, it, expect } from 'vitest';
import { verificarRegistro, mensagemRecusaRegistro, ALG_ES256 } from '../registro';
import { bytesToBase64Url } from '$lib/crypto/bin';

const ORIGEM = 'https://escalas.pc.ce.gov.br';
const RP_ID = 'escalas.pc.ce.gov.br';
const DESAFIO = new Uint8Array(32).map((_, i) => (i * 11 + 5) & 0xff);

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_AT = 0x40;

async function spkiP256() {
	const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify'
	]);
	return new Uint8Array(await crypto.subtle.exportKey('spki', par.publicKey));
}

async function authData(flags: number, comAaguid = true) {
	const rpIdHash = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(RP_ID))
	);
	const total = comAaguid ? 37 + 16 : 37;
	const out = new Uint8Array(total);
	out.set(rpIdHash, 0);
	out[32] = flags;
	new DataView(out.buffer).setUint32(33, 0, false);
	if (comAaguid) out.set(new Uint8Array(16).fill(0x2a), 37);
	return out;
}

async function entrada(
	opts: { flags?: number; algoritmo?: number; tipo?: string; origem?: string } = {}
) {
	return {
		clientDataJSON: new TextEncoder().encode(
			JSON.stringify({
				type: opts.tipo ?? 'webauthn.create',
				challenge: bytesToBase64Url(DESAFIO),
				origin: opts.origem ?? ORIGEM
			})
		),
		authenticatorData: await authData(opts.flags ?? FLAG_UP | FLAG_UV | FLAG_BE | FLAG_AT),
		publicKeySpki: await spkiP256(),
		algoritmo: opts.algoritmo ?? ALG_ES256,
		desafioEsperado: DESAFIO,
		origemEsperada: ORIGEM
	};
}

describe('verificarRegistro', () => {
	it('aceita cerimônia íntegra e devolve o que será persistido', async () => {
		const r = await verificarRegistro(await entrada());
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.credencial.aaguid).toBe('2a'.repeat(16));
		expect(r.credencial.backupElegivel).toBe(true);
		expect(r.credencial.contador).toBe(0);
	});

	it('recusa asserção usada como registro', async () => {
		const r = await verificarRegistro(await entrada({ tipo: 'webauthn.get' }));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('tipo-divergente');
	});

	it('recusa origem divergente', async () => {
		const r = await verificarRegistro(await entrada({ origem: 'https://escalas.pages.dev' }));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('origem-divergente');
	});

	it('recusa RS256 no cadastro, e não na hora de assinar', async () => {
		const r = await verificarRegistro(await entrada({ algoritmo: -257 }));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('algoritmo-nao-suportado');
		// A mensagem tem de dizer o que fazer, não só que falhou.
		expect(mensagemRecusaRegistro(r.motivo)).toMatch(/biometria|Face ID|Touch ID/i);
	});

	it('recusa cadastro sem UV — nasceria inutilizável, porque a asserção exige UV', async () => {
		const r = await verificarRegistro(await entrada({ flags: FLAG_UP | FLAG_AT }));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('usuario-nao-verificado');
		expect(mensagemRecusaRegistro(r.motivo)).toMatch(/bloqueio de tela/i);
	});

	it('recusa chave que a Web Crypto não importa como P-256', async () => {
		const r = await verificarRegistro({
			...(await entrada()),
			publicKeySpki: new Uint8Array([1, 2, 3, 4])
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('chave-invalida');
	});

	it('recusa desafio de outra cerimônia', async () => {
		const r = await verificarRegistro({
			...(await entrada()),
			desafioEsperado: new Uint8Array(32).fill(9)
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.motivo).toBe('desafio-divergente');
	});
});
