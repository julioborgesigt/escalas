/**
 * O evento de auditoria que a cadeia recusou — FLW-AUDIT-001.
 *
 * `auditar()` nunca lança, e isso é decisão antiga e correta: falha de trilha
 * não pode derrubar a operação do usuário. O que estava errado era o preço —
 * a mutação persistia, a resposta era sucesso, e do evento sobrava uma linha de
 * log fora do banco. Numa trilha que se propõe a ser forense, é o mesmo que não
 * ter acontecido.
 *
 * A política escolhida pelo operador é **pendência durável e segue**: a mutação
 * vale, o evento espera, o cron reinsere. Os casos abaixo cobrem as três coisas
 * que essa política promete, e a terceira é a que costuma ser esquecida —
 * distinguir a falha que passa da que não passa.
 *
 * Banco de verdade porque a falha que interessa é da CADEIA (`seq` único, hash
 * encadeado), e é ela que decide o comportamento.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import { auditar, reprocessarPendenciasAudit, contarPendenciasAudit } from '../audit';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const EVENTO = {
	usuario: { id: 1, nome: 'Fulano', tipo: 'admin' as const },
	acao: 'finalizar_gise' as const,
	entidade: 'gise',
	entidade_id: 7,
	detalhes: 'GISE 7 finalizada'
};

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	vi.restoreAllMocks();
});

const linhasNaCadeia = () =>
	(sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n;
const pendencias = () =>
	sqlite.prepare('SELECT * FROM audit_pendencias ORDER BY id').all() as {
		id: number;
		evento: string;
		acao: string;
		entidade: string | null;
		motivo: string;
		tentativas: number;
	}[];

/** Faz o append encadeado falhar, sem tocar no resto do banco. */
function quebrarCadeia() {
	sqlite.exec('DROP TABLE audit_log');
}

describe('caminho feliz', () => {
	it('evento entra na cadeia e não gera pendência', async () => {
		await auditar(db, EVENTO);
		expect(linhasNaCadeia()).toBe(1);
		expect(await contarPendenciasAudit(db)).toBe(0);
	});
});

describe('cadeia recusa o evento', () => {
	it('`auditar` NÃO lança — a operação do usuário não pode cair por causa da trilha', async () => {
		quebrarCadeia();
		await expect(auditar(db, EVENTO)).resolves.toBeUndefined();
	});

	it('o evento vira pendência, com ação e motivo legíveis', async () => {
		quebrarCadeia();
		await auditar(db, EVENTO);

		const [p] = pendencias();
		expect(p, 'o evento não pode simplesmente sumir').toBeDefined();
		expect(p.acao).toBe('finalizar_gise');
		expect(p.entidade).toBe('gise');
		// Ação e entidade ficam FORA do JSON de propósito: dão triagem ao operador
		// sem desserializar nada.
		expect(p.motivo, 'o motivo separa corrida de defeito').toMatch(/audit_log/i);
		expect(JSON.parse(p.evento)).toMatchObject({ entidade_id: 7 });
	});
});

describe('reprocessamento', () => {
	it('reinsere na cadeia e limpa a fila', async () => {
		quebrarCadeia();
		await auditar(db, EVENTO);
		expect(await contarPendenciasAudit(db)).toBe(1);

		// A causa era transitória: a tabela volta.
		sqlite = bancoMigrado();
		const sqliteNovo = sqlite;
		const dbNovo = drizzleSobre(sqliteNovo);
		// Reinjeta a pendência no banco íntegro — é o cenário real: a falha foi
		// numa instância, o cron roda depois com o banco de pé.
		sqliteNovo
			.prepare('INSERT INTO audit_pendencias (evento, acao, entidade, motivo) VALUES (?,?,?,?)')
			.run(JSON.stringify(EVENTO), 'finalizar_gise', 'gise', 'falha transitória');

		const r = await reprocessarPendenciasAudit(dbNovo);
		expect(r).toEqual({ reprocessadas: 1, persistentes: 0 });
		expect(
			(sqliteNovo.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n
		).toBe(1);
		expect(await contarPendenciasAudit(dbNovo)).toBe(0);
	});

	it('preserva a ORDEM de chegada — a trilha é linha do tempo', async () => {
		for (const acao of ['criar_escala', 'editar_escala', 'excluir_escala']) {
			sqlite
				.prepare(
					'INSERT INTO audit_pendencias (evento, acao, entidade, motivo, created_at) VALUES (?,?,?,?,?)'
				)
				.run(
					JSON.stringify({ ...EVENTO, acao }),
					acao,
					'escala',
					'x',
					`2026-08-0${['1', '2', '3'][['criar_escala', 'editar_escala', 'excluir_escala'].indexOf(acao)]} 00:00:00`
				);
		}

		await reprocessarPendenciasAudit(db);

		const seq = (
			sqlite.prepare('SELECT acao FROM audit_log ORDER BY seq').all() as { acao: string }[]
		).map((r) => r.acao);
		expect(seq).toEqual(['criar_escala', 'editar_escala', 'excluir_escala']);
	});

	it('falha PERSISTENTE fica na fila e conta a tentativa', async () => {
		// É o que separa a corrida de `seq` — que some na primeira retentativa —
		// do defeito permanente. Sem o contador, as duas parecem iguais e o
		// operador não sabe se está diante de ruído ou de perda de trilha.
		sqlite
			.prepare('INSERT INTO audit_pendencias (evento, acao, entidade, motivo) VALUES (?,?,?,?)')
			.run(JSON.stringify(EVENTO), 'finalizar_gise', 'gise', 'motivo antigo');
		quebrarCadeia();

		const r = await reprocessarPendenciasAudit(db);
		expect(r).toEqual({ reprocessadas: 0, persistentes: 1 });

		const [p] = pendencias();
		expect(p, 'a pendência não pode ser descartada por falhar de novo').toBeDefined();
		expect(p.tentativas).toBe(1);
		expect(p.motivo, 'o motivo é atualizado para o da última tentativa').not.toBe('motivo antigo');
	});

	it('pendência com JSON inválido sai da fila — nunca vai voltar', async () => {
		// Se ficasse, mascararia as pendências reais com um item que falha para
		// sempre, e o contador de persistentes viraria ruído permanente.
		sqlite
			.prepare('INSERT INTO audit_pendencias (evento, acao, entidade, motivo) VALUES (?,?,?,?)')
			.run('{isso não é json', 'x', null, 'y');

		const r = await reprocessarPendenciasAudit(db);
		expect(r).toEqual({ reprocessadas: 0, persistentes: 0 });
		expect(await contarPendenciasAudit(db)).toBe(0);
	});

	it('fila vazia é operação nula', async () => {
		await expect(reprocessarPendenciasAudit(db)).resolves.toEqual({
			reprocessadas: 0,
			persistentes: 0
		});
	});
});
