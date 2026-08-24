import { describe, it, expect } from 'vitest';
import { nomeProvedorAaguid } from '../aaguid-provedores';

describe('nomeProvedorAaguid', () => {
	it('reconhece AAGUID conhecido, sem hífens', () => {
		expect(nomeProvedorAaguid('ea9b8d664d011d213ce4b6b48cb575d4')).toBe('Google Password Manager');
	});

	it('reconhece AAGUID conhecido com hífens e caixa alta (formato do registro CBOR)', () => {
		expect(nomeProvedorAaguid('DD4EC289-E01D-41C9-BB89-70FA845D4BF2')).toBe(
			'iCloud Keychain (Managed)'
		);
	});

	it('devolve null para AAGUID ausente', () => {
		expect(nomeProvedorAaguid(null)).toBeNull();
	});

	it('devolve null para AAGUID que não está no mapa', () => {
		expect(nomeProvedorAaguid('00000000000000000000000000000000')).toBeNull();
	});
});
