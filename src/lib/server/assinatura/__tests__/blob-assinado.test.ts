/**
 * Sem onde guardar, não assina — FLW-R2-003.
 *
 * Os seis finalizadores tratavam o R2 como opcional (`if (r2) put`) e gravavam a
 * linha de qualquer jeito. Sem bucket, o certificado era consumido, o hash de
 * verificação era emitido e impresso no documento, e `/validar` passava a
 * resolver esse hash para um arquivo que não existe — do lado de quem confere,
 * indistinguível de um documento adulterado.
 *
 * A assimetria é a razão da regra: recusar antes é reversível (a pessoa tenta
 * de novo em dez minutos); assinar e não guardar não é.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import {
	bucketParaAssinatura,
	compensarBlobAssinado,
	guardarPdfAssinado,
	type R2ParaAssinatura
} from '../blob-assinado';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

function bucketFalso(falhar = false) {
	const gravadas: string[] = [];
	const apagadas: string[] = [];
	const r2: R2ParaAssinatura = {
		put: vi.fn(async (k: string) => {
			if (falhar) throw new Error('R2 fora do ar');
			gravadas.push(k);
		}),
		delete: vi.fn(async (k) => {
			apagadas.push(k as string);
		}),
		list: vi.fn(async () => ({ objects: [], truncated: false }))
	};
	return { r2, gravadas, apagadas };
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

describe('bucketParaAssinatura', () => {
	it('sem bucket, RECUSA com 503 e código de upstream', async () => {
		const r = bucketParaAssinatura(undefined);
		expect(r.ok).toBe(false);
		if (r.ok) throw new Error('inalcançável');

		expect(r.resposta.status).toBe(503);
		const corpo = await r.resposta.json();
		// 503 + `upstream` diz ao cliente que é infra e vale tentar de novo —
		// diferente de 500, que o front trata como erro definitivo.
		expect(corpo.errorType).toBe('upstream');
		expect(corpo.error, 'a mensagem tem de afirmar que NÃO assinou').toContain('não foi realizada');
	});

	it('com bucket, devolve o bucket', () => {
		const { r2 } = bucketFalso();
		const r = bucketParaAssinatura(r2);
		expect(r.ok).toBe(true);
		if (!r.ok) throw new Error('inalcançável');
		expect(r.r2).toBe(r2);
	});

	it('null é tratado como ausente', () => {
		expect(bucketParaAssinatura(null).ok).toBe(false);
	});
});

describe('guardarPdfAssinado', () => {
	it('grava e confirma', async () => {
		const { r2, gravadas } = bucketFalso();
		await expect(guardarPdfAssinado(r2, 'doc.pdf', PDF, 'teste')).resolves.toEqual({ ok: true });
		expect(gravadas).toEqual(['doc.pdf']);
	});

	it('`put` que falha vira RECUSA, não sucesso silencioso', async () => {
		// O `if (r2)` anterior não cobria este caso: com o binding presente, a
		// exceção do `put` subia para o catch genérico do endpoint — que em alguns
		// caminhos já tinha gravado a linha.
		const { r2 } = bucketFalso(true);
		const r = await guardarPdfAssinado(r2, 'doc.pdf', PDF, 'teste');
		expect(r.ok).toBe(false);
		if (r.ok) throw new Error('inalcançável');
		expect(r.resposta.status).toBe(500);
	});
});

describe('compensarBlobAssinado', () => {
	it('remove o blob órfão quando a persistência falha depois do put', async () => {
		const { r2, apagadas } = bucketFalso();
		await compensarBlobAssinado(db, r2, ['doc.pdf', null, 'conferencia/H.pdf'], 'gise-escala');
		expect(new Set(apagadas)).toEqual(new Set(['doc.pdf', 'conferencia/H.pdf']));
	});

	it('o que resistir vira pendência durável, não some do radar', async () => {
		const r2: R2ParaAssinatura = {
			put: vi.fn(),
			delete: vi.fn(async () => {
				throw new Error('delete recusado');
			}),
			list: vi.fn(async () => ({ objects: [], truncated: false }))
		};
		await compensarBlobAssinado(db, r2, ['orfao.pdf'], 'gise-escala');

		const linhas = sqlite.prepare('SELECT chave, origem FROM r2_pendencias').all() as {
			chave: string;
			origem: string;
		}[];
		expect(linhas).toEqual([{ chave: 'orfao.pdf', origem: 'compensacao-gise-escala' }]);
	});
});
