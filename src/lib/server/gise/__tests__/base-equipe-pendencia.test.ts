/**
 * O envio que não chegou à planilha vira pendência — FLW-WEBHOOK-003.
 *
 * A GISE é finalizada e SÓ ENTÃO o envio para a Base_Equipe é agendado, fora da
 * resposta ao cliente. Falhando, sobrava um `logger.error`: nenhuma pendência,
 * nenhuma correlação, nenhuma tentativa persistida. A escala ficava fechada no
 * sistema e ausente da planilha que a corporação usa para pagar o
 * extraordinário — e a tela mostrava tudo normal, porque o efeito é fora daqui.
 *
 * O que este arquivo NÃO cobre, e é limite honesto: a metade do achado que fala
 * do destino ("versão monotônica e staging antes da troca") é do Apps Script,
 * que não vive neste repositório. O que dá para fazer daqui é mandar a chave de
 * idempotência — precondição para a correção de lá — e garantir que a falha
 * fique registrada e reprocessável aqui.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import {
	chaveIdempotenciaBaseEquipe,
	contarPendenciasBaseEquipe,
	reprocessarPendenciasBaseEquipe
} from '../base-equipe-sync';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const GISE = 97001;

const ENV = {
	GISE_BASE_EQUIPE_WEBHOOK_URL: 'https://script.google.com/macros/s/AKfy/exec',
	GISE_BASE_EQUIPE_SECRET: 'segredo'
};

const pendencias = () =>
	sqlite
		.prepare(
			'SELECT gise_id, chave_idempotencia, motivo, tentativas FROM base_equipe_pendencias ORDER BY gise_id'
		)
		.all() as {
		gise_id: number;
		chave_idempotencia: string;
		motivo: string;
		tentativas: number;
	}[];

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO gise_escalas (id, data_inicio, status)
		VALUES (${GISE}, '2026-09-10', 'finalizada');
	`);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

/** `fetch` que responde o que o teste mandar. */
function fetchQueResponde(corpo: unknown, status = 200) {
	const espiao = vi.fn(async () => new Response(JSON.stringify(corpo), { status }));
	vi.stubGlobal('fetch', espiao);
	return espiao;
}

describe('chave de idempotência', () => {
	it('é estável por GISE', () => {
		// O destino só consegue reconhecer a repetição se a chave for a mesma. Uma
		// chave por tentativa (timestamp, uuid) tornaria o reenvio indistinguível
		// de um envio novo — que é como a planilha duplica linhas.
		expect(chaveIdempotenciaBaseEquipe(GISE)).toBe(chaveIdempotenciaBaseEquipe(GISE));
		expect(chaveIdempotenciaBaseEquipe(GISE)).not.toBe(chaveIdempotenciaBaseEquipe(GISE + 1));
	});
});

describe('reprocessamento', () => {
	beforeEach(() => {
		sqlite.exec(`
			INSERT INTO base_equipe_pendencias (gise_id, chave_idempotencia, motivo)
			VALUES (${GISE}, '${chaveIdempotenciaBaseEquipe(GISE)}', 'HTTP 503');
		`);
	});

	it('envio que volta a funcionar sai da fila e carimba a escala', async () => {
		fetchQueResponde({ ok: true });

		const r = await reprocessarPendenciasBaseEquipe(ENV, db);
		expect(r).toEqual({ reenviadas: 1, persistentes: 0 });
		expect(await contarPendenciasBaseEquipe(db)).toBe(0);

		const gise = sqlite
			.prepare(
				`SELECT planilha_base_equipe_alimentada_em AS carimbo FROM gise_escalas WHERE id = ${GISE}`
			)
			.get() as { carimbo: string | null };
		expect(gise.carimbo, 'sem o carimbo a escala parece nunca ter sido enviada').not.toBeNull();
	});

	it('a que falha de novo FICA na fila, com a tentativa contada', async () => {
		fetchQueResponde({ error: 'ainda fora do ar' }, 500);

		const r = await reprocessarPendenciasBaseEquipe(ENV, db);
		expect(r.persistentes).toBe(1);

		const [linha] = pendencias();
		expect(linha.tentativas, 'o contador separa transitório de permanente').toBe(1);
		expect(linha.motivo).not.toBe('HTTP 503');
	});

	it('a chave de idempotência viaja no payload', async () => {
		const espiao = fetchQueResponde({ ok: true });
		await reprocessarPendenciasBaseEquipe(ENV, db);

		const [, init] = espiao.mock.calls[0] as unknown as [string, RequestInit];
		const corpo = JSON.parse(String(init.body));
		expect(corpo.idempotency_key).toBe(chaveIdempotenciaBaseEquipe(GISE));
		expect(corpo.gise_id).toBe(GISE);
	});

	it('sem configuração de webhook, a pendência é preservada', async () => {
		// Desativar o sync não pode APAGAR a dívida: a escala continua ausente da
		// planilha, e quem configurar a URL depois precisa encontrar a pendência.
		const r = await reprocessarPendenciasBaseEquipe(undefined, db);
		expect(r.reenviadas).toBe(0);
		expect(await contarPendenciasBaseEquipe(db)).toBe(1);
	});
});

describe('fila vazia', () => {
	it('não inventa trabalho', async () => {
		const espiao = fetchQueResponde({ ok: true });
		expect(await reprocessarPendenciasBaseEquipe(ENV, db)).toEqual({
			reenviadas: 0,
			persistentes: 0
		});
		expect(espiao).not.toHaveBeenCalled();
	});
});
