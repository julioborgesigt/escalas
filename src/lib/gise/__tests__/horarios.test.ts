import { describe, it, expect } from 'vitest';
import {
	horarioEfetivo,
	mesmaHora,
	temHorarioProprio,
	normalizarHora,
	validarHora,
	seOverlapam
} from '../horarios';

/**
 * A cascata escala → seccional → equipe, e a pergunta que a tela faz dela:
 * "este nível tem horário PRÓPRIO?".
 *
 * O quadro da GISE passou a mostrar só um relógio quando o horário é herdado, e
 * o horário escrito quando é próprio. Isso transforma a comparação numa regra de
 * exibição — que é exatamente o tipo de coisa que não pode viver dentro do
 * `.svelte`.
 */

const ESCALA = { hora_entrada: '08:00', hora_saida: '16:00' };

describe('horarioEfetivo', () => {
	it('usa o nível mais específico que tiver valor', () => {
		expect(horarioEfetivo({ hora_entrada: '07:00', hora_saida: '13:00' }, null, ESCALA)).toEqual({
			entrada: '07:00',
			saida: '13:00'
		});
	});

	it('cai para o nível de cima quando a coluna é nula', () => {
		expect(horarioEfetivo({ hora_entrada: null, hora_saida: null }, null, ESCALA)).toEqual({
			entrada: '08:00',
			saida: '16:00'
		});
	});

	it('resolve entrada e saída SEPARADAMENTE', () => {
		// Equipe que só personalizou a saída continua herdando a entrada.
		expect(horarioEfetivo({ hora_entrada: null, hora_saida: '22:00' }, null, ESCALA)).toEqual({
			entrada: '08:00',
			saida: '22:00'
		});
	});

	it('trata string vazia como AUSENTE', () => {
		// `''` não é personalização: com `??` cru ele venceria a escala e a tela
		// mostraria um traço no lugar da hora.
		expect(horarioEfetivo({ hora_entrada: '', hora_saida: '  ' }, ESCALA)).toEqual({
			entrada: '08:00',
			saida: '16:00'
		});
	});

	it('respeita o nível do meio', () => {
		const seccional = { hora_entrada: '09:00', hora_saida: null };
		expect(horarioEfetivo({ hora_entrada: null, hora_saida: null }, seccional, ESCALA)).toEqual({
			entrada: '09:00',
			saida: '16:00'
		});
	});
});

describe('mesmaHora', () => {
	it('reconhece as duas grafias do mesmo horário', () => {
		// `gise_escalas` nasce '08:00'; a coluna de plantão nasce '08'.
		expect(mesmaHora('08', '08:00')).toBe(true);
		expect(mesmaHora('8:00', '08:00')).toBe(true);
	});

	it('aceita o separador digitado errado', () => {
		expect(mesmaHora('08.30', '08:30')).toBe(true);
	});

	it('distingue horas diferentes', () => {
		expect(mesmaHora('08:00', '08:30')).toBe(false);
	});

	it('compara texto quando o valor não é interpretável', () => {
		expect(mesmaHora('manhã', 'manhã')).toBe(true);
		expect(mesmaHora('manhã', '08:00')).toBe(false);
	});
});

describe('temHorarioProprio', () => {
	it('é falso quando a coluna é nula', () => {
		expect(temHorarioProprio({ hora_entrada: null, hora_saida: null }, ESCALA)).toBe(false);
	});

	it('é falso quando o valor gravado é IGUAL ao herdado', () => {
		// O caso que o selo "H. Personalizado" errava: coluna preenchida, mas com
		// o mesmo horário de cima — não há nada de personalizado ali.
		expect(temHorarioProprio({ hora_entrada: '08:00', hora_saida: '16:00' }, ESCALA)).toBe(false);
		expect(temHorarioProprio({ hora_entrada: '08', hora_saida: '16' }, ESCALA)).toBe(false);
	});

	it('é verdadeiro quando UMA das pontas difere', () => {
		expect(temHorarioProprio({ hora_entrada: '08:00', hora_saida: '13:00' }, ESCALA)).toBe(true);
	});

	it('compara contra a cascata inteira, não só contra a escala', () => {
		const seccional = { hora_entrada: '07:00', hora_saida: '13:00' };
		// A equipe repete o horário da SECCIONAL: herdado, ainda que diferente da escala.
		expect(
			temHorarioProprio({ hora_entrada: '07:00', hora_saida: '13:00' }, seccional, ESCALA)
		).toBe(false);
		// E a seccional, essa sim, tem horário próprio perante a escala.
		expect(temHorarioProprio(seccional, ESCALA)).toBe(true);
	});
});

describe('helpers que já existiam', () => {
	it('normalizarHora troca separador e devolve null para vazio', () => {
		expect(normalizarHora('08.30')).toBe('08:30');
		expect(normalizarHora('')).toBeNull();
	});

	it('validarHora aceita vazio (campo opcional) e recusa lixo', () => {
		expect(validarHora('')).toBe(true);
		expect(validarHora('08:30')).toBe(true);
		expect(validarHora('0830')).toBe(false);
	});

	it('seOverlapam lida com turno que cruza a meia-noite', () => {
		expect(seOverlapam('22:00', '06:00', '05:00', '09:00')).toBe(true);
		expect(seOverlapam('08:00', '12:00', '13:00', '18:00')).toBe(false);
	});
});
