/**
 * Prefixo apagado sem âncora não passa na verificação — FLW-AUDIT-005.
 *
 * A retenção sempre pôde apagar `audit_log` além do prazo (LGPD art. 16). O
 * problema era o verificador: ao chegar na primeira linha sobrevivente, ele
 * pulava a checagem de elo e aceitava tanto `GENESIS` quanto "deve ter sido a
 * retenção". Apagar as primeiras N linhas — para sumir com um evento — deixava
 * o resto da cadeia perfeitamente encadeado, e a página de integridade dizia
 * `ok: true`.
 *
 * O caso decisivo é o primeiro do segundo bloco: ele PASSAVA antes da correção.
 * Um teste de integridade que só cobrisse cadeia íntegra e elo adulterado
 * nunca teria encontrado isto — o buraco não quebra nada do que se olhava.
 *
 * Banco de verdade porque a propriedade É a cadeia: `seq` único, `hash_anterior`
 * encadeado e o checkpoint gravado na mesma transação do DELETE.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import { auditar, verificarIntegridadeAudit } from '../audit';
import { executarLimpezaRetencao } from '../lgpd/retencao';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

beforeEach(async () => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	// Seis eventos encadeados, seq 1..6.
	for (let i = 1; i <= 6; i++) {
		await auditar(db, {
			acao: 'editar_escala',
			usuario: { id: 1, nome: 'Admin', tipo: 'admin' },
			entidade: 'escala',
			entidade_id: i,
			detalhes: `evento ${i}`
		});
	}
});

const checkpoints = () =>
	sqlite.prepare('SELECT seq_ate, hash_ate, removidos, politica FROM audit_checkpoints').all() as {
		seq_ate: number;
		hash_ate: string;
		removidos: number;
		politica: string;
	}[];

/** Envelhece as N primeiras linhas para além do prazo de retenção. */
function envelhecer(ate: number) {
	sqlite.exec(`UPDATE audit_log SET created_at = '2000-01-01 00:00:00' WHERE seq <= ${ate}`);
}

const CONFIG = {
	sessoesDias: 30,
	loginAttemptsDias: 90,
	doisFatoresDias: 1,
	resetTokensDias: 7,
	recoveryAttemptsDias: 90,
	webhookNoncesDias: 7,
	auditLogAnos: 5,
	appLogDias: 90
};

describe('cadeia íntegra', () => {
	it('sem corte, verifica ok', async () => {
		const r = await verificarIntegridadeAudit(db);
		expect(r.ok, r.problema).toBe(true);
		expect(r.verificados).toBe(6);
	});
});

describe('o corte legítimo continua verificável', () => {
	it('a retenção grava o checkpoint e a cadeia segue ok', async () => {
		envelhecer(3);
		const res = await executarLimpezaRetencao(db, CONFIG);
		expect(res.auditLog).toBe(3);

		const [cp] = checkpoints();
		expect(cp.seq_ate, 'a âncora aponta para o último removido').toBe(3);
		expect(cp.removidos).toBe(3);
		expect(cp.politica).toBe('retencao:5anos');

		const r = await verificarIntegridadeAudit(db);
		expect(r.ok, r.problema).toBe(true);
		expect(r.verificados).toBe(3);
	});

	it('o hash da âncora é o hash_anterior da primeira sobrevivente', async () => {
		envelhecer(3);
		await executarLimpezaRetencao(db, CONFIG);

		const [cp] = checkpoints();
		const primeira = sqlite
			.prepare('SELECT hash_anterior FROM audit_log ORDER BY seq LIMIT 1')
			.get() as { hash_anterior: string };
		expect(cp.hash_ate).toBe(primeira.hash_anterior);
	});
});

describe('o corte NÃO explicado passa a ser recusado', () => {
	it('prefixo apagado sem checkpoint reprova', async () => {
		// ISTO PASSAVA. É o achado inteiro: a cadeia restante continua com elos
		// corretos, então tudo que se verificava seguia batendo.
		sqlite.exec('DELETE FROM audit_log WHERE seq <= 3');

		const r = await verificarIntegridadeAudit(db);
		expect(r.ok).toBe(false);
		expect(r.primeiroProblemaSeq).toBe(4);
		expect(r.problema).toContain('sem checkpoint de retenção');
	});

	it('checkpoint com hash que não bate reprova', async () => {
		// Forjar a âncora também não resolve para quem apagou: o hash tem de ser
		// o da linha que sumiu, e quem a apagou não o tem mais.
		sqlite.exec(`
			DELETE FROM audit_log WHERE seq <= 3;
			INSERT INTO audit_checkpoints (seq_ate, hash_ate, removidos, politica)
			VALUES (3, 'hash-inventado', 3, 'retencao:5anos');
		`);

		const r = await verificarIntegridadeAudit(db);
		expect(r.ok).toBe(false);
		expect(r.problema).toContain('não casa com o hash_anterior');
	});

	it('checkpoint no seq errado não cobre o buraco', async () => {
		sqlite.exec(`
			DELETE FROM audit_log WHERE seq <= 3;
			INSERT INTO audit_checkpoints (seq_ate, hash_ate, removidos, politica)
			VALUES (1, 'qualquer', 1, 'retencao:5anos');
		`);

		const r = await verificarIntegridadeAudit(db);
		expect(r.ok).toBe(false);
		expect(r.problema).toContain('sem checkpoint de retenção');
	});

	it('buraco no MEIO continua reprovando, como já reprovava', async () => {
		// A correção não podia afrouxar o que já funcionava: só a PRIMEIRA linha
		// sobrevivente ganha a checagem de âncora.
		sqlite.exec('DELETE FROM audit_log WHERE seq = 3');
		const r = await verificarIntegridadeAudit(db);
		expect(r.ok).toBe(false);
		expect(r.problema).toContain('Buraco na sequência');
	});
});

describe('nada a cortar', () => {
	it('não cria checkpoint de corte vazio', async () => {
		const res = await executarLimpezaRetencao(db, CONFIG);
		expect(res.auditLog).toBe(0);
		expect(checkpoints(), 'checkpoint sem buraco correspondente seria ruído').toEqual([]);
	});
});
