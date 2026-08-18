/**
 * O passo de prova compartilhado pelas quatro rotas `finalizar-assinatura-avancada`.
 *
 * `assercao.test.ts` já cobre a criptografia em si (desafio, origem, tipo, UV,
 * contador). O que ESTE arquivo protege é o que só existe no helper: a ORDEM
 * dos quatro passos e o vínculo credencial↔titular.
 *
 * O caso que justifica o arquivo é o segundo teste. Uma asserção montada com a
 * chave de OUTRA pessoa, sobre o mesmo PDF, é criptograficamente impecável — o
 * PDF preparado é público, e `verificarAssercao` diria `ok`. O único ponto do
 * sistema que a recusa é a conferência de dono aqui. Sem ela, a assinatura de
 * A vale como assinatura de B, sem erro nenhum e com o documento gravado.
 *
 * Usa o banco SQLite REAL (`sqlite-migrado`) porque metade do que se testa é
 * o SQL: `consumirIntencaoAssinatura` queima a intenção com um `UPDATE`
 * condicional, e "a intenção foi consumida" é justamente o que o quarto teste
 * verifica.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import type { Database } from '$lib/db';
import { registrarCredencial } from '$lib/db/webauthn';
import { criarIntencaoAssinatura } from '../../intencao';
import { conferirFinalizacaoPasskey } from '../finalizar-avancada';
import { bytesToBase64Url } from '$lib/crypto/bin';
import { calcularHashBuffer } from '../../document-utils';
import { hexToBytes } from '$lib/crypto/hex';

const ORIGEM = 'https://escalas.pc.ce.gov.br';
const RP_ID = 'escalas.pc.ce.gov.br';
const URL_REQ = new URL(`${ORIGEM}/api/escalas/1/finalizar-assinatura-avancada`);
const PLATFORM = { env: { APP_ORIGIN: ORIGEM } } as unknown as App.Platform;

const USUARIO = { id: 7, tipo: 'policial' as const };
const OUTRA_PESSOA = { id: 99, tipo: 'policial' as const };

/** O PDF que o `preparar` montou — os bytes que a intenção amarra. */
const PDF = new Uint8Array(64).map((_, i) => (i * 13 + 5) & 0xff);

async function gerarChaves() {
	const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify'
	]);
	const spki = new Uint8Array(await crypto.subtle.exportKey('spki', par.publicKey));
	return { par, spki };
}

/** P1363 (`r||s`, o que a Web Crypto assina) → DER, que é o que o aparelho devolve. */
function p1363ParaDer(sig: Uint8Array): Uint8Array {
	const inteiro = (bytes: Uint8Array): number[] => {
		let i = 0;
		while (i < bytes.length - 1 && bytes[i] === 0) i++;
		const corpo = Array.from(bytes.slice(i));
		if (corpo[0] & 0x80) corpo.unshift(0);
		return [0x02, corpo.length, ...corpo];
	};
	const r = inteiro(sig.slice(0, 32));
	const s = inteiro(sig.slice(32));
	return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

/**
 * Monta uma asserção VÁLIDA sobre `desafio`, assinada por `par`. É o aparelho
 * do titular — ou o de outra pessoa, conforme a chave que se passa.
 */
async function montarAssercao(par: CryptoKeyPair, desafio: Uint8Array, credentialId: string) {
	const rpIdHash = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(RP_ID))
	);
	const authData = new Uint8Array(37);
	authData.set(rpIdHash, 0);
	authData[32] = 0x01 | 0x04; // UP + UV
	new DataView(authData.buffer).setUint32(33, 1, false);

	const clientData = new TextEncoder().encode(
		JSON.stringify({
			type: 'webauthn.get',
			challenge: bytesToBase64Url(desafio),
			origin: ORIGEM
		})
	);
	const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientData));
	const assinado = new Uint8Array(authData.length + clientDataHash.length);
	assinado.set(authData, 0);
	assinado.set(clientDataHash, authData.length);

	const p1363 = new Uint8Array(
		await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, par.privateKey, assinado)
	);

	return {
		credentialId,
		clientDataJSON: bytesToBase64Url(clientData),
		authenticatorData: bytesToBase64Url(authData),
		assinatura: bytesToBase64Url(p1363ParaDer(p1363))
	};
}

describe('conferirFinalizacaoPasskey', () => {
	let db: Database;
	let titular: Awaited<ReturnType<typeof gerarChaves>>;
	let desafio: Uint8Array;

	const ALVO = { recurso: 'escala' as const, recursoId: 1 };

	beforeEach(async () => {
		db = drizzleSobre(bancoMigrado());
		titular = await gerarChaves();
		desafio = hexToBytes(await calcularHashBuffer(PDF))!;
		await registrarCredencial(db, USUARIO, {
			credentialId: 'cred-do-titular',
			publicKeySpki: titular.spki,
			contador: 0,
			aaguid: null,
			backupElegivel: true,
			backupAtivo: true
		});
	});

	const chamar = (intencao: string, assercao: Awaited<ReturnType<typeof montarAssercao>>) =>
		conferirFinalizacaoPasskey({
			db,
			usuario: USUARIO as unknown as NonNullable<App.Locals['usuario']>,
			alvo: ALVO,
			corpo: { intencao, preparedPdf: btoa(String.fromCharCode(...PDF)), assercao },
			url: URL_REQ,
			platform: PLATFORM,
			logTag: 'teste'
		});

	it('aceita a asserção do titular sobre o PDF que a intenção amarrou', async () => {
		const intencao = await criarIntencaoAssinatura(db, ALVO, USUARIO, PDF, 'HASH-PUBLICO');
		const assercao = await montarAssercao(titular.par, desafio, 'cred-do-titular');

		const r = await chamar(intencao, assercao);

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.verificacaoHash).toBe('HASH-PUBLICO');
		expect(r.credencial.credentialId).toBe('cred-do-titular');
		expect(r.dados.contador).toBe(1);
		// Os bytes devolvidos são os que a intenção conferiu, não os do corpo cru.
		expect(Array.from(r.pdfBytes)).toEqual(Array.from(PDF));
	});

	it('RECUSA asserção criptograficamente válida feita com a chave de OUTRA pessoa', async () => {
		const intruso = await gerarChaves();
		await registrarCredencial(db, OUTRA_PESSOA, {
			credentialId: 'cred-do-intruso',
			publicKeySpki: intruso.spki,
			contador: 0,
			aaguid: null,
			backupElegivel: true,
			backupAtivo: true
		});

		const intencao = await criarIntencaoAssinatura(db, ALVO, USUARIO, PDF, 'HASH-PUBLICO');
		// A asserção é PERFEITA: desafio certo, origem certa, UV, assinatura confere
		// com a chave registrada de `cred-do-intruso`. O que a recusa é só o dono.
		const assercao = await montarAssercao(intruso.par, desafio, 'cred-do-intruso');

		const r = await chamar(intencao, assercao);

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.recusa.status).toBe(403);
	});

	it('RECUSA credencial revogada, mesmo sendo do titular', async () => {
		// Registrar de novo revoga a anterior (`registrarCredencial` mantém uma só).
		const nova = await gerarChaves();
		await registrarCredencial(db, USUARIO, {
			credentialId: 'cred-nova',
			publicKeySpki: nova.spki,
			contador: 0,
			aaguid: null,
			backupElegivel: true,
			backupAtivo: true
		});

		const intencao = await criarIntencaoAssinatura(db, ALVO, USUARIO, PDF, 'HASH-PUBLICO');
		const assercao = await montarAssercao(titular.par, desafio, 'cred-do-titular');

		const r = await chamar(intencao, assercao);

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.recusa.status).toBe(403);
	});

	it('consome a intenção ANTES de verificar a asserção — não há oráculo', async () => {
		const intencao = await criarIntencaoAssinatura(db, ALVO, USUARIO, PDF, 'HASH-PUBLICO');
		const intruso = await gerarChaves();
		const ruim = await montarAssercao(intruso.par, desafio, 'cred-do-titular');

		// Primeira tentativa: falha na asserção (a chave não bate com a registrada).
		const r1 = await chamar(intencao, ruim);
		expect(r1.ok).toBe(false);

		// A intenção JÁ foi queimada. Se a ordem fosse inversa, este token ainda
		// valeria e daria para varrer asserções contra o mesmo PDF até acertar.
		const boa = await montarAssercao(titular.par, desafio, 'cred-do-titular');
		const r2 = await chamar(intencao, boa);
		expect(r2.ok).toBe(false);
		if (r2.ok) return;
		expect(r2.recusa.status).toBe(400);
	});

	it('RECUSA quando o PDF enviado não é o que a intenção amarrou', async () => {
		const intencao = await criarIntencaoAssinatura(db, ALVO, USUARIO, PDF, 'HASH-PUBLICO');
		const outroPdf = new Uint8Array(64).map((_, i) => (i * 3 + 1) & 0xff);
		const assercao = await montarAssercao(titular.par, desafio, 'cred-do-titular');

		const r = await conferirFinalizacaoPasskey({
			db,
			usuario: USUARIO as unknown as NonNullable<App.Locals['usuario']>,
			alvo: ALVO,
			corpo: {
				intencao,
				preparedPdf: btoa(String.fromCharCode(...outroPdf)),
				assercao
			},
			url: URL_REQ,
			platform: PLATFORM,
			logTag: 'teste'
		});

		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.recusa.status).toBe(400);
	});
});
