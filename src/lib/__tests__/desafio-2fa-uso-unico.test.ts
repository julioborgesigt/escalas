/**
 * USO ÚNICO do desafio de dois fatores, contra um SQLite REAL.
 *
 * Mesma causa-raiz do token de redefinição (FLW-AUTH-004), em outro segredo: o
 * desafio era LIDO, conferido e só então marcado com um `UPDATE` incondicional.
 * Duas submissões paralelas do MESMO código válido passavam ambas — o código de
 * 6 dígitos que chegou por e-mail virava reutilizável dentro dessa janela, e o
 * login por certificado criava duas sessões a partir de um desafio só.
 *
 * O contador de tentativas tinha a forma inversa do mesmo problema: `tentativas
 * + 1` calculado em JS sobre o valor lido antes de qualquer gravação. Cinco
 * palpites paralelos registravam UMA tentativa, e o teto de 5 — que é o
 * anti-brute-force do código de 6 dígitos — nunca era alcançado.
 *
 * Os dois casos precisam de banco de verdade: é o SQL que serializa, e um mock
 * do query builder provaria só que o código chama o que já sabemos que chama.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Database } from '$lib/db';
import { criarDesafio2FA, verificarDesafio2FA, consumirDesafio2FA } from '$lib/auth';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';

const CODIGO = '123456';

let sqlite: DatabaseSync;
let db: Database;

beforeEach(() => {
	vi.useRealTimers();
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

/** Id numérico da linha do desafio (o `desafio_id` público é outro campo). */
function idDoDesafio(): number {
	return (sqlite.prepare('SELECT id FROM dois_fatores_tokens').get() as { id: number }).id;
}

function tentativas(): number {
	return (
		sqlite.prepare('SELECT tentativas FROM dois_fatores_tokens').get() as { tentativas: number }
	).tentativas;
}

/** Empurra a validade para o passado — mais direto que mexer no relógio. */
function expirar(): void {
	sqlite
		.prepare('UPDATE dois_fatores_tokens SET expires_at = ?')
		.run(new Date(Date.now() - 1000).toISOString());
}

describe('consumirDesafio2FA', () => {
	it('a primeira chamada ganha, a segunda não', async () => {
		await criarDesafio2FA(db, 'policial', 1, CODIGO);
		const id = idDoDesafio();

		await expect(consumirDesafio2FA(db, id)).resolves.toBe(true);
		await expect(consumirDesafio2FA(db, id)).resolves.toBe(false);
	});

	it('em paralelo, exatamente uma ganha', async () => {
		await criarDesafio2FA(db, 'policial', 1, CODIGO);
		const id = idDoDesafio();

		const r = await Promise.all([
			consumirDesafio2FA(db, id),
			consumirDesafio2FA(db, id),
			consumirDesafio2FA(db, id)
		]);

		expect(r.filter(Boolean)).toHaveLength(1);
	});

	it('desafio inexistente não é consumido', async () => {
		await expect(consumirDesafio2FA(db, 4242)).resolves.toBe(false);
	});
});

describe('verificarDesafio2FA', () => {
	it('código certo autentica uma vez só', async () => {
		const desafioId = await criarDesafio2FA(db, 'policial', 77, CODIGO);

		await expect(verificarDesafio2FA(db, desafioId, CODIGO, ['policial'])).resolves.toEqual({
			tipo: 'policial',
			usuarioId: 77
		});
		await expect(verificarDesafio2FA(db, desafioId, CODIGO, ['policial'])).resolves.toBeNull();
	});

	it('submissões CONCORRENTES do mesmo código válido: uma sessão, não três', async () => {
		// O caso que a implementação antiga perdia: as três liam `usado = 0`,
		// as três batiam o hash e as três seguiam para criar sessão.
		const desafioId = await criarDesafio2FA(db, 'policial', 77, CODIGO);

		const r = await Promise.all([
			verificarDesafio2FA(db, desafioId, CODIGO, ['policial']),
			verificarDesafio2FA(db, desafioId, CODIGO, ['policial']),
			verificarDesafio2FA(db, desafioId, CODIGO, ['policial'])
		]);

		expect(r.filter((x) => x !== null)).toHaveLength(1);
	});

	it('assinatura EM LOTE segue reutilizável — é o contrato de markUsed: false', async () => {
		const desafioId = await criarDesafio2FA(db, 'assinatura', 5, CODIGO);
		const opts = { markUsed: false };

		for (let i = 0; i < 3; i++) {
			await expect(
				verificarDesafio2FA(db, desafioId, CODIGO, ['assinatura'], '', opts)
			).resolves.toEqual({ tipo: 'assinatura', usuarioId: 5 });
		}
	});

	it('cinco palpites PARALELOS contam cinco tentativas', async () => {
		// Com `tentativas: desafio.tentativas + 1` calculado em JS, os cinco
		// gravavam 1 e o teto de 5 nunca era atingido.
		const desafioId = await criarDesafio2FA(db, 'policial', 9, CODIGO);

		await Promise.all(
			['000001', '000002', '000003', '000004', '000005'].map((errado) =>
				verificarDesafio2FA(db, desafioId, errado, ['policial'])
			)
		);

		expect(tentativas()).toBe(5);
	});

	it('esgotado o teto, nem o código certo passa', async () => {
		const desafioId = await criarDesafio2FA(db, 'policial', 9, CODIGO);
		for (let i = 0; i < 5; i++) await verificarDesafio2FA(db, desafioId, '999999', ['policial']);

		await expect(verificarDesafio2FA(db, desafioId, CODIGO, ['policial'])).resolves.toBe(
			'esgotado'
		);
	});

	it('código errado falha mesmo em lote', async () => {
		const desafioId = await criarDesafio2FA(db, 'assinatura', 5, CODIGO);
		await expect(
			verificarDesafio2FA(db, desafioId, '000000', ['assinatura'], '', { markUsed: false })
		).resolves.toBeNull();
	});

	it('desafio expirado é rejeitado', async () => {
		const desafioId = await criarDesafio2FA(db, 'assinatura', 5, CODIGO);
		expirar();

		await expect(verificarDesafio2FA(db, desafioId, CODIGO, ['assinatura'])).resolves.toBe(
			'expirado'
		);
	});

	it('desafio inexistente é nulo', async () => {
		await expect(verificarDesafio2FA(db, 'nao-existe', CODIGO, ['policial'])).resolves.toBeNull();
	});
});

/**
 * `expectedTipos` é defense-in-depth: o canal (login, reset, assinatura,
 * verificação de e-mail) declara quais desafios aceita. Sem isso, um
 * `desafioId` emitido para um canal poderia ser submetido em outro — o
 * confused-deputy que o bug C2 documentou: capturar o desafio de um e-mail de
 * ASSINATURA e submetê-lo em `/api/auth/verificar-2fa` criaria sessão sem senha.
 */
describe('verificarDesafio2FA — expectedTipos', () => {
	it('aceita quando o tipo está na lista', async () => {
		const desafioId = await criarDesafio2FA(db, 'policial', 42, CODIGO);
		await expect(
			verificarDesafio2FA(db, desafioId, CODIGO, ['policial', 'admin'])
		).resolves.toEqual({ tipo: 'policial', usuarioId: 42 });
	});

	it('REJEITA desafio de assinatura no canal de login (bug C2)', async () => {
		const desafioId = await criarDesafio2FA(db, 'assinatura', 42, CODIGO);
		await expect(
			verificarDesafio2FA(db, desafioId, CODIGO, ['policial', 'admin'])
		).resolves.toBeNull();
	});

	it('REJEITA desafio de reset no canal de assinatura', async () => {
		const desafioId = await criarDesafio2FA(db, 'reset_policial', 42, CODIGO);
		await expect(verificarDesafio2FA(db, desafioId, CODIGO, ['assinatura'])).resolves.toBeNull();
	});

	it('aceita reset_policial OU reset_admin no canal de reset', async () => {
		const canal = ['reset_policial', 'reset_admin'] as const;
		for (const tipo of canal) {
			sqlite.exec('DELETE FROM dois_fatores_tokens');
			const desafioId = await criarDesafio2FA(db, tipo, 42, CODIGO);
			await expect(verificarDesafio2FA(db, desafioId, CODIGO, canal)).resolves.toEqual({
				tipo,
				usuarioId: 42
			});
		}
	});

	it('`verificacao_email` e `assinatura` são canais separados (I-2)', async () => {
		// Compartilhavam o mesmo tipo; separá-los fechou o confused-deputy de um
		// caminho futuro aceitar um sem o outro.
		const verif = await criarDesafio2FA(db, 'verificacao_email', 42, CODIGO);
		await expect(verificarDesafio2FA(db, verif, CODIGO, ['assinatura'])).resolves.toBeNull();

		const ass = await criarDesafio2FA(db, 'assinatura', 42, CODIGO);
		await expect(verificarDesafio2FA(db, ass, CODIGO, ['verificacao_email'])).resolves.toBeNull();
	});

	it('tipo errado devolve null ANTES de expirado/esgotado — não vaza estado', async () => {
		// Tipo errado tem de ser indistinguível de "desafio não existe": a
		// ordem das checagens é a garantia, não um detalhe de implementação.
		const desafioId = await criarDesafio2FA(db, 'assinatura', 42, CODIGO);
		expirar();
		sqlite.exec('UPDATE dois_fatores_tokens SET tentativas = 99');

		await expect(verificarDesafio2FA(db, desafioId, CODIGO, ['policial'])).resolves.toBeNull();
	});
});

describe('verificarDesafio2FA — bindExtra', () => {
	it('amarra o código ao e-mail: trocar o destinatário invalida (I-1)', async () => {
		// Sem o binding, um código emitido para a@b.com valeria para confirmar
		// evil@evil.com como e-mail pessoal do mesmo usuário.
		const desafioId = await criarDesafio2FA(db, 'verificacao_email', 42, CODIGO, 'a@b.com');

		await expect(
			verificarDesafio2FA(db, desafioId, CODIGO, ['verificacao_email'], 'a@b.com')
		).resolves.toEqual({ tipo: 'verificacao_email', usuarioId: 42 });

		sqlite.exec('UPDATE dois_fatores_tokens SET usado = 0, tentativas = 0');
		await expect(
			verificarDesafio2FA(db, desafioId, CODIGO, ['verificacao_email'], 'evil@evil.com')
		).resolves.toBeNull();
	});
});
