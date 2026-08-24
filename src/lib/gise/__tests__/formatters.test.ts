import { describe, expect, it } from 'vitest';
import { statusColor, statusLabel } from '../formatters';

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

	it('chip usa só canais do tema em todo status conhecido', () => {
		for (const status of statusConhecidos) {
			expect(statusColor(status), `chip ${status}`).toMatch(CANAIS);
			expect(statusColor(status)).not.toMatch(/-info-/);
		}
	});

	it('Aguardando entradas usa tertiary (não um canal inexistente)', () => {
		expect(statusColor('aguardando_relatorios')).toContain('tertiary');
	});

	it('cada fase ativa distinta tem canal de chip diferente (exceto finais surface/success)', () => {
		const chipsAtivos = [
			statusColor('em_preenchimento'),
			statusColor('aguardando_assinatura'),
			statusColor('em_andamento'),
			statusColor('aguardando_relatorios'),
			statusColor('aguardando_assinatura_relat')
		];
		expect(new Set(chipsAtivos).size).toBe(chipsAtivos.length);
	});
});
