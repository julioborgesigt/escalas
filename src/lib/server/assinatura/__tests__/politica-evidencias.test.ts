/**
 * A política de evidências da assinatura AVANÇADA —
 * `validarEvidenciasAvancada`, a fonte única de verdade dos três fluxos
 * (escala, GISE diária, relatório extraordinário).
 *
 * Este módulo existe POR CAUSA de um drift: seis endpoints duplicavam a
 * validação e as cópias divergiram — admin geral dispensado da checagem de CPF
 * em escalas mas não em GISE, escala mensal ignorando `exigirFotoAssinatura` e
 * `exigirCodigoEmailAssinatura` com as flags ligadas. A extração consertou a
 * divergência; até esta data nada prendia a regra no lugar. Uma varredura de
 * mutação mediu o custo: 29 sobreviventes em 36 no arquivo, quase todos
 * negações e disjunções dos guardas abaixo.
 *
 * `flagsOverride` já estava no contrato da função, documentado como sendo
 * "para testes" — e nunca havia sido usado por um.
 *
 * A ORDEM das recusas é contrato, não acaso, e por isso é testada: dispositivo
 * e passkey-um-tiro morrem ANTES do 2FA para não queimar tentativa do código de
 * quem seria barrado de qualquer forma; a senha vem antes do 2FA pela mesma
 * razão.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import type { FlagsAssinatura } from '../cfg-ass-cache';

/** O que os colaboradores devolvem — cada teste ajusta só o que quer derrubar. */
const cenario = {
	reauth: { ok: true } as { ok: boolean; status?: number; error?: string },
	resultado2FA: { usuarioId: 1 } as unknown
};

vi.mock('../reauth', () => ({
	exigirJanelaReauth: async () => cenario.reauth
}));

vi.mock('../../../auth', () => ({
	verificarDesafio2FA: async () => cenario.resultado2FA
}));

const { validarEvidenciasAvancada, recusadaPorPoliticaDispositivo, ERRO_POLITICA_DISPOSITIVO } =
	await import('../signature-service');

const UA_CELULAR =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const UA_DESKTOP =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

const db = {} as Database;
const user = { id: 1, tipo: 'policial' as const, nome: 'Fulano', cpf: '39053344705' };

function flags(over: Partial<FlagsAssinatura> = {}): FlagsAssinatura {
	return {
		exigirFotoAssinatura: false,
		exigirGpsAssinatura: false,
		exigirCodigoEmailAssinatura: true, // piso legal — ligado por padrão
		restringirSmartphone: false,
		exigirPasskeyAssinatura: false,
		...over
	};
}

/** `LivenessResult` completo — o tipo exige a trilha, não só o veredito. */
function liveness(over: Partial<{ cumprido: boolean; duracaoMs: number }> = {}) {
	return {
		tipo: 'blink' as const,
		cumprido: true,
		tentativas: 1,
		iniciadoEm: '2026-08-29T12:00:00.000Z',
		concluidoEm: '2026-08-29T12:00:01.500Z',
		duracaoMs: 1500,
		...over
	};
}

/** Evidências completas o bastante para passar em tudo que estiver ligado. */
function evidencias(over: Record<string, unknown> = {}) {
	return {
		codigoValidação: '123456',
		desafioId: 'd'.repeat(64),
		reauthId: 'r'.repeat(64),
		userAgent: UA_DESKTOP,
		selfieBase64: 'data:image/jpeg;base64,AAAA',
		livenessChallenge: liveness(),
		latitude: -3.73,
		longitude: -38.52,
		...over
	};
}

async function validar(f: Partial<FlagsAssinatura>, e: Record<string, unknown> = {}) {
	return validarEvidenciasAvancada(db, user, evidencias(e), { flagsOverride: flags(f) });
}

beforeEach(() => {
	cenario.reauth = { ok: true };
	cenario.resultado2FA = { usuarioId: user.id };
});

describe('recusadaPorPoliticaDispositivo', () => {
	/**
	 * Vale só para a assinatura em tela. O caminho qualificado (Token A3) roda no
	 * desktop por projeto — estender o gate a ele derrubaria o fluxo que a
	 * própria restrição existe para induzir.
	 */
	it('com a restrição ligada, só o celular passa', () => {
		expect(recusadaPorPoliticaDispositivo({ restringirSmartphone: true }, UA_DESKTOP)).toBe(true);
		expect(recusadaPorPoliticaDispositivo({ restringirSmartphone: true }, UA_CELULAR)).toBe(false);
	});

	it('com a restrição desligada, o desktop passa', () => {
		expect(recusadaPorPoliticaDispositivo({ restringirSmartphone: false }, UA_DESKTOP)).toBe(false);
	});

	/** UA ausente não é celular — a ausência não pode virar permissão. */
	it('user-agent ausente é recusado quando a restrição está ligada', () => {
		for (const ua of [null, undefined, '']) {
			expect(recusadaPorPoliticaDispositivo({ restringirSmartphone: true }, ua)).toBe(true);
		}
	});
});

describe('validarEvidenciasAvancada — a linha de base', () => {
	/** Sem um caso que ACEITA, nenhuma recusa adiante prova nada. */
	it('evidências completas passam e voltam normalizadas', async () => {
		const r = await validar({ exigirFotoAssinatura: true, exigirGpsAssinatura: true });
		expect(r.ok, !r.ok ? r.error : '').toBe(true);
		if (!r.ok) return;
		expect(r.validated.doisFatorOk).toBe(true);
		expect(r.validated.latitude).toBe(-3.73);
		expect(r.validated.longitude).toBe(-38.52);
		expect(r.validated.selfieBase64).toBe('data:image/jpeg;base64,AAAA');
	});

	/**
	 * A flag de 2FA é forçada para `true` pelo endpoint de configuração, mas o
	 * código a trata defensivamente caso uma migração futura a vire. O efeito
	 * documentado é a assinatura CAIR para o nível SIMPLES — e é `doisFatorOk`
	 * que registra isso no manifesto.
	 */
	it('com o 2FA desligado, passa sem código e marca doisFatorOk falso', async () => {
		const r = await validar(
			{ exigirCodigoEmailAssinatura: false },
			{ codigoValidação: null, desafioId: null }
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.validated.doisFatorOk).toBe(false);
	});

	/** Flag desligada não exige o reforço — nem o transforma em obrigatório. */
	it('sem as flags de reforço, selfie e GPS ausentes não impedem', async () => {
		const r = await validar({}, { selfieBase64: null, latitude: null, longitude: null });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.validated.latitude).toBeNull();
		expect(r.validated.selfieBase64).toBeNull();
	});
});

describe('validarEvidenciasAvancada — cada reforço recusa sozinho', () => {
	it('desktop é recusado com 403 quando a restrição a celular está ligada', async () => {
		const r = await validar({ restringirSmartphone: true }, { userAgent: UA_DESKTOP });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.status).toBe(403);
		expect(r.error).toBe(ERRO_POLITICA_DISPOSITIVO);
	});

	it('celular passa com a mesma restrição ligada, e a política vai no manifesto', async () => {
		const r = await validar({ restringirSmartphone: true }, { userAgent: UA_CELULAR });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.validated.politicaDispositivoMovel).toBe(true);
	});

	/**
	 * 2FA por e-mail é piso legal (Lei 14.063/2020 art. 4º II "b"), não reforço
	 * opcional: sem código, a assinatura não acontece.
	 */
	it('sem código de e-mail a assinatura é recusada', async () => {
		for (const falta of [{ codigoValidação: null }, { desafioId: null }]) {
			const r = await validar({}, falta);
			expect(r.ok).toBe(false);
			if (r.ok) return;
			expect(r.status).toBe(400);
			expect(r.error).toMatch(/Lei 14\.063/);
		}
	});

	it('código expirado, esgotado ou inválido recusa com a mensagem própria', async () => {
		const casos = [
			['expirado', /expirou/],
			['esgotado', /Muitas tentativas/],
			[false, /inválido/]
		] as const;
		for (const [resultado, esperado] of casos) {
			cenario.resultado2FA = resultado;
			const r = await validar({});
			expect(r.ok).toBe(false);
			if (r.ok) return;
			expect(r.status).toBe(400);
			expect(r.error).toMatch(esperado);
		}
	});

	/**
	 * O código é válido, mas é de OUTRA pessoa. Sem este guarda, um código
	 * legítimo obtido por terceiro assinaria em nome de quem está logado.
	 */
	it('código de outro usuário é recusado com 403', async () => {
		cenario.resultado2FA = { usuarioId: user.id + 1 };
		const r = await validar({});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.status).toBe(403);
		expect(r.error).toMatch(/não pertence ao usuário logado/);
	});

	it('selfie ausente é recusada quando a flag de foto está ligada', async () => {
		const r = await validar({ exigirFotoAssinatura: true }, { selfieBase64: null });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/Selfie é obrigatória/);
	});

	it('GPS ausente é recusado quando a flag de GPS está ligada', async () => {
		for (const falta of [{ latitude: null }, { longitude: null }, { latitude: 'x' }]) {
			const r = await validar({ exigirGpsAssinatura: true }, falta);
			expect(r.ok).toBe(false);
			if (r.ok) return;
			expect(r.error).toMatch(/GPS/);
		}
	});

	/**
	 * O furo que o gate tinha: ele checava `typeof latitude !== 'number'`, e
	 * **`typeof NaN === 'number'`**. Como o servidor recebe a coordenada em texto
	 * e faz `parseFloat`, um `latitude=abc` chegava como `NaN`, PASSAVA por aqui e
	 * a assinatura seguia — com o manifesto imprimindo "Não capturado", porque
	 * `NaN` é falsy no render. A trava anunciada no painel do admin não travava.
	 */
	it('NaN é recusado com a flag ligada — não é "número" para efeito de evidência', async () => {
		for (const ruim of [
			{ latitude: NaN },
			{ longitude: NaN },
			{ latitude: Number.parseFloat('abc') },
			{ latitude: Infinity }
		]) {
			const r = await validar({ exigirGpsAssinatura: true }, ruim);
			expect(r.ok, `deveria recusar ${JSON.stringify(ruim)}`).toBe(false);
			if (r.ok) return;
			expect(r.error).toMatch(/GPS/);
		}
	});

	/** Coordenada impossível é PIOR que ausente: o manifesto a imprime como o local do ato. */
	it('coordenada fora de faixa é recusada com a flag ligada', async () => {
		for (const ruim of [{ latitude: 999 }, { longitude: -5000 }, { latitude: 90.1 }]) {
			const r = await validar({ exigirGpsAssinatura: true }, ruim);
			expect(r.ok, `deveria recusar ${JSON.stringify(ruim)}`).toBe(false);
			if (r.ok) return;
			expect(r.error).toMatch(/GPS/);
		}
	});

	/**
	 * Com a flag DESLIGADA não há recusa — mas também não há evidência inventada:
	 * o que não é coordenada plausível é persistido como ausência, e não
	 * arredondado para dentro do manifesto.
	 */
	it('com a flag desligada, coordenada implausível vira null em vez de virar evidência', async () => {
		for (const ruim of [{ latitude: NaN }, { latitude: 999 }, { longitude: -5000 }]) {
			const r = await validar({ exigirGpsAssinatura: false }, ruim);
			expect(r.ok, !r.ok ? r.error : '').toBe(true);
			if (!r.ok) return;
			expect(r.validated.latitude).toBeNull();
			expect(r.validated.longitude).toBeNull();
		}
	});

	/** A senha da cerimônia é piso, sem flag para desligar. */
	it('janela de reautenticação recusada propaga status e mensagem', async () => {
		cenario.reauth = { ok: false, status: 403, error: 'Reinsira sua senha para assinar.' };
		const r = await validar({});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.status).toBe(403);
		expect(r.error).toMatch(/Reinsira sua senha/);
	});

	it('reforço de passkey recusa o caminho de um tiro com 403', async () => {
		const r = await validarEvidenciasAvancada(db, user, evidencias(), {
			flagsOverride: flags({ exigirPasskeyAssinatura: true }),
			recusarSePasskeyExigida: true
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.status).toBe(403);
	});

	/** O mesmo reforço NÃO recusa quem vai fazer a cerimônia biométrica. */
	it('sem `recusarSePasskeyExigida`, o reforço de passkey só é reportado', async () => {
		const r = await validar({ exigirPasskeyAssinatura: true });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.validated.exigePasskey).toBe(true);
	});
});

describe('validarEvidenciasAvancada — liveness', () => {
	/**
	 * O veredito blink/smile é calculado no CLIENTE; o servidor confere
	 * consistência estrutural e temporal. Não resiste a cliente adulterado — é
	 * reforço da AVANÇADA, não prova de identidade forte —, mas eleva a barra
	 * contra selfie estática, e essa barra precisa continuar de pé.
	 */
	it('challenge ausente é recusado quando a foto é exigida', async () => {
		const r = await validar({ exigirFotoAssinatura: true }, { livenessChallenge: null });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/liveness challenge/);
	});

	it('challenge não cumprido é recusado', async () => {
		const r = await validar(
			{ exigirFotoAssinatura: true },
			{ livenessChallenge: liveness({ cumprido: false }) }
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/não cumprido/);
	});

	/** Cumprido instantâneo é foto pré-fabricada com payload forjado. */
	it('challenge cumprido rápido demais é recusado; 500 ms é o piso', async () => {
		const rapido = await validar(
			{ exigirFotoAssinatura: true },
			{ livenessChallenge: liveness({ duracaoMs: 499 }) }
		);
		expect(rapido.ok).toBe(false);
		if (!rapido.ok) expect(rapido.error).toMatch(/tempo implausível/);

		const noLimite = await validar(
			{ exigirFotoAssinatura: true },
			{ livenessChallenge: liveness({ duracaoMs: 500 }) }
		);
		expect(noLimite.ok).toBe(true);
	});

	/** Sem a flag de foto, o liveness não é exigido. */
	it('liveness não é cobrado quando a foto não é exigida', async () => {
		const r = await validar({}, { livenessChallenge: null });
		expect(r.ok).toBe(true);
	});
});

describe('validarEvidenciasAvancada — a ordem das recusas é contrato', () => {
	/**
	 * Dispositivo e passkey-um-tiro morrem ANTES do 2FA de propósito: recusar
	 * depois queimaria uma tentativa do código de quem seria barrado de qualquer
	 * forma. Aqui as evidências de 2FA são inválidas E o dispositivo é errado —
	 * a recusa que vem tem de ser a do dispositivo.
	 */
	it('a política de dispositivo recusa antes do 2FA', async () => {
		cenario.resultado2FA = false;
		const r = await validar(
			{ restringirSmartphone: true },
			{ userAgent: UA_DESKTOP, codigoValidação: null, desafioId: null }
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.status).toBe(403);
		expect(r.error).toBe(ERRO_POLITICA_DISPOSITIVO);
	});

	/** A senha da cerimônia também vem antes, pela mesma razão. */
	it('a janela de senha recusa antes do 2FA', async () => {
		cenario.reauth = { ok: false, status: 403, error: 'Reinsira sua senha para assinar.' };
		cenario.resultado2FA = false;
		const r = await validar({}, { codigoValidação: null, desafioId: null });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/Reinsira sua senha/);
	});
});
