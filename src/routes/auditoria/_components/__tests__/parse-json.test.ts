/**
 * JSON de metadados/contexto da auditoria: lixo ou vazio vira `null`.
 */
import { describe, it, expect } from 'vitest';
import { parseJson } from '../parse-json';

describe('parseJson', () => {
	it('objeto válido', () => {
		expect(parseJson('{"a":1}')).toEqual({ a: 1 });
	});

	it('null / vazio / lixo → null', () => {
		expect(parseJson(null)).toBeNull();
		expect(parseJson('')).toBeNull();
		expect(parseJson('{')).toBeNull();
	});
});
