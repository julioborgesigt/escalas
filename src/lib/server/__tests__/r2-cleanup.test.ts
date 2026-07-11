/**
 * Testes do helper unificado de limpeza R2 (achados R2-1..R2-4 da auditoria de
 * assinatura/R2 2026-07-11).
 *
 * Cobrem:
 *  - coleta de chaves de um documento de escala (blob + conferência + selfie);
 *  - limpeza obsoleta pós-re-assinatura (só apaga o que saiu do conjunto novo);
 *  - deleção best-effort que engole falhas;
 *  - coleta da GISE combinando tabelas + conferências (prefixo PLANO) + varredura
 *    por prefixo, incluindo paginação (`truncated`).
 */
import { describe, it, expect, vi } from 'vitest';
import {
	chavesR2DoDocumentoEscala,
	deletarChavesR2,
	limparR2ObsoletoEscala,
	coletarChavesR2DaGise,
	type R2CleanupBucket
} from '../r2-cleanup';
import { chaveConferencia } from '../copia-conferencia';
import type { Database } from '$lib/db';

/** Bucket fake que registra deletes e serve `list` a partir de páginas dadas. */
function fakeBucket(paginas: { objects: { key: string }[]; truncated: boolean; cursor?: string }[] = []) {
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
	it('deduplica, ignora vazias e conta as tentadas', async () => {
		const { bucket, deletados } = fakeBucket();
		const n = await deletarChavesR2(bucket, ['a', 'a', '', null, undefined, 'b']);
		expect(n).toBe(2);
		expect(new Set(deletados)).toEqual(new Set(['a', 'b']));
	});

	it('best-effort: uma falha não impede as outras nem lança', async () => {
		const deletados: string[] = [];
		const bucket: R2CleanupBucket = {
			delete: vi.fn(async (k) => {
				if (k === 'boom') throw new Error('falha R2');
				deletados.push(k as string);
			}),
			list: vi.fn()
		};
		const n = await deletarChavesR2(bucket, ['ok1', 'boom', 'ok2']);
		expect(n).toBe(3);
		expect(new Set(deletados)).toEqual(new Set(['ok1', 'ok2']));
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
		const n = await limparR2ObsoletoEscala(bucket, docAntigo, chavesNovas);
		expect(n).toBe(3);
		expect(new Set(deletados)).toEqual(
			new Set(['escalas/2026/1_OLD.pdf', chaveConferencia('OLD'), 'escalas/2026/1/selfies/old.jpg'])
		);
	});

	it('não apaga uma chave reaproveitada pela nova assinatura', async () => {
		const { bucket, deletados } = fakeBucket();
		const docAntigo = { r2_key: 'mesmo.pdf', verificacao_hash: 'H' };
		// A nova gravação reusa exatamente as mesmas chaves → nada a apagar.
		const n = await limparR2ObsoletoEscala(bucket, docAntigo, ['mesmo.pdf', chaveConferencia('H')]);
		expect(n).toBe(0);
		expect(deletados).toEqual([]);
	});

	it('no-op quando não havia documento anterior (1ª assinatura)', async () => {
		const { bucket } = fakeBucket();
		expect(await limparR2ObsoletoEscala(bucket, null, ['nova.pdf'])).toBe(0);
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
		const {
			giseDocumentos,
			gisePresencas,
			giseAssinaturasRelatorios,
			gisePresencaTermos
		} = await import('../schema');

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
		for (const k of ['blobDoc', 'selfieDoc', 'selfieEntrada', 'selfieRel', 'blobRel', 'blobTermo']) {
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
