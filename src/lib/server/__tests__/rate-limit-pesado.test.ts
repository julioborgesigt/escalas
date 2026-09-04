/**
 * Teto de geração pesada — o que ele barra, o que ele deixa passar, e a
 * propriedade que motivou o módulo: contar por CONTA, não por endereço.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import {
	limitarGeracaoPesada,
	MAX_PESADO_POR_JANELA,
	JANELA_PESADA_MIN
} from '../rate-limit-pesado';

let sqlite: ReturnType<typeof bancoMigrado>;
let db: Database;

const ANA = { tipo: 'policial', id: 1 };
const BRUNO = { tipo: 'policial', id: 2 };

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

/** Gasta `n` gerações da conta, exigindo que todas passem. */
async function gastar(ator: typeof ANA, n: number) {
	for (let i = 0; i < n; i++) {
		expect(await limitarGeracaoPesada(db, ator), `chamada ${i + 1}`).toBeNull();
	}
}

describe('limitarGeracaoPesada', () => {
	it('deixa passar até o teto e recusa a seguinte com 429', async () => {
		await gastar(ANA, MAX_PESADO_POR_JANELA);

		const recusa = await limitarGeracaoPesada(db, ANA);
		expect(recusa).not.toBeNull();
		expect(recusa!.status).toBe(429);
		expect(await recusa!.clone().text()).toContain(String(JANELA_PESADA_MIN));
	});

	it('o teto de uma conta NÃO alcança a outra', async () => {
		// A razão de existir do módulo. O `chaveRateLimitIp` avisa que, sem salt, a
		// chave cai para a /24 — e numa delegacia a corporação inteira sai pelo
		// mesmo endereço. Como aqui há sessão, cobra-se de quem gastou: se este
		// teste inverter, um plantão em laço derruba o download dos colegas.
		await gastar(ANA, MAX_PESADO_POR_JANELA);
		expect(await limitarGeracaoPesada(db, ANA)).not.toBeNull();

		expect(await limitarGeracaoPesada(db, BRUNO)).toBeNull();
	});

	it('contas de TIPOS diferentes com o mesmo id não se misturam', async () => {
		// A chave é `pesado:<tipo>:<id>`; se fosse só o id, o admin 1 e o policial
		// 1 dividiriam o mesmo teto.
		await gastar({ tipo: 'admin', id: 1 }, MAX_PESADO_POR_JANELA);
		expect(await limitarGeracaoPesada(db, { tipo: 'admin', id: 1 })).not.toBeNull();

		expect(await limitarGeracaoPesada(db, { tipo: 'policial', id: 1 })).toBeNull();
	});

	it('tentativa registrada fora da janela não conta mais', async () => {
		await gastar(ANA, MAX_PESADO_POR_JANELA);
		expect(await limitarGeracaoPesada(db, ANA)).not.toBeNull();

		// Envelhece TODAS as linhas para além da janela. `attempted_at` é
		// `datetime('now')` (UTC do SQLite), então o passo é no mesmo formato —
		// comparar com ISO faria toda linha parecer velha e o teste passaria por
		// engano (é a armadilha que `contarRecoveryAttempts` documenta).
		sqlite
			.prepare(
				`UPDATE recovery_attempts
				 SET attempted_at = datetime('now', ?)
				 WHERE purpose = 'geracao_pesada'`
			)
			.run(`-${JANELA_PESADA_MIN + 1} minutes`);

		expect(await limitarGeracaoPesada(db, ANA)).toBeNull();
	});

	it('não infla o contador dos outros propósitos da mesma tabela', async () => {
		// `recovery_attempts` é compartilhada com login/reset/2FA. Um usuário que
		// baixa muito não pode acabar bloqueado para redefinir a própria senha.
		await gastar(ANA, 5);

		const [{ n }] = sqlite
			.prepare(`SELECT COUNT(*) AS n FROM recovery_attempts WHERE purpose <> 'geracao_pesada'`)
			.all() as { n: number }[];
		expect(n).toBe(0);
	});
});
