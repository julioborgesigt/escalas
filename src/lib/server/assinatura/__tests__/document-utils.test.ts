import { describe, it, expect } from 'vitest';
import { resolverTipoCarimboTempo } from '../document-utils';

/**
 * Os quatro `preparar-assinatura` (escala, GISE, presença, relatório de
 * seccional) decidiam `tsa_externa` × `servidor` com o mesmo ternário
 * copiado, incluindo um cast `as unknown as Record<...>` desnecessário.
 * Trava a decisão num só lugar.
 */
describe('resolverTipoCarimboTempo', () => {
	it('usa tsa_externa quando TSA_URL está configurada', () => {
		const platform = { env: { TSA_URL: 'https://tsa.example.com' } } as App.Platform;
		expect(resolverTipoCarimboTempo(platform)).toBe('tsa_externa');
	});

	it('usa servidor quando TSA_URL está ausente', () => {
		const platform = { env: {} } as App.Platform;
		expect(resolverTipoCarimboTempo(platform)).toBe('servidor');
	});

	it('usa servidor quando platform é undefined', () => {
		expect(resolverTipoCarimboTempo(undefined)).toBe('servidor');
	});
});
