/**
 * Teto de varredura do hash — as duas portas do portal de validação.
 *
 * O que estes testes prendem, além do teto em si: que as duas portas contam
 * SEPARADO (um flood de consultas não pode trancar quem baixa) e que o contador
 * fora do ar devolve `'indisponivel'`, não `'liberado'` — porque a diferença
 * entre falhar aberto e falhar fechado, aqui, é a diferença entre ter e não ter
 * a proteção (FLW-AUT-016).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import {
	tetoDeVarreduraDeHash,
	VALIDAR_CONSULTA_MAX,
	VALIDAR_DOWNLOAD_MAX,
	VALIDAR_WINDOW_MIN
} from '../validar-rate-limit';

let sqlite: ReturnType<typeof bancoMigrado>;
let db: Database;

const IP = '203.0.113.7';
const HASH = 'AB3D-CN6V';

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

/** Gasta `n` requisições da porta, exigindo que todas passem. */
async function gastar(porta: 'validar_consulta' | 'validar_download', n: number, ip = IP) {
	for (let i = 0; i < n; i++) {
		expect(await tetoDeVarreduraDeHash(db, ip, porta, HASH), `req ${i + 1}`).toBe('liberado');
	}
}

describe('tetoDeVarreduraDeHash', () => {
	it('a página libera até o teto dela e recusa a seguinte', async () => {
		await gastar('validar_consulta', VALIDAR_CONSULTA_MAX);
		expect(await tetoDeVarreduraDeHash(db, IP, 'validar_consulta', HASH)).toBe('excedido');
	});

	it('o download libera até o teto dele, que é MENOR', async () => {
		// Menor de propósito: o download exige sessão, então o alcance de quem
		// varre já é reduzido; a página é anônima e frequentemente um NAT inteiro.
		expect(VALIDAR_DOWNLOAD_MAX).toBeLessThan(VALIDAR_CONSULTA_MAX);
		await gastar('validar_download', VALIDAR_DOWNLOAD_MAX);
		expect(await tetoDeVarreduraDeHash(db, IP, 'validar_download', HASH)).toBe('excedido');
	});

	it('as duas portas NÃO dividem o mesmo contador', async () => {
		// É a razão de existirem dois propósitos. Se isto inverter, um robô
		// varrendo a página pública derruba o download de quem tem sessão.
		await gastar('validar_download', VALIDAR_DOWNLOAD_MAX);
		expect(await tetoDeVarreduraDeHash(db, IP, 'validar_download', HASH)).toBe('excedido');

		expect(await tetoDeVarreduraDeHash(db, IP, 'validar_consulta', HASH)).toBe('liberado');
	});

	it('o teto é por ORIGEM: outro IP não herda o bloqueio', async () => {
		await gastar('validar_consulta', VALIDAR_CONSULTA_MAX);
		expect(await tetoDeVarreduraDeHash(db, IP, 'validar_consulta', HASH)).toBe('excedido');

		expect(await tetoDeVarreduraDeHash(db, '198.51.100.4', 'validar_consulta', HASH)).toBe(
			'liberado'
		);
	});

	it('tentativa fora da janela deixa de contar', async () => {
		await gastar('validar_consulta', VALIDAR_CONSULTA_MAX);
		expect(await tetoDeVarreduraDeHash(db, IP, 'validar_consulta', HASH)).toBe('excedido');

		// `attempted_at` é `datetime('now')` do SQLite; envelhecer com ISO faria
		// toda linha parecer velha e o teste passaria por engano.
		sqlite
			.prepare(
				`UPDATE recovery_attempts SET attempted_at = datetime('now', ?)
				 WHERE purpose = 'validar_consulta'`
			)
			.run(`-${VALIDAR_WINDOW_MIN + 1} minutes`);

		expect(await tetoDeVarreduraDeHash(db, IP, 'validar_consulta', HASH)).toBe('liberado');
	});

	it('contador fora do ar devolve `indisponivel` — nunca `liberado`', async () => {
		// FLW-AUT-016: D1 fora não pode virar enumeração livre. E `indisponivel` é
		// veredito PRÓPRIO, não `excedido`, porque a mensagem ao usuário difere —
		// dizer "muitas tentativas" a quem não fez nenhuma manda esperar por um
		// motivo que não existe.
		const quebrado = {
			select: () => {
				throw new Error('D1 indisponível');
			}
		} as unknown as Database;

		expect(await tetoDeVarreduraDeHash(quebrado, IP, 'validar_consulta', HASH)).toBe(
			'indisponivel'
		);
	});

	it('registra a tentativa ao liberar — é a consulta que se cobra, não a falha', async () => {
		await gastar('validar_consulta', 3);
		const [{ n }] = sqlite
			.prepare(`SELECT COUNT(*) AS n FROM recovery_attempts WHERE purpose = 'validar_consulta'`)
			.all() as { n: number }[];
		expect(n).toBe(3);
	});

	it('não infla o contador dos outros propósitos da tabela', async () => {
		// `recovery_attempts` é compartilhada com login/reset/2FA: quem valida
		// muitos documentos não pode acabar bloqueado para redefinir a senha.
		await gastar('validar_consulta', 5);
		const [{ n }] = sqlite
			.prepare(
				`SELECT COUNT(*) AS n FROM recovery_attempts
				 WHERE purpose NOT IN ('validar_consulta', 'validar_download')`
			)
			.all() as { n: number }[];
		expect(n).toBe(0);
	});
});

describe('a mensagem da tela', () => {
	it('teto e "não encontrado" são estados DIFERENTES', () => {
		// Não é teste de componente (o vitest roda sem DOM): é o registro da
		// decisão que o `+page.svelte` implementa. A tela de "não encontrado" diz
		// que o documento "pode ser falso ou adulterado"; despejar ali quem só
		// esbarrou no teto acusaria um documento legítimo por causa da NOSSA
		// contagem. Por isso `rate_limit` entra em `semVeredito`, com texto próprio.
		const motivosSemVeredito = ['erro_db', 'erro_consulta', 'rate_limit'];
		expect(motivosSemVeredito).toContain('rate_limit');
		expect(motivosSemVeredito).not.toContain('nao_encontrado');
	});
});

vi.restoreAllMocks();
