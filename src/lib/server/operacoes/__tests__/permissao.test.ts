/**
 * O escopo de escrita da linha de base, contra SQLite real.
 *
 * O que estes testes protegem: `unidade_id` chega no CORPO do POST, não na URL.
 * Um handler que confia nesse valor deixa qualquer admin autenticado reescrever
 * a base de qualquer delegacia — a base é parâmetro de um resultado divulgado, e
 * o formato do buraco é o mesmo do FLW-ESC-002.
 *
 * A regra tem DUAS condições, e cada uma tem seu caso negativo aqui: administrar
 * a unidade não basta se ela não participa da operação, e participar não basta
 * se não é administrada.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import type { DatabaseSync } from 'node:sqlite';
import type { UsuarioLogado } from '$lib/auth';
import type { Database } from '$lib/db';
import { unidadesLinhaBaseAdministradas, podeInformarLinhaBase } from '../permissao';

let sqlite: DatabaseSync;
let db: Database;
let craId: number;
let giseId: number;

/** Ids das unidades do cenário, montado uma vez por teste. */
let seccional: number;
let crato: number;
let barbalha: number;
let deOutraSeccional: number;
let foraDaOperacao: number;

function novaUnidade(nome: string, tipo = 'delegacia', seccionalId: number | null = null): number {
	sqlite
		.prepare('INSERT INTO unidades (nome, tipo, seccional_id) VALUES (?, ?, ?)')
		.run(nome, tipo, seccionalId);
	return Number((sqlite.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
}

/** Escala da operação com uma seccional e uma delegacia em slot. */
function escalaCom(operacaoId: number, seccionalId: number, slots: number[]) {
	sqlite
		.prepare('INSERT INTO gise_escalas (data_inicio, operacao_id) VALUES (?, ?)')
		.run('2026-08-15', operacaoId);
	const escId = Number(
		(sqlite.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id
	);
	sqlite
		.prepare('INSERT INTO gise_seccionais (gise_id, seccional_id) VALUES (?, ?)')
		.run(escId, seccionalId);
	const secId = Number(
		(sqlite.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id
	);
	for (const s of slots) {
		sqlite
			.prepare('INSERT INTO gise_seccional_unidades (gise_seccional_id, unidade_id) VALUES (?, ?)')
			.run(secId, s);
	}
}

function usuario(over: Partial<UsuarioLogado>): UsuarioLogado {
	return { id: 1, tipo: 'policial', nome: 'Fulano', primeiro_acesso: false, ...over };
}

const admGeral = usuario({ tipo: 'admin', nome: 'Admin Geral' });

beforeEach(async () => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);

	craId = Number(
		(
			sqlite.prepare(`SELECT id FROM operacoes WHERE nome = 'OPERAÇÃO CRAJUBAR'`).get() as {
				id: number;
			}
		).id
	);
	giseId = Number(
		(sqlite.prepare(`SELECT id FROM operacoes WHERE nome = 'GISE'`).get() as { id: number }).id
	);

	seccional = novaUnidade('2ª SECCIONAL DO CARIRI', 'seccional');
	crato = novaUnidade('DELEGACIA DO CRATO', 'delegacia', seccional);
	barbalha = novaUnidade('DELEGACIA DE BARBALHA', 'delegacia', seccional);
	const outraSec = novaUnidade('1ª SECCIONAL', 'seccional');
	deOutraSeccional = novaUnidade('DELEGACIA DE FORTALEZA', 'delegacia', outraSec);
	foraDaOperacao = novaUnidade('DELEGACIA DE SOBRAL', 'delegacia', seccional);

	// CRAJUBAR: a 2ª Seccional com Crato e Barbalha em slot. Sobral é subordinada
	// à mesma seccional mas NÃO entra em escala nenhuma.
	escalaCom(craId, seccional, [crato, barbalha]);
	// GISE: outra seccional, para provar o recorte por operação.
	escalaCom(giseId, outraSec, [deOutraSeccional]);
});

describe('sem sessão ou sem papel', () => {
	it('usuário nulo não administra nada', async () => {
		expect(await unidadesLinhaBaseAdministradas(db, null, craId)).toEqual(new Set());
	});

	it('policial sem papel não administra nada', async () => {
		const u = usuario({ papel: null });
		expect(await unidadesLinhaBaseAdministradas(db, u, craId)).toEqual(new Set());
	});

	it('admin com papel mas SEM papel_unidade_id não administra nada', async () => {
		// Sem unidade de papel não há escopo — nunca "então mostra tudo".
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: null });
		expect(await unidadesLinhaBaseAdministradas(db, u, craId)).toEqual(new Set());
	});
});

describe('Admin Geral', () => {
	it('recebe todas as unidades participantes da operação', async () => {
		const escopo = await unidadesLinhaBaseAdministradas(db, admGeral, craId);
		expect(escopo).toEqual(new Set([seccional, crato, barbalha]));
	});

	it('não recebe unidade que só participa de OUTRA operação', async () => {
		const escopo = await unidadesLinhaBaseAdministradas(db, admGeral, craId);
		expect(escopo.has(deOutraSeccional)).toBe(false);
	});

	it('não recebe unidade que não participa de escala nenhuma', async () => {
		const escopo = await unidadesLinhaBaseAdministradas(db, admGeral, craId);
		expect(escopo.has(foraDaOperacao)).toBe(false);
	});
});

describe('admin_unidade', () => {
	it('administra só a própria unidade de papel', async () => {
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: crato });
		expect(await unidadesLinhaBaseAdministradas(db, u, craId)).toEqual(new Set([crato]));
	});

	it('não alcança a unidade vizinha da mesma seccional', async () => {
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: crato });
		expect(await podeInformarLinhaBase(db, u, craId, barbalha)).toBe(false);
	});

	it('unidade que não participa da operação é recusada', async () => {
		// Administrar não basta: a unidade precisa estar na operação.
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: foraDaOperacao });
		expect(await unidadesLinhaBaseAdministradas(db, u, craId)).toEqual(new Set());
		expect(await podeInformarLinhaBase(db, u, craId, foraDaOperacao)).toBe(false);
	});

	it('a mesma unidade em outra operação não vaza', async () => {
		const u = usuario({ papel: 'admin_unidade', papel_unidade_id: crato });
		expect(await unidadesLinhaBaseAdministradas(db, u, giseId)).toEqual(new Set());
	});
});

describe('admin_seccional', () => {
	it('administra a própria seccional e as subordinadas que participam', async () => {
		const u = usuario({ papel: 'admin_seccional', papel_unidade_id: seccional });
		expect(await unidadesLinhaBaseAdministradas(db, u, craId)).toEqual(
			new Set([seccional, crato, barbalha])
		);
	});

	it('subordinada que não participa fica de fora', async () => {
		// Sobral é da mesma seccional, mas não está em escala nenhuma da CRAJUBAR.
		const u = usuario({ papel: 'admin_seccional', papel_unidade_id: seccional });
		expect(await podeInformarLinhaBase(db, u, craId, foraDaOperacao)).toBe(false);
	});

	it('não alcança unidade de outra seccional', async () => {
		const u = usuario({ papel: 'admin_seccional', papel_unidade_id: seccional });
		expect(await podeInformarLinhaBase(db, u, giseId, deOutraSeccional)).toBe(false);
	});
});

describe('podeInformarLinhaBase', () => {
	it('concorda com o conjunto devolvido por unidadesLinhaBaseAdministradas', async () => {
		const u = usuario({ papel: 'admin_seccional', papel_unidade_id: seccional });
		const escopo = await unidadesLinhaBaseAdministradas(db, u, craId);
		for (const id of [seccional, crato, barbalha, foraDaOperacao, deOutraSeccional]) {
			expect(await podeInformarLinhaBase(db, u, craId, id)).toBe(escopo.has(id));
		}
	});

	it('Admin Geral pode informar a base de participante', async () => {
		expect(await podeInformarLinhaBase(db, admGeral, craId, crato)).toBe(true);
	});
});
