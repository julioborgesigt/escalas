import { describe, expect, it } from 'vitest';
import { statusColor, statusLabel, statusStrip } from '../formatters';

/** Canais válidos do tema — `info` não existe e some no CSS. */
const CANAIS = /-(primary|secondary|tertiary|success|warning|error|surface)-\d+/;

describe('gise/formatters status visual', () => {
	const statusConhecidos = [
		'em_definicao_supervisor',
		'em_preenchimento',
		'aguardando_assinatura',
		'em_andamento',
		'aguardando_relatorios',
		'aguardando_assinatura_relat',
		'pronta_para_finalizar',
		'finalizada'
	] as const;

	it('rótulo de aguardando_relatorios é Aguardando entradas', () => {
		expect(statusLabel('aguardando_relatorios')).toBe('Aguardando entradas');
	});

	it('chip e faixa usam só canais do tema em todo status conhecido', () => {
		for (const status of statusConhecidos) {
			expect(statusColor(status), `chip ${status}`).toMatch(CANAIS);
			expect(statusStrip(status), `faixa ${status}`).toMatch(CANAIS);
			expect(statusColor(status)).not.toMatch(/-info-/);
			expect(statusStrip(status)).not.toMatch(/-info-/);
		}
	});

	it('Aguardando entradas tem faixa tertiary visível (não transparente)', () => {
		expect(statusStrip('aguardando_relatorios')).toBe('bg-tertiary-500');
		expect(statusColor('aguardando_relatorios')).toContain('tertiary');
	});

	it('cada fase ativa distinta tem canal de faixa diferente (exceto finais surface/success)', () => {
		const faixasAtivas = [
			statusStrip('em_preenchimento'),
			statusStrip('aguardando_assinatura'),
			statusStrip('em_andamento'),
			statusStrip('aguardando_relatorios'),
			statusStrip('aguardando_assinatura_relat')
		];
		expect(new Set(faixasAtivas).size).toBe(faixasAtivas.length);
	});
});
