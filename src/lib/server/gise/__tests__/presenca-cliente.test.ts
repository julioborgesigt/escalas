import { describe, it, expect } from 'vitest';
import { presencasParaCliente } from '../presenca-cliente';

/**
 * O que este teste prende NÃO é o formato do objeto — é a AUSÊNCIA do manifesto
 * forense no que sai para o navegador. Por isso a linha de entrada é a linha
 * completa de `buscarPresencasGise`, com todos os campos que ela realmente
 * traz: um campo novo lá que passe a viajar por descuido reprova aqui.
 */
const LINHA_COMPLETA = {
	id: 7,
	gise_id: 42,
	policial_id: 1234,
	policial_nome: 'MARCOS SANDRO LIRA',
	policial_matricula: '300123-1',
	policial_cpf: '12345678901',
	policial_cargo: 'OIP' as const,
	policial_classe: 'primeira',
	policial_lotacao: '1ª DP de Iguatu',
	entrada_timestamp: '2026-05-17T08:00:00.000Z',
	entrada_selfie_key: 'gise/2026-05/17/1234/entrada/uuid.jpg',
	saida_timestamp: '2026-05-17T20:00:00.000Z',
	saida_selfie_key: 'gise/2026-05/17/1234/saida/uuid.jpg',
	ip_address: '189.4.55.10',
	user_agent: 'Mozilla/5.0 (iPhone)',
	latitude: '-6.3597',
	longitude: '-39.2986'
};

/** Todo campo que NÃO pode chegar ao cliente, nomeado um por um. */
const PROIBIDOS = [
	'policial_cpf',
	'ip_address',
	'user_agent',
	'latitude',
	'longitude',
	'entrada_selfie_key',
	'saida_selfie_key',
	'policial_nome',
	'policial_matricula',
	'policial_cargo',
	'policial_classe',
	'policial_lotacao'
] as const;

describe('presencasParaCliente', () => {
	it('entrega exatamente os três campos que a tela usa', () => {
		const [saida] = presencasParaCliente([LINHA_COMPLETA]);
		expect(Object.keys(saida).sort()).toEqual([
			'entrada_timestamp',
			'policial_id',
			'saida_timestamp'
		]);
		expect(saida).toEqual({
			policial_id: 1234,
			entrada_timestamp: '2026-05-17T08:00:00.000Z',
			saida_timestamp: '2026-05-17T20:00:00.000Z'
		});
	});

	it.each(PROIBIDOS)('não deixa passar %s', (campo) => {
		const [saida] = presencasParaCliente([LINHA_COMPLETA]);
		expect(campo in saida).toBe(false);
	});

	it('preserva o "ainda não confirmou" como null, sem virar undefined', () => {
		const [saida] = presencasParaCliente([
			{ ...LINHA_COMPLETA, entrada_timestamp: null, saida_timestamp: null }
		]);
		expect(saida.entrada_timestamp).toBeNull();
		expect(saida.saida_timestamp).toBeNull();
	});

	it('devolve objetos NOVOS — mutar o recorte não alcança a linha de origem', () => {
		const origem = { ...LINHA_COMPLETA };
		const [saida] = presencasParaCliente([origem]);
		expect(saida).not.toBe(origem);
		saida.entrada_timestamp = null;
		expect(origem.entrada_timestamp).toBe('2026-05-17T08:00:00.000Z');
	});

	it('lista vazia sai vazia, e a de origem não é tocada', () => {
		expect(presencasParaCliente([])).toEqual([]);
	});

	it('recorta TODAS as linhas, não só a primeira', () => {
		const saida = presencasParaCliente([LINHA_COMPLETA, { ...LINHA_COMPLETA, policial_id: 999 }]);
		expect(saida).toHaveLength(2);
		for (const linha of saida) {
			expect('policial_cpf' in linha).toBe(false);
			expect('latitude' in linha).toBe(false);
		}
	});
});
