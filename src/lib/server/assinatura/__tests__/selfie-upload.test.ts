import { describe, it, expect, vi } from 'vitest';
import { uploadSelfieDataUri, SELFIE_MAX_BYTES } from '../selfie-upload';

function fakeR2() {
	const put = vi.fn().mockResolvedValue(undefined);
	return {
		put,
		bucket: { put } as { put: typeof put }
	};
}

function jpegBytes(extra = 0): Uint8Array {
	const bytes = new Uint8Array(10 + extra);
	bytes[0] = 0xff;
	bytes[1] = 0xd8;
	bytes[2] = 0xff;
	bytes[3] = 0xe0;
	// resto pode ser zero — só validamos magic bytes
	return bytes;
}

function pngBytes(): Uint8Array {
	return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function toDataUri(bytes: Uint8Array, mime: 'image/jpeg' | 'image/png'): string {
	return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

describe('uploadSelfieDataUri', () => {
	it('aceita JPEG bem-formado e devolve key com UUID', async () => {
		const { bucket, put } = fakeR2();
		const r = await uploadSelfieDataUri(bucket, 'gise/x/y', toDataUri(jpegBytes(), 'image/jpeg'));
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.key).toMatch(/^gise\/x\/y\/[0-9a-f-]{36}\.jpg$/i);
		}
		expect(put).toHaveBeenCalledOnce();
	});

	it('aceita PNG bem-formado', async () => {
		const { bucket } = fakeR2();
		const r = await uploadSelfieDataUri(bucket, 'p', toDataUri(pngBytes(), 'image/png'));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.key).toMatch(/\.png$/);
	});

	it('REJEITA prefixo data: inválido sem chamar R2', async () => {
		const { bucket, put } = fakeR2();
		const r = await uploadSelfieDataUri(bucket, 'p', 'naoeumdatauri');
		expect(r).toEqual({ ok: false, reason: 'formato-invalido' });
		expect(put).not.toHaveBeenCalled();
	});

	it('REJEITA payload com prefixo JPEG mas magic bytes errados (anti-spoof)', async () => {
		const { bucket, put } = fakeR2();
		// Bytes não-JPEG (parece ZIP)
		const fakeZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
		const r = await uploadSelfieDataUri(bucket, 'p', toDataUri(fakeZip, 'image/jpeg'));
		expect(r).toEqual({ ok: false, reason: 'magic-mismatch' });
		expect(put).not.toHaveBeenCalled();
	});

	it('REJEITA selfie acima do limite (5 MB)', async () => {
		const { bucket, put } = fakeR2();
		const huge = new Uint8Array(SELFIE_MAX_BYTES + 100);
		huge[0] = 0xff;
		huge[1] = 0xd8;
		huge[2] = 0xff;
		const r = await uploadSelfieDataUri(bucket, 'p', toDataUri(huge, 'image/jpeg'));
		expect(r).toEqual({ ok: false, reason: 'too-large' });
		expect(put).not.toHaveBeenCalled();
	});

	it('REJEITA payload vazio mesmo com prefixo válido', async () => {
		const { bucket, put } = fakeR2();
		const r = await uploadSelfieDataUri(bucket, 'p', 'data:image/jpeg;base64,');
		expect(r).toEqual({ ok: false, reason: 'too-large' });
		expect(put).not.toHaveBeenCalled();
	});

	it('gera chaves diferentes em chamadas consecutivas', async () => {
		const { bucket } = fakeR2();
		const a = await uploadSelfieDataUri(bucket, 'p', toDataUri(jpegBytes(), 'image/jpeg'));
		const b = await uploadSelfieDataUri(bucket, 'p', toDataUri(jpegBytes(), 'image/jpeg'));
		expect(a.ok && b.ok && a.key !== b.key).toBe(true);
	});
});

describe('ePdf (SEC-17)', () => {
	it('aceita o cabeçalho %PDF e recusa JPEG', async () => {
		const { ePdf } = await import('../selfie-upload');
		expect(ePdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe(true);
		expect(ePdf(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(true);
		expect(ePdf(jpegBytes())).toBe(false);
		expect(ePdf(new Uint8Array([0x25, 0x50]))).toBe(false);
	});
});
