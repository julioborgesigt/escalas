import { describe, it, expect, vi } from 'vitest';
import { removerGiseSeccionalUnidade } from '../seccionais';
import { giseEquipes, giseSeccionalUnidades } from '../../../server/schema';
import type { Database } from '../../core';

/**
 * `gise_equipes.gise_unidade_id` aponta para o slot mas NÃO tem foreign key —
 * é só coluna + índice (ver `migrations/0000_initial_schema.sql`). Apagar o
 * slot, portanto, não leva as equipes junto.
 *
 * Enquanto o delete das equipes não existia, remover um slot já preenchido
 * deixava os membros invisíveis e ativos ao mesmo tempo: o load agrupa equipes
 * por slot existente (some da tela), mas `verificarTodosEntraram` caminha
 * membro → equipe → seccional sem passar pelo slot (continua contando). A GISE
 * travava esperando a entrada de gente que ninguém enxergava.
 *
 * Reproduzido em SQLite: após o delete do slot a equipe e o membro
 * sobreviviam, a contagem de presença subia de 2 para 3 e a tela seguia
 * mostrando uma equipe só.
 */
function dbEspiao() {
	const alvos: unknown[] = [];
	const db = {
		delete: vi.fn((tabela: unknown) => {
			alvos.push(tabela);
			return { where: vi.fn(() => Promise.resolve()) };
		})
	} as unknown as Database;
	return { db, alvos };
}

describe('removerGiseSeccionalUnidade', () => {
	it('apaga as equipes do slot antes do próprio slot', async () => {
		const { db, alvos } = dbEspiao();

		await removerGiseSeccionalUnidade(db, 42);

		// Equipes primeiro: se o slot caísse antes, o id usado para achá-las
		// continuaria válido, mas a ordem deixa explícito o que depende de quê.
		expect(alvos).toEqual([giseEquipes, giseSeccionalUnidades]);
	});
});
