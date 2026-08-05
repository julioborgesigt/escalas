/**
 * Testes do helper unificado de limpeza R2 (achados R2-1..R2-4 da auditoria de
 * assinatura/R2 2026-07-11, e FLW-R2-004 da auditoria de fluxos).
 *
 * Cobrem:
 *  - coleta de chaves de um documento de escala (blob + conferência + selfie);
 *  - limpeza obsoleta pós-re-assinatura (só apaga o que saiu do conjunto novo);
 *  - deleção best-effort que engole falhas — E REGISTRA o que não saiu;
 *  - coleta da GISE combinando tabelas + conferências (prefixo PLANO) + varredura
 *    por prefixo, incluindo paginação (`truncated`).
 *
 * Os blocos que gravam pendência usam BANCO DE VERDADE: a propriedade sob teste
 * é o que fica no D1 depois que o R2 recusa, e um fake do drizzle provaria
 * apenas que uma função foi chamada.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	chavesR2DoDocumentoEscala,
	deletarChavesR2,
	limparR2ObsoletoEscala,
	reprocessarPendenciasR2,
	contarPendenciasR2,
	coletarChavesR2DaGise,
	type R2CleanupBucket
} from '../r2-cleanup';
import { chaveConferencia } from '../assinatura/copia-conferencia';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import type { Database } from '$lib/db';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

const pendencias = () =>
	sqlite
		.prepare('SELECT chave, origem, motivo, tentativas FROM r2_pendencias ORDER BY chave')
		.all() as {
		chave: string;
		origem: string;
		motivo: string;
		tentativas: number;
	}[];

/** Bucket que recusa exatamente as chaves listadas. */
function bucketQueRecusa(recusadas: string[]) {
	const deletados: string[] = [];
	const bucket: R2CleanupBucket = {
		delete: vi.fn(async (k) => {
			if (recusadas.includes(k as string)) throw new Error(`R2 recusou ${k}`);
			deletados.push(k as string);
		}),
		list: vi.fn()
	};
	return { bucket, deletados };
}

/** Bucket fake que registra deletes e serve `list` a partir de páginas dadas. */
function fakeBucket(
	paginas: { objects: { key: string }[]; truncated: boolean; cursor?: string }[] = []
) {
	const deletados: string[] = [];
	let i = 0;
	const bucket: R2CleanupBucket = {
		delete: vi.fn(async (keys: string | string[]) => {
			(Array.isArray(keys) ? keys : [keys]).forEach((k) => deletados.push(k));
		}),
		list: vi.fn(async () => paginas[i++] ?? { objects: [], truncated: false })
	};
	return { bucket, deletados };
}

describe('chavesR2DoDocumentoEscala', () => {
	it('reúne blob + conferência + selfie (ignora nulos)', () => {
		const chaves = chavesR2DoDocumentoEscala({
			r2_key: 'escalas/2026/1_ABCD-1234.pdf',
			verificacao_hash: 'ABCD-1234',
			selfie_key: 'escalas/2026/1/selfies/x.jpg'
		});
		expect(chaves).toEqual(
			new Set([
				'escalas/2026/1_ABCD-1234.pdf',
				chaveConferencia('ABCD-1234'),
				'escalas/2026/1/selfies/x.jpg'
			])
		);
	});

	it('documento sem selfie/hash gera só o blob', () => {
		const chaves = chavesR2DoDocumentoEscala({ r2_key: 'k.pdf' });
		expect([...chaves]).toEqual(['k.pdf']);
	});
});

describe('deletarChavesR2', () => {
	it('deduplica, ignora vazias e conta as REMOVIDAS', async () => {
		const { bucket, deletados } = fakeBucket();
		const r = await deletarChavesR2(db, bucket, ['a', 'a', '', null, undefined, 'b']);
		expect(r).toEqual({ removidas: 2, pendentes: 0 });
		expect(new Set(deletados)).toEqual(new Set(['a', 'b']));
	});

	it('best-effort: uma falha não impede as outras nem lança', async () => {
		const { bucket, deletados } = bucketQueRecusa(['boom']);
		const r = await deletarChavesR2(db, bucket, ['ok1', 'boom', 'ok2']);
		// Antes o retorno era 3, "as tentadas" — um número que não distingue o
		// objeto que saiu do bucket daquele que ficou lá para sempre.
		expect(r).toEqual({ removidas: 2, pendentes: 1 });
		expect(new Set(deletados)).toEqual(new Set(['ok1', 'ok2']));
	});

	it('a chave que resistiu vira pendência durável, com origem e motivo', async () => {
		// É o coração de FLW-R2-004: logo depois desta chamada o chamador apaga a
		// linha que guardava o `r2_key`. Se a chave não for capturada AQUI, o
		// objeto — PDF forense ou selfie biométrica — fica no bucket sem nenhuma
		// referência no sistema.
		const { bucket } = bucketQueRecusa(['fantasma.pdf']);
		await deletarChavesR2(db, bucket, ['ok', 'fantasma.pdf'], 'exclusao-gise');

		expect(pendencias()).toEqual([
			{
				chave: 'fantasma.pdf',
				origem: 'exclusao-gise',
				motivo: 'R2 recusou fantasma.pdf',
				tentativas: 0
			}
		]);
	});

	it('a mesma chave falhando de novo conta tentativa, não duplica', async () => {
		const { bucket } = bucketQueRecusa(['teimosa.pdf']);
		await deletarChavesR2(db, bucket, ['teimosa.pdf'], 'reassinatura-escala');
		await deletarChavesR2(db, bucket, ['teimosa.pdf'], 'reassinatura-escala');

		const linhas = pendencias();
		expect(linhas).toHaveLength(1);
		expect(linhas[0].tentativas, 'o contador é o que separa transitório de permanente').toBe(1);
	});

	it('chave que saiu do bucket deixa de ser pendência', async () => {
		// Sem isto, uma falha transitória deixaria a pendência para sempre e o
		// contador viraria ruído.
		const recusadas = ['intermitente.pdf'];
		const bucket: R2CleanupBucket = {
			delete: vi.fn(async (k) => {
				if (recusadas.includes(k as string)) throw new Error('indisponível');
			}),
			list: vi.fn()
		};
		await deletarChavesR2(db, bucket, ['intermitente.pdf'], 'gise');
		expect(await contarPendenciasR2(db)).toBe(1);

		recusadas.length = 0; // o R2 voltou
		await deletarChavesR2(db, bucket, ['intermitente.pdf'], 'gise');
		expect(await contarPendenciasR2(db)).toBe(0);
	});
});

describe('reprocessarPendenciasR2', () => {
	it('drena o que voltou a ser apagável', async () => {
		const recusadas = ['a.pdf', 'b.pdf'];
		const bucket: R2CleanupBucket = {
			delete: vi.fn(async (k) => {
				if (recusadas.includes(k as string)) throw new Error('indisponível');
			}),
			list: vi.fn()
		};
		await deletarChavesR2(db, bucket, ['a.pdf', 'b.pdf'], 'gise');
		expect(await contarPendenciasR2(db)).toBe(2);

		recusadas.length = 0;
		expect(await reprocessarPendenciasR2(db, bucket)).toEqual({ removidas: 2, pendentes: 0 });
		expect(await contarPendenciasR2(db)).toBe(0);
	});

	it('a que falha de novo FICA na fila, com a tentativa contada', async () => {
		const { bucket } = bucketQueRecusa(['permanente.pdf']);
		await deletarChavesR2(db, bucket, ['permanente.pdf'], 'gise');

		expect(await reprocessarPendenciasR2(db, bucket)).toEqual({ removidas: 0, pendentes: 1 });
		const [linha] = pendencias();
		expect(linha.tentativas).toBe(1);
	});

	it('sem bucket não inventa progresso', async () => {
		expect(await reprocessarPendenciasR2(db, null)).toEqual({ removidas: 0, pendentes: 0 });
	});
});

describe('limparR2ObsoletoEscala (R2-4)', () => {
	it('apaga só as chaves antigas que saíram do conjunto novo', async () => {
		const { bucket, deletados } = fakeBucket();
		const docAntigo = {
			r2_key: 'escalas/2026/1_OLD.pdf',
			verificacao_hash: 'OLD',
			selfie_key: 'escalas/2026/1/selfies/old.jpg'
		};
		// Nova assinatura: blob + conferência novos (selfie não reaproveitada).
		const chavesNovas = ['escalas/2026/1_NEW.pdf', chaveConferencia('NEW')];
		const r = await limparR2ObsoletoEscala(db, bucket, docAntigo, chavesNovas);
		expect(r).toEqual({ removidas: 3, pendentes: 0 });
		expect(new Set(deletados)).toEqual(
			new Set(['escalas/2026/1_OLD.pdf', chaveConferencia('OLD'), 'escalas/2026/1/selfies/old.jpg'])
		);
	});

	it('não apaga uma chave reaproveitada pela nova assinatura', async () => {
		const { bucket, deletados } = fakeBucket();
		const docAntigo = { r2_key: 'mesmo.pdf', verificacao_hash: 'H' };
		// A nova gravação reusa exatamente as mesmas chaves → nada a apagar.
		const r = await limparR2ObsoletoEscala(db, bucket, docAntigo, [
			'mesmo.pdf',
			chaveConferencia('H')
		]);
		expect(r).toEqual({ removidas: 0, pendentes: 0 });
		expect(deletados).toEqual([]);
	});

	it('no-op quando não havia documento anterior (1ª assinatura)', async () => {
		const { bucket } = fakeBucket();
		expect(await limparR2ObsoletoEscala(db, bucket, null, ['nova.pdf'])).toEqual({
			removidas: 0,
			pendentes: 0
		});
	});
});

describe('coletarChavesR2DaGise (R2-2/R2-3)', () => {
	/**
	 * fakeDb devolve linhas por tabela via um mapa nome→linhas. O helper usa
	 * `.select({...}).from(tabela).where(...).all()` — replicamos essa cadeia,
	 * identificando a tabela pelo objeto Drizzle importado.
	 */
	function fakeDb(porTabela: Map<unknown, Record<string, unknown>[]>): Database {
		const select = () => ({
			from: (table: unknown) => ({
				where: () => ({ all: async () => porTabela.get(table) ?? [] })
			})
		});
		return { select } as unknown as Database;
	}

	it('combina tabelas + conferências (prefixo plano) + varredura paginada', async () => {
		const { giseDocumentos, gisePresencas, giseAssinaturasRelatorios, gisePresencaTermos } =
			await import('../schema');

		const porTabela = new Map<unknown, Record<string, unknown>[]>([
			[giseDocumentos, [{ r2: 'blobDoc', selfie: 'selfieDoc', hash: 'HD' }]],
			[gisePresencas, [{ entrada: 'selfieEntrada', saida: null }]],
			[giseAssinaturasRelatorios, [{ selfie: 'selfieRel', r2: 'blobRel', hash: 'HR' }]],
			[gisePresencaTermos, [{ r2: 'blobTermo', hash: 'HT' }]]
		]);
		const db = fakeDb(porTabela);

		// Duas páginas de list (testa o loop `while (truncated)`).
		const { bucket } = fakeBucket([
			{ objects: [{ key: 'gise/2026-05/17/9/escala/a.pdf' }], truncated: true, cursor: 'c1' },
			{ objects: [{ key: 'gise/2026-05/17/9/selfies/b.jpg' }], truncated: false }
		]);

		const chaves = await coletarChavesR2DaGise(db, bucket, { id: 9, data_inicio: '2026-05-17' });

		// Conferências (prefixo PLANO) coletadas a partir dos hashes — o furo que a
		// varredura por prefixo não cobria.
		expect(chaves.has(chaveConferencia('HD'))).toBe(true);
		expect(chaves.has(chaveConferencia('HR'))).toBe(true);
		expect(chaves.has(chaveConferencia('HT'))).toBe(true);
		// Blobs e selfies das tabelas.
		for (const k of [
			'blobDoc',
			'selfieDoc',
			'selfieEntrada',
			'selfieRel',
			'blobRel',
			'blobTermo'
		]) {
			expect(chaves.has(k)).toBe(true);
		}
		// Objetos das duas páginas do prefixo.
		expect(chaves.has('gise/2026-05/17/9/escala/a.pdf')).toBe(true);
		expect(chaves.has('gise/2026-05/17/9/selfies/b.jpg')).toBe(true);
		// `saida` nula não entra.
		expect([...chaves].some((k) => k === null || k === '')).toBe(false);
	});

	it('degrada sem lançar quando o list do R2 falha (mantém as chaves das tabelas)', async () => {
		const { giseDocumentos, gisePresencas, giseAssinaturasRelatorios, gisePresencaTermos } =
			await import('../schema');
		const porTabela = new Map<unknown, Record<string, unknown>[]>([
			[giseDocumentos, [{ r2: 'blobDoc', selfie: null, hash: null }]],
			[gisePresencas, []],
			[giseAssinaturasRelatorios, []],
			[gisePresencaTermos, []]
		]);
		const db = fakeDb(porTabela);
		const bucket: R2CleanupBucket = {
			delete: vi.fn(),
			list: vi.fn(async () => {
				throw new Error('R2 list falhou');
			})
		};
		const chaves = await coletarChavesR2DaGise(db, bucket, { id: 1, data_inicio: '2026-01-02' });
		expect(chaves.has('blobDoc')).toBe(true);
	});
});
