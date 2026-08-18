/**
 * O portão das cinco rotas de assinatura da GISE.
 *
 * O arquivo existe pelas duas divergências que a extração de ago/2026 revelou —
 * cada uma vivia numa cópia diferente, e nenhuma era visível sem ler as cinco
 * lado a lado:
 *
 *   - `finalizar-assinatura` era a única SEM a checagem de status. Fechado ao
 *     entrar no portão, e é o que o teste "recusa GISE em status que não admite
 *     assinatura" trava para não voltar a abrir;
 *   - `preparar-assinatura` é a única que NÃO admite Admin Geral, e isso segue
 *     de propósito enquanto a contradição com `finalizar-assinatura` não for
 *     decidida (ver o JSDoc de `carregarGiseParaAssinatura`). O teste
 *     `admitirAdmin: false` fixa o comportamento ATUAL — se a decisão mudar, é
 *     este teste que tem de mudar junto, de propósito.
 *
 * Usa banco real porque o portão lê a GISE do D1 — um fake do query builder
 * testaria a forma da consulta, não o veredito.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import type { Database } from '$lib/db';
import { criarGiseEscala, atualizarGiseEscala } from '$lib/db/gise/escalas-crud';
import { carregarGiseParaAssinatura } from '../permissao';

const SUPERVISOR = { id: 10, tipo: 'policial' as const } as NonNullable<App.Locals['usuario']>;
const OUTRO_POLICIAL = { id: 11, tipo: 'policial' as const } as NonNullable<App.Locals['usuario']>;
const ADMIN = { id: 1, tipo: 'admin' as const } as NonNullable<App.Locals['usuario']>;

describe('carregarGiseParaAssinatura', () => {
	let db: Database;
	let giseId: number;

	beforeEach(async () => {
		db = drizzleSobre(bancoMigrado());
		giseId = await criarGiseEscala(db, '2026-08-20', '08:00', '16:00');
		await atualizarGiseEscala(db, giseId, {
			status: 'aguardando_assinatura',
			supervisor_id: SUPERVISOR.id
		});
	});

	it('aceita o supervisor designado', async () => {
		const r = await carregarGiseParaAssinatura(db, String(giseId), SUPERVISOR);
		expect(r.recusa).toBeUndefined();
		if (r.recusa) return;
		expect(r.gise.id).toBe(giseId);
		expect(r.id).toBe(giseId);
	});

	it('aceita Admin Geral por padrão', async () => {
		const r = await carregarGiseParaAssinatura(db, String(giseId), ADMIN);
		expect(r.recusa).toBeUndefined();
	});

	it('RECUSA Admin Geral quando `admitirAdmin: false` (o caso de preparar-assinatura)', async () => {
		const r = await carregarGiseParaAssinatura(db, String(giseId), ADMIN, {
			admitirAdmin: false
		});
		expect(r.recusa?.status).toBe(403);
	});

	it('RECUSA policial que não é o supervisor designado', async () => {
		const r = await carregarGiseParaAssinatura(db, String(giseId), OUTRO_POLICIAL);
		expect(r.recusa?.status).toBe(403);
	});

	it('RECUSA GISE em status que não admite assinatura', async () => {
		// A lacuna que `finalizar-assinatura` tinha: sem esta checagem, a intenção
		// emitida enquanto a GISE aceitava assinatura continuaria valendo por 15
		// minutos depois de ela ser finalizada.
		await atualizarGiseEscala(db, giseId, { status: 'finalizada' });

		const r = await carregarGiseParaAssinatura(db, String(giseId), SUPERVISOR);
		expect(r.recusa?.status).toBe(400);
	});

	it('aceita `em_andamento` — é o status que o próprio finalizar grava, e reassinar precisa passar', async () => {
		await atualizarGiseEscala(db, giseId, { status: 'em_andamento' });

		const r = await carregarGiseParaAssinatura(db, String(giseId), SUPERVISOR);
		expect(r.recusa).toBeUndefined();
	});

	it('404 para GISE inexistente e 400 para id não numérico', async () => {
		expect((await carregarGiseParaAssinatura(db, '999999', ADMIN)).recusa?.status).toBe(404);
		expect((await carregarGiseParaAssinatura(db, 'abc', ADMIN)).recusa?.status).toBe(400);
	});
});
