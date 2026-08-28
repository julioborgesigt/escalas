/**
 * O NÍVEL do termo de presença que `/validar` publica.
 *
 * `gise_presenca_termos` recebe linha dos DOIS fluxos que produzem termo:
 *
 *   - Token A3 → `cms_sha256` gravado pelo cades-finalizer (certificado do
 *     TITULAR embutido no PDF) ⇒ qualificado;
 *   - passkey  → colunas `webauthn_*`, PDF selado com a chave INSTITUCIONAL
 *     ⇒ avançado (Lei 14.063/2020 art. 4º II).
 *
 * `buscarDocumentoPorHash` devolvia `tipo_assinatura: 'serpro'` fixo para as
 * duas, e a página pública estampa "ICP-Brasil" para webpki/serpro — então o
 * termo assinado por passkey aparecia ao cidadão como ICP-Brasil, sem que
 * existisse certificado ICP nenhum no documento.
 *
 * Banco real: o que está sob teste é a linha que o SQL devolve, não a forma da
 * consulta.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import type { Database } from '$lib/db';
import { salvarTermoPresencaGise } from '$lib/db/gise/assinaturas';
import { criarGiseEscala } from '$lib/db/gise/escalas-crud';
import { buscarDocumentoPorHash } from '$lib/db/documentos';

describe('buscarDocumentoPorHash — nível do termo de presença', () => {
	let db: Database;
	let giseId: number;

	beforeEach(async () => {
		db = drizzleSobre(bancoMigrado());
		giseId = await criarGiseEscala(db, '2026-08-20', '19:00', '07:00');
	});

	it('termo do Token A3 (com cms_sha256) é qualificado — serpro', async () => {
		await salvarTermoPresencaGise(db, {
			gise_id: giseId,
			policial_id: 10,
			tipo: 'entrada',
			assinante_nome: 'FULANO A3',
			verification_hash: 'AAAA-1111',
			cms_sha256: 'a'.repeat(64),
			cert_issuer: 'AC Teste ICP-Brasil'
		});

		const doc = await buscarDocumentoPorHash(db, 'AAAA-1111');

		expect(doc?.tipo_doc).toBe('gise_presenca');
		expect((doc as { tipo_assinatura: string }).tipo_assinatura).toBe('serpro');
	});

	it('termo da passkey (sem cms_sha256) é avançado — NUNCA serpro', async () => {
		await salvarTermoPresencaGise(db, {
			gise_id: giseId,
			policial_id: 11,
			tipo: 'entrada',
			assinante_nome: 'BELTRANO PASSKEY',
			verification_hash: 'BBBB-2222',
			passkeyMeta: {
				credential_id: 'cred-abc',
				client_data: 'e30',
				authenticator_data: 'e30',
				assinatura: 'e30',
				backup_ativo: true
			}
		});

		const doc = await buscarDocumentoPorHash(db, 'BBBB-2222');

		expect(doc?.tipo_doc).toBe('gise_presenca');
		// 'serpro' aqui faria `/validar` estampar o selo ICP-Brasil num documento
		// que carrega o selo institucional, não certificado do titular.
		expect((doc as { tipo_assinatura: string }).tipo_assinatura).toBe('simples');
		// A credencial continua disponível para o recorte de chave da página.
		expect((doc as { webauthn_credential_id: string | null }).webauthn_credential_id).toBe(
			'cred-abc'
		);
	});
});
