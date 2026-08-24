/**
 * Roundtrip do INSERT em `gise_assinaturas_relatorios` com as colunas
 * `webauthn_*` (migração 0060). O spy do upsert prova que INSERT e UPDATE
 * têm as mesmas chaves; este teste prova que o SQL roda no schema real —
 * A3 e avançada em tela gravam `null` nessas colunas, e "no such column"
 * só aparecia no e2e.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { salvarAssinaturaRelatorioGise } from '../assinaturas';
import type { Database } from '$lib/db';

let sqlite: ReturnType<typeof bancoMigrado>;
let db: Database;

const GISE = 93001;
const UNID = 93101;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO unidades (id, nome, tipo) VALUES (${UNID}, 'SECCIONAL TESTE', 'seccional');
		INSERT INTO gise_escalas (id, data_inicio, status)
		VALUES (${GISE}, '2026-08-10', 'em_andamento');
	`);
});

function colunasWebauthn() {
	return sqlite
		.prepare(
			`SELECT webauthn_credential_id, webauthn_client_data, webauthn_assinatura, webauthn_backup_ativo
			 FROM gise_assinaturas_relatorios WHERE gise_id = ${GISE}`
		)
		.get() as {
		webauthn_credential_id: string | null;
		webauthn_client_data: string | null;
		webauthn_assinatura: string | null;
		webauthn_backup_ativo: number | null;
	};
}

describe('salvarAssinaturaRelatorioGise × colunas webauthn_*', () => {
	it('A3 / tela sem passkey grava null — o INSERT não estoura', async () => {
		await salvarAssinaturaRelatorioGise(db, {
			gise_id: GISE,
			seccional_id: UNID,
			tipo: 'extraordinario',
			assinante_nome: 'SUPERVISOR',
			tipo_assinatura: 'serpro',
			verification_hash: 'hash-a3'
		});
		const row = colunasWebauthn();
		expect(row.webauthn_credential_id).toBeNull();
		expect(row.webauthn_client_data).toBeNull();
		expect(row.webauthn_assinatura).toBeNull();
		expect(row.webauthn_backup_ativo).toBeNull();
	});

	it('com passkeyMeta grava a asserção; reassinatura sem ela zera', async () => {
		const primeira = await salvarAssinaturaRelatorioGise(db, {
			gise_id: GISE,
			seccional_id: UNID,
			tipo: 'extraordinario',
			assinante_nome: 'SUPERVISOR',
			tipo_assinatura: 'simples',
			verification_hash: 'hash-pk',
			passkeyMeta: {
				credential_id: 'cred-1',
				client_data: 'cd',
				authenticator_data: 'ad',
				assinatura: 'sig',
				backup_ativo: false
			}
		});
		expect(primeira.gravado).toBe(true);
		expect(colunasWebauthn()).toMatchObject({
			webauthn_credential_id: 'cred-1',
			webauthn_client_data: 'cd',
			webauthn_assinatura: 'sig',
			webauthn_backup_ativo: 0
		});

		const recusada = await salvarAssinaturaRelatorioGise(db, {
			gise_id: GISE,
			seccional_id: UNID,
			tipo: 'extraordinario',
			assinante_nome: 'SUPERVISOR',
			tipo_assinatura: 'serpro',
			verification_hash: 'hash-a3-depois'
		});
		expect(recusada.gravado).toBe(false);
		expect(colunasWebauthn().webauthn_credential_id).toBe('cred-1');

		sqlite.exec(`DELETE FROM gise_assinaturas_relatorios WHERE gise_id = ${GISE}`);
		const nova = await salvarAssinaturaRelatorioGise(db, {
			gise_id: GISE,
			seccional_id: UNID,
			tipo: 'extraordinario',
			assinante_nome: 'SUPERVISOR',
			tipo_assinatura: 'serpro',
			verification_hash: 'hash-a3-depois'
		});
		expect(nova.gravado).toBe(true);
		const row = colunasWebauthn();
		expect(row.webauthn_credential_id).toBeNull();
		expect(row.webauthn_backup_ativo).toBeNull();
	});
});
