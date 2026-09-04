/**
 * `lerPapelAdministrativo` — a lista fechada dos papéis, conferida em runtime.
 *
 * O que ela substitui: `formData.get('papel')?.toString() || null as
 * 'admin_seccional' | 'admin_unidade' | null`. O `as` é cast de TypeScript e
 * não existe depois do build, então `papel=qualquer_coisa` atravessava até a
 * coluna de RBAC — `motivoParaRecusarPapel`, que roda logo depois, só confere a
 * UNIDADE, e devolve `null` para papel desconhecido porque a única regra de
 * papel que ela tem é sobre `admin_seccional`.
 *
 * Sendo preciso: NÃO era escalada de privilégio. Todo consumidor compara por
 * igualdade estrita contra os dois nomes, então papel desconhecido não concede
 * nada. Era integridade — a coluna aceitava valor que o sistema não entende,
 * com histórico e auditoria dizendo "papel alterado para <lixo>".
 */

import { describe, it, expect } from 'vitest';
import { lerPapelAdministrativo, PAPEIS_ADMINISTRATIVOS } from '../policial-permissao';

describe('lerPapelAdministrativo', () => {
	it('aceita os papéis que existem', () => {
		for (const p of PAPEIS_ADMINISTRATIVOS) {
			expect(lerPapelAdministrativo(p), p).toBe(p);
		}
	});

	it('vazio é `null` — "sem papel" é escolha legítima, não erro', () => {
		// É assim que se REMOVE o papel de alguém: o `<select>` manda vazio.
		// Tratar isso como inválido tornaria a remoção impossível pela tela.
		expect(lerPapelAdministrativo('')).toBeNull();
		expect(lerPapelAdministrativo('   ')).toBeNull();
		expect(lerPapelAdministrativo(null)).toBeNull();
		expect(lerPapelAdministrativo(undefined)).toBeNull();
	});

	it('papel desconhecido é `undefined` — e a action recusa', () => {
		// `null` e `undefined` são respostas DIFERENTES de propósito: uma é
		// "sem papel", a outra é "isto não é papel".
		expect(lerPapelAdministrativo('super_admin')).toBeUndefined();
		expect(lerPapelAdministrativo('admin_geral')).toBeUndefined();
		expect(lerPapelAdministrativo('qualquer_coisa')).toBeUndefined();
	});

	it('não cai em variação de caixa nem em espaço interno', () => {
		expect(lerPapelAdministrativo('ADMIN_UNIDADE')).toBeUndefined();
		expect(lerPapelAdministrativo('Admin_Unidade')).toBeUndefined();
		expect(lerPapelAdministrativo('admin unidade')).toBeUndefined();
	});

	it('apara espaço em volta, que é o que um POST pode trazer', () => {
		expect(lerPapelAdministrativo('  admin_unidade  ')).toBe('admin_unidade');
	});

	it('valor que não é string é `undefined`, não erro', () => {
		// `FormData.get` devolve `File` quando o campo é um upload; a leitura não
		// pode lançar por causa disso.
		expect(lerPapelAdministrativo(42)).toBeUndefined();
		expect(lerPapelAdministrativo({})).toBeUndefined();
		expect(lerPapelAdministrativo(['admin_unidade'])).toBeUndefined();
	});

	it('a lista fechada tem exatamente os dois papéis do sistema', () => {
		// Se alguém acrescentar um papel, este teste força a decisão de conferir
		// os consumidores (`escalas/permissao.ts`, `gise/permissao.ts`,
		// `sync-estado.ts`, `useAutorizacao`) em vez de só ampliar a lista.
		expect([...PAPEIS_ADMINISTRATIVOS]).toEqual(['admin_seccional', 'admin_unidade']);
	});
});
