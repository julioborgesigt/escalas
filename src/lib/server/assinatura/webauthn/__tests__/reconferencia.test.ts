/**
 * Reconferência da asserção guardada no documento.
 *
 * O que este arquivo protege é a razão de as colunas `webauthn_*` existirem:
 * que a afirmação do manifesto ("assinado com chave verificada por biometria")
 * possa ser REFEITA depois. Guardar bytes que ninguém sabe conferir prova
 * tanto quanto não guardar nada.
 *
 * O caso central é o da adulteração: trocar um byte do que foi gravado tem de
 * reprovar. Os demais cobrem as situações que NÃO são falha e que seria fácil
 * tratar como se fossem — documento sem passkey, e credencial revogada depois
 * da assinatura.
 */
import { describe, it, expect } from 'vitest';
import { reconferirAssercaoDocumento } from '../reconferencia';
import { bytesToBase64Url } from '$lib/crypto/bin';

const ORIGEM = 'https://escalas.pc.ce.gov.br';
const RP_ID = 'escalas.pc.ce.gov.br';
/** SHA-256 do PDF assinado — o desafio da cerimônia. */
const HASH_DOC = 'a3'.repeat(32);

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;

function hexParaBytes(hex: string) {
	return Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
}

/** P1363 → DER: a Web Crypto assina em r||s, o aparelho devolve DER. */
function p1363ParaDer(sig: Uint8Array): Uint8Array {
	const inteiro = (bytes: Uint8Array): number[] => {
		let i = 0;
		while (i < bytes.length - 1 && bytes[i] === 0) i++;
		const corpo = Array.from(bytes.slice(i));
		if (corpo[0] & 0x80) corpo.unshift(0x00);
		return [0x02, corpo.length, ...corpo];
	};
	const conteudo = [...inteiro(sig.slice(0, 32)), ...inteiro(sig.slice(32))];
	return new Uint8Array([0x30, conteudo.length, ...conteudo]);
}

/** Monta o que teria sido gravado em `escala_documentos` numa assinatura real. */
async function documentoAssinado(opts: { contadorNaAssinatura?: number } = {}) {
	const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify'
	]);
	const publicKeySpki = new Uint8Array(await crypto.subtle.exportKey('spki', par.publicKey));

	const rpIdHash = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(RP_ID))
	);
	const authenticatorData = new Uint8Array(37);
	authenticatorData.set(rpIdHash, 0);
	authenticatorData[32] = FLAG_UP | FLAG_UV;
	new DataView(authenticatorData.buffer).setUint32(33, opts.contadorNaAssinatura ?? 7, false);

	const clientDataJSON = new TextEncoder().encode(
		JSON.stringify({
			type: 'webauthn.get',
			challenge: bytesToBase64Url(hexParaBytes(HASH_DOC)),
			origin: ORIGEM
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
		documento: {
			webauthn_credential_id: 'Y3JlZC1kZS10ZXN0ZQ',
			webauthn_client_data: bytesToBase64Url(clientDataJSON),
			webauthn_authenticator_data: bytesToBase64Url(authenticatorData),
			webauthn_assinatura: bytesToBase64Url(p1363ParaDer(bruta))
		},
		credencial: { publicKeySpki, revogadaEm: null as string | null }
	};
}

describe('reconferirAssercaoDocumento', () => {
	it('reconfere uma assinatura íntegra', async () => {
		const { documento, credencial } = await documentoAssinado();
		const r = await reconferirAssercaoDocumento(documento, credencial, HASH_DOC, ORIGEM);
		expect(r.situacao).toBe('valida');
	});

	it('não trata documento SEM passkey como falha', async () => {
		// Token A3 e assinatura em tela sem o reforço caem aqui. Reportar
		// "inválida" faria toda a base histórica parecer adulterada.
		const r = await reconferirAssercaoDocumento(
			{
				webauthn_credential_id: null,
				webauthn_client_data: null,
				webauthn_authenticator_data: null,
				webauthn_assinatura: null
			},
			null,
			HASH_DOC,
			ORIGEM
		);
		expect(r.situacao).toBe('sem-passkey');
	});

	it('revogação POSTERIOR não invalida — é ato futuro, e vem como informação', async () => {
		const { documento, credencial } = await documentoAssinado();
		const r = await reconferirAssercaoDocumento(
			documento,
			{ ...credencial, revogadaEm: '2026-09-01T10:00:00.000Z' },
			HASH_DOC,
			ORIGEM
		);
		expect(r.situacao).toBe('valida');
		if (r.situacao !== 'valida') return;
		expect(r.revogadaEm).toBe('2026-09-01T10:00:00.000Z');
	});

	it('reprova se o authenticatorData gravado foi adulterado', async () => {
		const { documento, credencial } = await documentoAssinado();
		const bytes = Array.from(atob(documento.webauthn_authenticator_data.replace(/-/g, '+')));
		bytes[32] = String.fromCharCode(bytes[32].charCodeAt(0) ^ 0x04); // apaga o flag UV
		const adulterado = btoa(bytes.join(''))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');

		const r = await reconferirAssercaoDocumento(
			{ ...documento, webauthn_authenticator_data: adulterado },
			credencial,
			HASH_DOC,
			ORIGEM
		);
		expect(r.situacao).toBe('invalida');
	});

	it('reprova se o documento é OUTRO — é o vínculo com o PDF que importa', async () => {
		const { documento, credencial } = await documentoAssinado();
		const r = await reconferirAssercaoDocumento(documento, credencial, 'b4'.repeat(32), ORIGEM);
		expect(r.situacao).toBe('invalida');
		if (r.situacao !== 'invalida') return;
		expect(r.motivo).toBe('desafio-divergente');
	});

	it('reprova assinatura que não é daquela chave', async () => {
		const { documento } = await documentoAssinado();
		const outra = await documentoAssinado();
		const r = await reconferirAssercaoDocumento(documento, outra.credencial, HASH_DOC, ORIGEM);
		expect(r.situacao).toBe('invalida');
	});

	it('credencial apagada (titular excluído) é situação própria, não "inválida"', async () => {
		const { documento } = await documentoAssinado();
		const r = await reconferirAssercaoDocumento(documento, null, HASH_DOC, ORIGEM);
		expect(r.situacao).toBe('credencial-ausente');
	});

	it('não reprova por contador — ele avançou desde a assinatura', async () => {
		// A credencial hoje está num contador maior. Comparar contra o valor
		// atual reprovaria toda assinatura antiga; a proteção anti-clone é do
		// momento da assinatura, não da reconferência.
		const { documento, credencial } = await documentoAssinado({ contadorNaAssinatura: 3 });
		const r = await reconferirAssercaoDocumento(documento, credencial, HASH_DOC, ORIGEM);
		expect(r.situacao).toBe('valida');
	});
});
