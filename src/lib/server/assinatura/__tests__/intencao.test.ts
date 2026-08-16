/**
 * A intenção de assinatura contra um SQLite REAL — FLW-DOC-001.
 *
 * O que estes casos protegem é a única coisa que a verificação criptográfica
 * NÃO consegue provar: que o PDF que voltou do cliente é o documento que o
 * servidor preparou, para aquele alvo, por aquela pessoa, uma vez só. A
 * assinatura pode estar perfeita e o CPF conferir — e o documento ser outro.
 *
 * Banco de verdade porque o uso único é o `UPDATE ... WHERE usado = 0` do
 * próprio SQLite, como nos outros segredos de uso único do projeto.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import {
	criarIntencaoAssinatura,
	consumirIntencaoAssinatura,
	type AlvoAssinatura,
	type AtorAssinatura
} from '../intencao';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);
const OUTRO_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 9, 9, 9]);
const HASH_PUBLICO = 'B48T-4N22';

const ESCALA_7: AlvoAssinatura = { recurso: 'escala', recursoId: 7 };
const ATOR: AtorAssinatura = { id: 42, tipo: 'policial' };

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

async function prepararEm(alvo: AlvoAssinatura, ator = ATOR, pdf = PDF) {
	return criarIntencaoAssinatura(db, alvo, ator, pdf, HASH_PUBLICO);
}

describe('caminho feliz', () => {
	it('consome e devolve o código de validação do SERVIDOR', async () => {
		const token = await prepararEm(ESCALA_7);
		await expect(consumirIntencaoAssinatura(db, token, ESCALA_7, ATOR, PDF)).resolves.toEqual({
			ok: true,
			verificacaoHash: HASH_PUBLICO,
			// Preparação por token não carrega contexto: selfie e GPS só existem
			// quando o `preparar` da assinatura em tela os produziu.
			contexto: { selfieKey: null, latitude: null, longitude: null, rubrica: null }
		});
	});

	it('o token em claro nunca chega ao banco', async () => {
		const token = await prepararEm(ESCALA_7);
		const guardado = (
			sqlite.prepare('SELECT token FROM assinatura_intencoes').get() as { token: string }
		).token;
		expect(guardado).not.toBe(token);
		expect(guardado.startsWith('sha256:')).toBe(true);
	});
});

describe('alvo — preparar em A, finalizar em B', () => {
	it('outro id do MESMO recurso é recusado', async () => {
		const token = await prepararEm(ESCALA_7);
		await expect(
			consumirIntencaoAssinatura(db, token, { recurso: 'escala', recursoId: 8 }, ATOR, PDF)
		).resolves.toEqual({ ok: false, motivo: 'alvo-divergente' });
	});

	it('mesmo id de OUTRO recurso é recusado', async () => {
		// `escala 7` e `gise 7` coexistem: sem o campo `recurso`, o id sozinho
		// deixaria o PDF de uma virar documento assinado da outra.
		const token = await prepararEm(ESCALA_7);
		await expect(
			consumirIntencaoAssinatura(db, token, { recurso: 'gise', recursoId: 7 }, ATOR, PDF)
		).resolves.toEqual({ ok: false, motivo: 'alvo-divergente' });
	});

	it('relatório: a seccional faz parte do alvo', async () => {
		const alvo: AlvoAssinatura = { recurso: 'gise_relatorio', recursoId: 90, escopoId: 71 };
		const token = await prepararEm(alvo);

		await expect(
			consumirIntencaoAssinatura(db, token, { ...alvo, escopoId: 72 }, ATOR, PDF)
		).resolves.toEqual({ ok: false, motivo: 'alvo-divergente' });
	});

	it('presença: entrada e saída são alvos distintos', async () => {
		const entrada: AlvoAssinatura = { recurso: 'gise_presenca', recursoId: 12, escopoId: 1 };
		const token = await prepararEm(entrada);

		await expect(
			consumirIntencaoAssinatura(
				db,
				token,
				{ recurso: 'gise_presenca', recursoId: 12, escopoId: 2 },
				ATOR,
				PDF
			)
		).resolves.toEqual({ ok: false, motivo: 'alvo-divergente' });
	});

	it('escopo ausente e escopo nulo são o mesmo alvo', async () => {
		// A escala não tem segundo eixo; `undefined` no preparar e `null` no
		// finalizar não podem virar divergência por detalhe de tipagem.
		const token = await prepararEm({ recurso: 'escala', recursoId: 7 });
		await expect(
			consumirIntencaoAssinatura(
				db,
				token,
				{ recurso: 'escala', recursoId: 7, escopoId: null },
				ATOR,
				PDF
			)
		).resolves.toEqual({
			ok: true,
			verificacaoHash: HASH_PUBLICO,
			contexto: { selfieKey: null, latitude: null, longitude: null, rubrica: null }
		});
	});
});

describe('ator', () => {
	it('outra pessoa não finaliza a preparação alheia', async () => {
		const token = await prepararEm(ESCALA_7);
		await expect(
			consumirIntencaoAssinatura(db, token, ESCALA_7, { id: 99, tipo: 'policial' }, PDF)
		).resolves.toEqual({ ok: false, motivo: 'ator-divergente' });
	});

	it('mesmo id, outro TIPO de conta, também é outra pessoa', async () => {
		// `policiais.id = 42` e `administradores.id = 42` são pessoas distintas.
		const token = await prepararEm(ESCALA_7);
		await expect(
			consumirIntencaoAssinatura(db, token, ESCALA_7, { id: 42, tipo: 'admin' }, PDF)
		).resolves.toEqual({ ok: false, motivo: 'ator-divergente' });
	});
});

describe('conteúdo', () => {
	it('PDF diferente do preparado é recusado', async () => {
		// Assinar o digest de um PDF e mandar outro no corpo — o que a
		// verificação do CMS sozinha não pega.
		const token = await prepararEm(ESCALA_7);
		await expect(consumirIntencaoAssinatura(db, token, ESCALA_7, ATOR, OUTRO_PDF)).resolves.toEqual(
			{ ok: false, motivo: 'documento-divergente' }
		);
	});
});

describe('uso único', () => {
	it('a segunda finalização falha', async () => {
		const token = await prepararEm(ESCALA_7);
		await consumirIntencaoAssinatura(db, token, ESCALA_7, ATOR, PDF);
		await expect(consumirIntencaoAssinatura(db, token, ESCALA_7, ATOR, PDF)).resolves.toEqual({
			ok: false,
			motivo: 'invalida'
		});
	});

	it('em paralelo, exatamente uma ganha', async () => {
		const token = await prepararEm(ESCALA_7);
		const r = await Promise.all([
			consumirIntencaoAssinatura(db, token, ESCALA_7, ATOR, PDF),
			consumirIntencaoAssinatura(db, token, ESCALA_7, ATOR, PDF),
			consumirIntencaoAssinatura(db, token, ESCALA_7, ATOR, PDF)
		]);
		expect(r.filter((x) => x.ok)).toHaveLength(1);
	});

	it('alvo errado QUEIMA a intenção — não dá para varrer recursos', async () => {
		// Deliberado: o UPDATE condicional vem antes da conferência de alvo.
		// Deixar a intenção viva permitiria tentar id por id até um aceitar.
		const token = await prepararEm(ESCALA_7);
		await consumirIntencaoAssinatura(db, token, { recurso: 'escala', recursoId: 8 }, ATOR, PDF);

		await expect(consumirIntencaoAssinatura(db, token, ESCALA_7, ATOR, PDF)).resolves.toEqual({
			ok: false,
			motivo: 'invalida'
		});
	});

	it('consumir uma não afeta as outras', async () => {
		const t1 = await prepararEm(ESCALA_7);
		const t2 = await prepararEm({ recurso: 'escala', recursoId: 8 });

		await consumirIntencaoAssinatura(db, t1, ESCALA_7, ATOR, PDF);

		await expect(
			consumirIntencaoAssinatura(db, t2, { recurso: 'escala', recursoId: 8 }, ATOR, PDF)
		).resolves.toMatchObject({ ok: true });
	});
});

describe('validade', () => {
	it('expirada é recusada e NÃO é consumida', async () => {
		const token = await prepararEm(ESCALA_7);
		sqlite
			.prepare('UPDATE assinatura_intencoes SET expires_at = ?')
			.run(new Date(Date.now() - 60_000).toISOString());

		await expect(consumirIntencaoAssinatura(db, token, ESCALA_7, ATOR, PDF)).resolves.toEqual({
			ok: false,
			motivo: 'invalida'
		});
		const usado = (
			sqlite.prepare('SELECT usado FROM assinatura_intencoes').get() as { usado: number }
		).usado;
		expect(usado).toBe(0);
	});

	it('token ausente ou desconhecido é recusado sem lançar', async () => {
		await expect(consumirIntencaoAssinatura(db, undefined, ESCALA_7, ATOR, PDF)).resolves.toEqual({
			ok: false,
			motivo: 'ausente'
		});
		await expect(
			consumirIntencaoAssinatura(db, 'f'.repeat(64), ESCALA_7, ATOR, PDF)
		).resolves.toEqual({ ok: false, motivo: 'invalida' });
	});
});

describe('contexto do preparo', () => {
	it('devolve selfie, GPS e rubrica gravados pelo preparar', async () => {
		const token = await criarIntencaoAssinatura(db, ESCALA_7, ATOR, PDF, HASH_PUBLICO, {
			selfieKey: 'gise/2026-08/16/1/selfies/abc.jpg',
			latitude: -3.7,
			longitude: -38.5,
			rubrica: 'data:image/png;base64,AAAA'
		});
		await expect(consumirIntencaoAssinatura(db, token, ESCALA_7, ATOR, PDF)).resolves.toEqual({
			ok: true,
			verificacaoHash: HASH_PUBLICO,
			contexto: {
				selfieKey: 'gise/2026-08/16/1/selfies/abc.jpg',
				latitude: -3.7,
				longitude: -38.5,
				rubrica: 'data:image/png;base64,AAAA'
			}
		});
	});
});
