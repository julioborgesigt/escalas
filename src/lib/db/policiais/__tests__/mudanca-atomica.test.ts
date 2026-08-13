/**
 * Cadastro e linha do tempo mudam JUNTOS — FLW-RBAC-005.
 *
 * Movimentação, mudança de papel e desvinculação gravavam o cadastro numa
 * chamada e o histórico em outra. Entre as duas cabe uma falha, e o que ela
 * deixa é um estado que a ficha do policial não consegue explicar:
 *
 * - lotação trocada sem a portaria na linha do tempo;
 * - papel administrativo concedido sem registro de quem concedeu;
 * - cadastro INATIVADO sem data, sem NUP e sem responsável — uma baixa
 *   funcional sem ato que a fundamente.
 *
 * A ordem inversa é igualmente ruim e é a que o teste do meio cobre: histórico
 * dizendo que a pessoa foi movimentada enquanto o cadastro segue na unidade
 * antiga. Nos dois casos ninguém percebe, porque cada tela lê uma das metades.
 *
 * Banco de verdade porque a propriedade sob teste É a transação: um fake do
 * drizzle provaria que duas funções foram chamadas, não que as duas escritas
 * caem ou vingam juntas.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '../../__tests__/sqlite-migrado';
import { atualizarPolicialComHistorico } from '../historico';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const POL = 94001;
const ADMIN = { id: 94999, nome: 'Admin Geral' };

const cadastro = () =>
	sqlite.prepare(`SELECT lotacao, ativo, papel FROM policiais WHERE id = ${POL}`).get() as {
		lotacao: string;
		ativo: number;
		papel: string | null;
	};
const historico = () =>
	sqlite
		.prepare(`SELECT tipo, unidade_destino, nup FROM policial_historico WHERE policial_id = ${POL}`)
		.all() as { tipo: string; unidade_destino: string | null; nup: string | null }[];

const EVENTO_MOVIMENTACAO = {
	policial_id: POL,
	tipo: 'movimentacao' as const,
	unidade_origem: 'DELEGACIA A',
	unidade_destino: 'DELEGACIA B',
	data_evento: '2026-08-05',
	nup: '2026/0001',
	registrado_por_id: ADMIN.id,
	registrado_por_nome: ADMIN.nome
};

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, ativo)
		VALUES (${POL}, 'M94001', 'Fulano', 'OIP', 'DELEGACIA A', 'h', 1);
	`);
});

describe('caminho feliz — as duas escritas entram', () => {
	it('movimentação troca a lotação e registra a portaria', async () => {
		await atualizarPolicialComHistorico(db, POL, { lotacao: 'DELEGACIA B' }, EVENTO_MOVIMENTACAO);
		expect(cadastro().lotacao).toBe('DELEGACIA B');
		expect(historico()).toEqual([
			{ tipo: 'movimentacao', unidade_destino: 'DELEGACIA B', nup: '2026/0001' }
		]);
	});

	it('desvinculação inativa e registra a baixa', async () => {
		await atualizarPolicialComHistorico(
			db,
			POL,
			{ ativo: 0 },
			{
				policial_id: POL,
				tipo: 'desvinculacao',
				unidade_destino: 'APOSENTADORIA',
				data_evento: '2026-08-05',
				registrado_por_id: ADMIN.id,
				registrado_por_nome: ADMIN.nome
			}
		);
		expect(cadastro().ativo).toBe(0);
		expect(historico()[0].tipo).toBe('desvinculacao');
	});

	it('papel administrativo entra junto com seu registro', async () => {
		await atualizarPolicialComHistorico(
			db,
			POL,
			{ papel: 'admin_seccional', papel_unidade_id: 71 },
			{
				policial_id: POL,
				tipo: 'papel',
				descricao: 'Papel administrativo alterado para admin_seccional',
				registrado_por_id: ADMIN.id,
				registrado_por_nome: ADMIN.nome
			}
		);
		expect(cadastro().papel).toBe('admin_seccional');
		expect(historico()[0].tipo).toBe('papel');
	});
});

describe('falha no meio — nenhuma das duas entra', () => {
	it('histórico impossível não deixa a lotação trocada', async () => {
		// `policial_id` nulo viola o NOT NULL: o INSERT do histórico morre no
		// banco DEPOIS de o UPDATE do cadastro já ter ido no mesmo batch. É
		// exatamente a janela do achado.
		//
		// (`tipo` não serve para provocar a falha: o `enum` do drizzle é só
		// TypeScript, a migração 0036 não emitiu CHECK e um tipo inventado entra
		// no banco sem reclamar.)
		await expect(
			atualizarPolicialComHistorico(
				db,
				POL,
				{ lotacao: 'DELEGACIA B' },
				{
					...EVENTO_MOVIMENTACAO,
					policial_id: null as never
				}
			)
		).rejects.toThrow();

		expect(cadastro().lotacao, 'a lotação tinha de ter voltado').toBe('DELEGACIA A');
		expect(historico(), 'e nada foi registrado').toHaveLength(0);
	});

	it('a baixa não acontece sem o ato que a registra', async () => {
		await expect(
			atualizarPolicialComHistorico(
				db,
				POL,
				{ ativo: 0 },
				{
					policial_id: null as never,
					tipo: 'desvinculacao',
					registrado_por_id: ADMIN.id,
					registrado_por_nome: ADMIN.nome
				}
			)
		).rejects.toThrow();

		expect(cadastro().ativo, 'policial inativado sem ato é baixa sem fundamento').toBe(1);
	});

	it('cadastro impossível não deixa histórico órfão', async () => {
		// O outro sentido: o UPDATE é que falha (unidade inexistente violando a FK
		// não serve aqui, então a falha vem do próprio SET). O histórico não pode
		// afirmar uma movimentação que não aconteceu.
		sqlite.exec(`
			INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha)
			VALUES (94002, 'M94002', 'Outro', 'OIP', 'DELEGACIA A', 'h');
		`);
		await expect(
			atualizarPolicialComHistorico(
				db,
				POL,
				{ matricula: 'M94002' }, // colide com o UNIQUE de matrícula
				EVENTO_MOVIMENTACAO
			)
		).rejects.toThrow();

		expect(historico(), 'histórico sem a mudança que ele descreve').toHaveLength(0);
	});
});
