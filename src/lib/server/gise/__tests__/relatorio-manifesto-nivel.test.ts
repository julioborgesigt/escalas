/**
 * O NÍVEL que o manifesto do Relatório Extraordinário atribui a cada
 * confirmação de presença.
 *
 * `gise_presenca_termos` recebe linha dos DOIS fluxos que geram termo — Token
 * A3 e passkey —, então "existe termo" não responde "é qualificada". A regra
 * era `qualificada = !!termo`, e com `exigir_passkey_assinatura` ligada isso
 * imprimia **QUALIFICADA · ICP-BRASIL** sobre uma assinatura avançada, num
 * documento que a corporação entrega e que alguém pode periciar. Quem decide é
 * o `cms_sha256` — só o cades-finalizer o grava, a partir do CMS do
 * certificado do titular.
 *
 * O terceiro caso é o um-tiro (tela/mobile sem passkey): não gera termo, então
 * o identificador é o pseudo-hash `PRES-<id>-<E|S>`, que NÃO resolve em
 * `/validar` — daí `identificadorValidavel: false`.
 *
 * Usa o caminho da SUPERVISÃO EXTRA de propósito: ali a lista de participantes
 * sai de `listarPoliciaisSupervisaoExtra` (função pura sobre a GISE), e o único
 * acesso a banco que sobra é o dos termos — que é justamente o que está sob
 * teste.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import type { Database, GiseDetalhado } from '$lib/db';
import { criarGiseEscala } from '$lib/db/gise/escalas-crud';
import { salvarTermoPresencaGise } from '$lib/db/gise/assinaturas';
import { montarSignersPresencaExtra } from '../relatorio-manifesto';

const A3 = 10;
const PASSKEY = 11;
const UM_TIRO = 12;

/** Linha de `gise_presencas` com o mínimo que o manifesto lê. */
function presenca(id: number, policialId: number, nome: string) {
	return {
		id,
		policial_id: policialId,
		policial_nome: nome,
		policial_cpf: null,
		entrada_timestamp: '2026-08-20T22:00:00.000Z',
		saida_timestamp: null,
		entrada_selfie_key: null,
		saida_selfie_key: null,
		ip_address: '198.51.100.0',
		user_agent: 'Mozilla/5.0 (iPhone)',
		latitude: null,
		longitude: null
	};
}

describe('montarSignersPresencaExtra — nível de cada confirmação', () => {
	let db: Database;
	let giseId: number;

	beforeEach(async () => {
		db = drizzleSobre(bancoMigrado());
		giseId = await criarGiseEscala(db, '2026-08-20', '19:00', '07:00');

		// Token A3: cades-finalizer gravou o CMS do certificado do titular.
		await salvarTermoPresencaGise(db, {
			gise_id: giseId,
			policial_id: A3,
			tipo: 'entrada',
			assinante_nome: 'FULANO A3',
			verification_hash: 'AAAA-1111',
			cms_sha256: 'a'.repeat(64),
			cert_issuer: 'AC Teste ICP-Brasil'
		});

		// Passkey: mesma tabela, sem CMS — o PDF leva o selo institucional.
		await salvarTermoPresencaGise(db, {
			gise_id: giseId,
			policial_id: PASSKEY,
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
	});

	async function montar() {
		const gise = {
			id: giseId,
			supervisor_id: A3,
			assessor_id: PASSKEY,
			seint1_id: UM_TIRO,
			seint2_id: null
		} as unknown as GiseDetalhado;

		return montarSignersPresencaExtra({
			db,
			gise,
			giseId,
			secIdNum: 1,
			isSupervisaoExtra: true,
			platform: undefined,
			presencas: [
				presenca(1, A3, 'FULANO A3'),
				presenca(2, PASSKEY, 'BELTRANO PASSKEY'),
				presenca(3, UM_TIRO, 'CICLANO TELA')
			] as unknown as Parameters<typeof montarSignersPresencaExtra>[0]['presencas'],
			documentHash: 'f'.repeat(64),
			origin: 'https://exemplo.test',
			documentName: 'Relatório Extraordinário - GISE 1'
		});
	}

	it('Token A3 é qualificada e leva o hash do próprio termo', async () => {
		const signers = await montar();
		const s = signers.find((x) => x.signerName.startsWith('FULANO A3'));

		expect(s?.signatureLevel).toBe('qualificada');
		expect(s?.verificationHash).toBe('AAAA-1111');
		expect(s?.identificadorValidavel).toBe(true);
	});

	it('passkey é AVANÇADA — nunca qualificada, porque não há certificado ICP', async () => {
		const signers = await montar();
		const s = signers.find((x) => x.signerName.startsWith('BELTRANO PASSKEY'));

		// O cartão "QUALIFICADA · ICP-BRASIL" aqui seria afirmação falsa: a
		// passkey não tem certificado, e o PDF do termo leva o selo da instituição.
		expect(s?.signatureLevel).toBe('avancada');
		// Mas o termo EXISTE e resolve em /validar — o identificador é o dele.
		expect(s?.verificationHash).toBe('BBBB-2222');
		expect(s?.identificadorValidavel).toBe(true);
	});

	it('um-tiro (sem termo) é avançada e marca o identificador como não-validável', async () => {
		const signers = await montar();
		const s = signers.find((x) => x.signerName.startsWith('CICLANO TELA'));

		expect(s?.signatureLevel).toBe('avancada');
		expect(s?.verificationHash).toBe('PRES-3-E');
		expect(s?.identificadorValidavel).toBe(false);
	});
});
