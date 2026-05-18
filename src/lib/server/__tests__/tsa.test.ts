/**
 * Testes do cliente TSA RFC 3161. Não exercita roundtrip de rede real
 * (fetch mockado); foca em construção do request DER e parse da resposta.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import forge from 'node-forge';
import { solicitarCarimboTempo } from '../tsa';

const OID_SHA256 = '2.16.840.1.101.3.4.2.1';

/**
 * Constrói um TimeStampResp DER mínimo válido para o parser:
 *   SEQUENCE { status=0, timeStampToken (ContentInfo) }
 */
function gerarRespostaSuccessful(): Uint8Array {
	// timeStampToken: ContentInfo dummy (id-signedData + payload mínimo)
	const tst = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
		forge.asn1.create(
			forge.asn1.Class.UNIVERSAL,
			forge.asn1.Type.OID,
			false,
			forge.asn1.oidToDer('1.2.840.113549.1.7.2').getBytes()
		),
		forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
			forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [])
		])
	]);

	const pkiStatusInfo = forge.asn1.create(
		forge.asn1.Class.UNIVERSAL,
		forge.asn1.Type.SEQUENCE,
		true,
		[
			// status = 0 (granted)
			forge.asn1.create(
				forge.asn1.Class.UNIVERSAL,
				forge.asn1.Type.INTEGER,
				false,
				String.fromCharCode(0)
			)
		]
	);

	const top = forge.asn1.create(
		forge.asn1.Class.UNIVERSAL,
		forge.asn1.Type.SEQUENCE,
		true,
		[pkiStatusInfo, tst]
	);
	const bin = forge.asn1.toDer(top).getBytes();
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
	return out;
}

/** Resposta com status=2 (rejected). */
function gerarRespostaRejected(): Uint8Array {
	const pkiStatusInfo = forge.asn1.create(
		forge.asn1.Class.UNIVERSAL,
		forge.asn1.Type.SEQUENCE,
		true,
		[
			forge.asn1.create(
				forge.asn1.Class.UNIVERSAL,
				forge.asn1.Type.INTEGER,
				false,
				String.fromCharCode(2)
			)
		]
	);
	const top = forge.asn1.create(
		forge.asn1.Class.UNIVERSAL,
		forge.asn1.Type.SEQUENCE,
		true,
		[pkiStatusInfo]
	);
	const bin = forge.asn1.toDer(top).getBytes();
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
	return out;
}

describe('solicitarCarimboTempo', () => {
	beforeEach(() => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(gerarRespostaSuccessful() as unknown as BodyInit, { status: 200 })
			)
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('devolve ok:true com tstDer e tstAsn1 quando responder responde 200 + status=0', async () => {
		const res = await solicitarCarimboTempo('signature-bytes', { url: 'http://tsa.example.com' });
		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.tstDer.length).toBeGreaterThan(0);
			expect(res.tstAsn1.tagClass).toBe(forge.asn1.Class.UNIVERSAL);
		}
	});

	it('envia body como application/timestamp-query', async () => {
		const fetchSpy = vi.fn(
			async () => new Response(gerarRespostaSuccessful() as unknown as BodyInit, { status: 200 })
		);
		vi.stubGlobal('fetch', fetchSpy);

		await solicitarCarimboTempo('signature-bytes', { url: 'http://tsa.example.com' });

		expect(fetchSpy).toHaveBeenCalledOnce();
		const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
		expect(call[1]).toMatchObject({
			method: 'POST',
			headers: expect.objectContaining({
				'Content-Type': 'application/timestamp-query'
			})
		});
	});

	it('inclui basic auth quando username+password fornecidos', async () => {
		const fetchSpy = vi.fn(
			async () => new Response(gerarRespostaSuccessful() as unknown as BodyInit, { status: 200 })
		);
		vi.stubGlobal('fetch', fetchSpy);

		await solicitarCarimboTempo('sig', {
			url: 'http://tsa.example.com',
			username: 'alice',
			password: 'secret'
		});

		const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
		const sentHeaders = call[1].headers as Record<string, string>;
		expect(sentHeaders.Authorization).toBe(`Basic ${btoa('alice:secret')}`);
	});

	it('devolve ok:false em HTTP não-200', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })));
		const res = await solicitarCarimboTempo('sig', { url: 'http://tsa.example.com' });
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toContain('403');
	});

	it('devolve ok:false quando responder retorna PKIStatus rejeitado', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(gerarRespostaRejected() as unknown as BodyInit, { status: 200 }))
		);
		const res = await solicitarCarimboTempo('sig', { url: 'http://tsa.example.com' });
		expect(res.ok).toBe(false);
	});

	it('NÃO lança em erro de rede — devolve ok:false', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
		const res = await solicitarCarimboTempo('sig', { url: 'http://tsa.example.com' });
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toContain('network down');
	});

	it('o messageImprint do request usa SHA-256 do signatureValue', async () => {
		let capturedBody: ArrayBuffer | null = null;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url, init) => {
				capturedBody = init.body;
				return new Response(gerarRespostaSuccessful() as unknown as BodyInit, { status: 200 });
			})
		);

		await solicitarCarimboTempo('hello', { url: 'http://tsa.example.com' });

		expect(capturedBody).not.toBeNull();
		const bytes = new Uint8Array(capturedBody!);
		let bin = '';
		for (const b of bytes) bin += String.fromCharCode(b);
		const req = forge.asn1.fromDer(forge.util.createBuffer(bin));

		// TimeStampReq[1] = messageImprint
		const messageImprint = (req.value as forge.asn1.Asn1[])[1];
		const algSeq = (messageImprint.value as forge.asn1.Asn1[])[0];
		const oidBytes = (algSeq.value as forge.asn1.Asn1[])[0].value as string;
		expect(forge.asn1.derToOid(oidBytes)).toBe(OID_SHA256);

		const md = forge.md.sha256.create();
		md.update('hello');
		const expectedHash = md.digest().getBytes();
		const actualHash = (messageImprint.value as forge.asn1.Asn1[])[1].value as string;
		expect(actualHash).toBe(expectedHash);
	});
});
