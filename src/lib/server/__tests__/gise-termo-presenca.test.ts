import { describe, it, expect } from 'vitest';
import { gerarTermoPresencaPdf } from '../gise-termo-presenca';

describe('gerarTermoPresencaPdf', () => {
	const base = {
		tipo: 'entrada' as const,
		signerName: 'FULANO DE TAL',
		signerCpf: '12345678901',
		matricula: '99999',
		giseId: 42,
		dataInicio: '2026-06-24',
		unidadeNome: 'DELEGACIA EXEMPLO',
		timestampISO: '2026-06-24T11:00:00.000Z'
	};

	it('gera um PDF válido (%PDF) e devolve a linha de assinatura', async () => {
		const { pdf, signatureLineY } = await gerarTermoPresencaPdf(base);
		expect(pdf.byteLength).toBeGreaterThan(500);
		// Cabeçalho de arquivo PDF.
		expect(String.fromCharCode(...pdf.slice(0, 5))).toBe('%PDF-');
		expect(signatureLineY).toBe(150);
	});

	it('funciona para saída e tolera campos opcionais ausentes', async () => {
		const { pdf } = await gerarTermoPresencaPdf({
			...base,
			tipo: 'saida',
			signerCpf: null,
			matricula: null,
			unidadeNome: null
		});
		expect(pdf.byteLength).toBeGreaterThan(500);
		expect(String.fromCharCode(...pdf.slice(0, 5))).toBe('%PDF-');
	});

	it('não quebra com data em formato inesperado', async () => {
		const { pdf } = await gerarTermoPresencaPdf({ ...base, dataInicio: 'sem-data', timestampISO: 'x' });
		expect(pdf.byteLength).toBeGreaterThan(500);
	});
});
