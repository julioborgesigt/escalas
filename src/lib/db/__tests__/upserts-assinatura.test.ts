import { describe, it, expect, vi } from 'vitest';
import { salvarGiseDocumento } from '../gise/documentos';
import { salvarAssinaturaRelatorioGise, salvarTermoPresencaGise } from '../gise/assinaturas';
import { salvarDocumentoEscala } from '../documentos';
import type { Database } from '../core';

/**
 * Os quatro pontos que gravam assinatura são upserts: os mesmos campos vão no
 * INSERT e no UPDATE. Antes cada um escrevia a lista duas vezes, lado a lado —
 * uma coluna acrescentada só no INSERT sobreviveria à primeira assinatura e
 * sumiria na reassinatura, sem erro nenhum. Estes testes travam os dois lados
 * como iguais.
 */
function dbEspiao() {
	const capturado: { values?: Record<string, unknown>; set?: Record<string, unknown> } = {};
	const onConflictDoUpdate = vi.fn((cfg: { set: Record<string, unknown> }) => {
		capturado.set = cfg.set;
		return Promise.resolve();
	});
	const values = vi.fn((v: Record<string, unknown>) => {
		capturado.values = v;
		return { onConflictDoUpdate };
	});
	const db = { insert: vi.fn(() => ({ values })) } as unknown as Database;
	return { db, capturado };
}

async function salvar(db: Database) {
	return salvarGiseDocumento(db, {
		giseId: 7,
		r2Key: 'gise/7/escala.pdf',
		assinanteId: 42,
		assinanteNome: 'FULANO DE TAL',
		assinanteCpf: '12345678901',
		verificacaoHash: 'hash-verificacao',
		rubrica: 'data:image/png;base64,rubrica',
		ipAddress: '203.0.113.42',
		userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
		latitude: -3.7319,
		longitude: -38.5267,
		selfieKey: 'gise/7/selfie.jpg',
		arquivoHash: 'sha256-do-arquivo',
		assinanteEmail: 'fulano@pc.ce.gov.br',
		tipoCarimboTempo: 'servidor'
	});
}

describe('salvarGiseDocumento (upsert)', () => {
	it('grava os mesmos campos no INSERT e no UPDATE', async () => {
		const { db, capturado } = dbEspiao();
		await salvar(db);

		const insert = { ...capturado.values };
		const update = { ...capturado.set };

		// `gise_id` é o alvo do conflito e não pode ser reescrito;
		// `created_at` só existe no UPDATE (reassinatura renova o carimbo).
		expect(insert.gise_id).toBe(7);
		expect(update.gise_id).toBeUndefined();
		expect(update.created_at).toBeDefined();

		delete insert.gise_id;
		delete update.created_at;
		expect(Object.keys(update).sort()).toEqual(Object.keys(insert).sort());
		expect(update).toEqual(insert);
	});

	it('anonimiza o IP e reduz a precisão do GPS antes de gravar', async () => {
		const { db, capturado } = dbEspiao();
		await salvar(db);

		expect(capturado.values?.ip_address).toBe('203.0.113.0');
		expect(capturado.values?.latitude).toBe(-3.73);
		expect(capturado.values?.longitude).toBe(-38.53);
	});
});

describe('salvarAssinaturaRelatorioGise (upsert)', () => {
	it('grava os mesmos campos no INSERT e no UPDATE, sem reescrever a chave', async () => {
		const { db, capturado } = dbEspiao();
		await salvarAssinaturaRelatorioGise(db, {
			gise_id: 3,
			seccional_id: 9,
			tipo: 'extraordinario',
			assinante_id: 11,
			assinante_nome: 'BELTRANA',
			assinante_cpf: '98765432100',
			tipo_assinatura: 'serpro',
			ip_address: '198.51.100.7',
			user_agent: 'Mozilla/5.0',
			latitude: -3.731944,
			longitude: -38.526667,
			r2_key: 'gise/3/extra-9.pdf'
		});

		const insert = { ...capturado.values };
		const update = { ...capturado.set };

		// A trinca do conflito só aparece no INSERT.
		for (const chave of ['gise_id', 'seccional_id', 'tipo']) {
			expect(insert[chave]).toBeDefined();
			expect(update[chave]).toBeUndefined();
			delete insert[chave];
		}
		delete update.created_at;
		expect(update).toEqual(insert);

		// Normalizações aplicadas uma vez, valendo para os dois lados.
		expect(insert.ip_address).toBe('198.51.100.0');
		expect(insert.latitude).toBe(-3.73);
		expect(insert.tipo_carimbo_tempo).toBe('servidor');
	});
});

/**
 * Reassinar tem que APAGAR o que a assinatura anterior deixou.
 *
 * O drizzle omite do `.set()` toda chave cujo valor é `undefined` — a coluna
 * simplesmente não entra no UPDATE e o valor ANTERIOR sobrevive. Numa
 * reassinatura isso é grave: um relatório assinado com certificado ICP-Brasil e
 * depois reassinado como `simples` (certificado vencido, por exemplo) ficava com
 * `tipo_assinatura = 'simples'` mas continuava carregando `cert_issuer`,
 * `cms_sha256`, `tst_token_b64` — e a selfie e o GPS — da assinatura que ele
 * substituiu. Prova de uma assinatura colada num registro de outra.
 *
 * Por isso todo campo opcional precisa chegar ao `set` como `null` EXPLÍCITO.
 * O teste de "INSERT igual a UPDATE" acima não pega isso: as duas listas vêm do
 * mesmo objeto, então concordam justamente na chave que falta nas duas.
 */
const LIMPAVEIS_COMUNS = [
	'assinante_email',
	'selfie_key',
	'arquivo_hash',
	'ip_address',
	'user_agent',
	'user_agent_raw',
	'latitude',
	'longitude',
	'cert_issuer',
	'cert_serial',
	'cert_valido_de',
	'cert_valido_ate',
	'cms_sha256',
	'ocsp_response_b64',
	'ocsp_consultado_em',
	'tst_token_b64'
];

/** Asserção WebAuthn — escala, GISE, extra e termo de presença. */
const LIMPAVEIS_WEBAUTHN = [
	'webauthn_credential_id',
	'webauthn_client_data',
	'webauthn_authenticator_data',
	'webauthn_assinatura',
	'webauthn_backup_ativo'
];

/** Toda coluna listada tem de estar presente no UPDATE, valendo `null`. */
function esperaLimpaveis(set: Record<string, unknown> | undefined, colunas: string[]) {
	for (const c of colunas) {
		expect(set, `coluna ${c} ausente do UPDATE — valor anterior sobreviveria`).toHaveProperty(c);
		expect(set?.[c], `coluna ${c} deveria ser null`).toBeNull();
	}
}

describe('reassinatura limpa o que a assinatura anterior deixou', () => {
	it('salvarAssinaturaRelatorioGise: downgrade para `simples` zera CAdES, selfie e GPS', async () => {
		const { db, capturado } = dbEspiao();
		// Exatamente o payload do endpoint de assinatura simples: sem nenhum campo
		// CAdES, sem selfie, sem GPS.
		await salvarAssinaturaRelatorioGise(db, {
			gise_id: 3,
			seccional_id: 9,
			tipo: 'extraordinario',
			assinante_nome: 'BELTRANA',
			tipo_assinatura: 'simples'
		});

		esperaLimpaveis(capturado.set, [
			...LIMPAVEIS_COMUNS,
			'rubrica',
			'verification_hash',
			'r2_key',
			...LIMPAVEIS_WEBAUTHN
		]);
		expect(capturado.set?.tipo_assinatura).toBe('simples');
	});

	it('salvarGiseDocumento: reassinatura sem certificado zera CAdES, selfie e GPS', async () => {
		const { db, capturado } = dbEspiao();
		await salvarGiseDocumento(db, {
			giseId: 7,
			r2Key: 'gise/7/escala.pdf',
			assinanteId: 42,
			assinanteNome: 'FULANO',
			assinanteCpf: '12345678901',
			verificacaoHash: 'hash-v'
		});

		esperaLimpaveis(capturado.set, [...LIMPAVEIS_COMUNS, 'rubrica', ...LIMPAVEIS_WEBAUTHN]);
	});

	it('salvarDocumentoEscala: idem para a escala regular', async () => {
		const { db, capturado } = dbEspiao();
		await salvarDocumentoEscala(db, {
			escalaId: 5,
			r2Key: 'escalas/5/plantao.pdf',
			assinanteNome: 'CICRANO'
		});

		esperaLimpaveis(capturado.set, [
			...LIMPAVEIS_COMUNS,
			'verificacao_hash',
			...LIMPAVEIS_WEBAUTHN
		]);
	});
});

describe('salvarTermoPresencaGise (insert)', () => {
	it('grava IP anonimizado, GPS reduzido e os opcionais ausentes como null explícito', async () => {
		const { db, capturado } = dbEspiao();
		await salvarTermoPresencaGise(db, {
			gise_id: 7,
			policial_id: 42,
			tipo: 'entrada',
			assinante_nome: 'FULANO DE TAL',
			ip_address: '203.0.113.42',
			latitude: -3.7319,
			longitude: -38.5267
		});

		expect(capturado.values?.ip_address).toBe('203.0.113.0');
		expect(capturado.values?.latitude).toBe(-3.73);
		expect(capturado.values?.longitude).toBe(-38.53);
		// Sem certificado nem passkey: colunas do dossiê vêm null, não undefined —
		// mesma normalização de `montarCamposMinimizados` usada pelos outros três
		// pontos de gravação (este é o único que não faz upsert, mas divergir aqui
		// vira armadilha no dia em que ganhar um `.onConflictDoUpdate()`).
		esperaLimpaveis(capturado.values, [
			'user_agent',
			'user_agent_raw',
			'cert_issuer',
			'cert_serial',
			'cert_valido_de',
			'cert_valido_ate',
			'cms_sha256',
			'ocsp_response_b64',
			'ocsp_consultado_em',
			'tst_token_b64',
			...LIMPAVEIS_WEBAUTHN
		]);
	});
});

describe('salvarDocumentoEscala (upsert)', () => {
	it('grava os mesmos campos no INSERT e no UPDATE', async () => {
		const { db, capturado } = dbEspiao();
		await salvarDocumentoEscala(db, {
			escalaId: 5,
			r2Key: 'escalas/5/plantao.pdf',
			assinanteNome: 'CICRANO',
			assinanteCpf: '11122233344',
			verificacaoHash: 'hash-verificacao',
			ipAddress: '203.0.113.9',
			userAgent: 'Mozilla/5.0',
			latitude: -3.731944,
			longitude: -38.526667
		});

		const insert = { ...capturado.values };
		const update = { ...capturado.set };
		expect(insert.escala_id).toBe(5);
		expect(update.escala_id).toBeUndefined();
		delete insert.escala_id;
		delete update.created_at;
		expect(update).toEqual(insert);
	});
});
