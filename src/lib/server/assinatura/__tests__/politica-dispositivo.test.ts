/**
 * Política `restringirSmartphone` — a metade que RECUSA.
 *
 * Até ago/2026 a restrição era só de interface: escondia o painel e nada mais.
 * Um POST direto de um desktop assinava normalmente enquanto o painel do admin
 * anunciava garantia de dispositivo móvel. Estes testes existem para que a
 * recusa não volte a viver só no cliente — é a mesma classe de regressão que
 * `cfg-ass-cache.ts` fechou para selfie/GPS/2FA.
 */
import { describe, it, expect } from 'vitest';
import { ehDispositivoMovelUA } from '../document-utils';
import { validarEvidenciasAvancada, recusadaPorPoliticaDispositivo } from '../signature-service';
import { ErrorCode } from '../../api';
import type { FlagsAssinatura } from '../cfg-ass-cache';
import type { Database } from '../../../db/core';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { criarJanelaReauth } from '$lib/db/reauth';

const UA_IPHONE =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_ANDROID =
	'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const UA_TABLET_ANDROID =
	'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Tablet';
const UA_WINDOWS =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const UA_MAC =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const UA_CURL = 'curl/8.4.0';

/** Flags mínimas: só a política sob teste; 2FA/foto/GPS/passkey fora do caminho. */
function flags(restringirSmartphone: boolean): FlagsAssinatura {
	return {
		exigirFotoAssinatura: false,
		exigirGpsAssinatura: false,
		exigirCodigoEmailAssinatura: false,
		restringirSmartphone,
		exigirPasskeyAssinatura: false
	};
}

/** O gate de dispositivo roda ANTES da janela de senha — recusa de desktop
 *  não precisa de banco. O caminho de sucesso precisa da janela real. */
const dbNaoUsado = null as unknown as Database;
const usuario = { id: 7, tipo: 'policial' as const, nome: 'Fulano', cpf: '12345678901' };
const SESSAO = 'sessao-politica-dispositivo';

function evidencias(userAgent: string, reauthId?: string) {
	return { userAgent, reauthId };
}

async function evidenciasComJanela(db: Database, userAgent: string) {
	const reauthId = await criarJanelaReauth(db, usuario, SESSAO);
	return { evidencias: evidencias(userAgent, reauthId), sessaoToken: SESSAO };
}

describe('ehDispositivoMovelUA', () => {
	it('aceita celular (iPhone e Android)', () => {
		expect(ehDispositivoMovelUA(UA_IPHONE)).toBe(true);
		expect(ehDispositivoMovelUA(UA_ANDROID)).toBe(true);
	});

	it('aceita tablet — paridade com o regex do cliente, que inclui iPad', () => {
		expect(ehDispositivoMovelUA(UA_TABLET_ANDROID)).toBe(true);
	});

	it('recusa desktop', () => {
		expect(ehDispositivoMovelUA(UA_WINDOWS)).toBe(false);
	});

	it('recusa UA ausente, vazio ou não-navegador — sem declaração, não passa', () => {
		expect(ehDispositivoMovelUA('')).toBe(false);
		expect(ehDispositivoMovelUA('N/A')).toBe(false);
		expect(ehDispositivoMovelUA(UA_CURL)).toBe(false);
	});

	it('recusa iPadOS 13+, que manda UA de macOS — divergência conhecida e assumida', () => {
		// Em tela cheia o cliente também bloqueia (largura > 768px); em split view
		// estreita ele libera e o servidor recusa. Recusar é o lado seguro, e a
		// mensagem de erro orienta a usar o navegador em tela cheia.
		expect(ehDispositivoMovelUA(UA_MAC)).toBe(false);
	});
});

describe('recusadaPorPoliticaDispositivo', () => {
	it('só recusa com a política ligada', () => {
		expect(recusadaPorPoliticaDispositivo(flags(false), UA_WINDOWS)).toBe(false);
		expect(recusadaPorPoliticaDispositivo(flags(true), UA_WINDOWS)).toBe(true);
		expect(recusadaPorPoliticaDispositivo(flags(true), UA_IPHONE)).toBe(false);
	});

	it('trata UA ausente como não-móvel', () => {
		expect(recusadaPorPoliticaDispositivo(flags(true), null)).toBe(true);
		expect(recusadaPorPoliticaDispositivo(flags(true), undefined)).toBe(true);
	});
});

describe('validarEvidenciasAvancada — gate de dispositivo', () => {
	it('recusa desktop com 403 FORBIDDEN quando a política está ligada', async () => {
		const r = await validarEvidenciasAvancada(dbNaoUsado, usuario, evidencias(UA_WINDOWS), {
			flagsOverride: flags(true)
		});

		expect(r.ok).toBe(false);
		if (r.ok) return;
		// 403 e não 400: é recusa de permissão de canal, não corpo malformado.
		expect(r.status).toBe(403);
		expect(r.code).toBe(ErrorCode.FORBIDDEN);
	});

	it('recusa POST sem user-agent (curl) quando a política está ligada', async () => {
		const semUa = await validarEvidenciasAvancada(dbNaoUsado, usuario, evidencias(''), {
			flagsOverride: flags(true)
		});
		const curl = await validarEvidenciasAvancada(dbNaoUsado, usuario, evidencias(UA_CURL), {
			flagsOverride: flags(true)
		});

		expect(semUa.ok).toBe(false);
		expect(curl.ok).toBe(false);
	});

	it('aceita celular com a política ligada e marca a política nas evidências', async () => {
		const sqlite = bancoMigrado();
		const db = drizzleSobre(sqlite);
		const { evidencias: ev, sessaoToken } = await evidenciasComJanela(db, UA_ANDROID);
		const r = await validarEvidenciasAvancada(db, usuario, ev, {
			flagsOverride: flags(true),
			sessaoToken
		});

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		// É este campo que vira a linha do manifesto — sem ele o PDF não teria
		// como distinguir "política verificada" de "política desligada".
		expect(r.validated.politicaDispositivoMovel).toBe(true);
	});

	it('aceita desktop com a política desligada, sem marcar nada no manifesto', async () => {
		const sqlite = bancoMigrado();
		const db = drizzleSobre(sqlite);
		const { evidencias: ev, sessaoToken } = await evidenciasComJanela(db, UA_WINDOWS);
		const r = await validarEvidenciasAvancada(db, usuario, ev, {
			flagsOverride: flags(false),
			sessaoToken
		});

		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.validated.politicaDispositivoMovel).toBe(false);
	});
});
