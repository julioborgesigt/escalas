/**
 * Janela de senha da assinatura avançada — mensagens e o cache no
 * `sessionStorage` que o pad consulta para não pedir senha a cada PDF do lote.
 *
 * O servidor vale ~10 min. O cliente guarda `exp` um pouco antes: um id
 * solto (formato antigo, só o hex) ou sem expiração NÃO autoriza pular o
 * passo. Era isso que fazia o titular cair no 2FA e o POST voltar "confirme
 * a senha" — a janela no servidor já tinha caído, o pad não pedia de novo.
 */
import { mensagemDeErro } from '$lib/utils/erro';
export const REAUTH_VALIDADE_MS = 10 * 60 * 1000;

/** Folga para o relógio do aparelho não pular um passo que o servidor já recusaria. */
const REAUTH_CLIENTE_MARGEM_MS = 60_000;

export const ERRO_REAUTH_AUSENTE =
	'Confirme sua senha de acesso para assinar. A sessão sozinha não basta.';

export const ERRO_REAUTH_INVALIDA =
	'A confirmação de senha expirou ou não confere. Digite a senha novamente.';

const STORAGE_KEY = 'assinatura_reauth_id';
const ID_HEX = /^[0-9a-f]{64}$/;

type Guardado = { v: 1; id: string; exp: number };

export function ehErroReauthAssinatura(e: unknown): boolean {
	const m = mensagemDeErro(e);
	return m.includes(ERRO_REAUTH_AUSENTE) || m.includes(ERRO_REAUTH_INVALIDA);
}

function storage(): Storage | null {
	try {
		if (typeof sessionStorage === 'undefined') return null;
		return sessionStorage;
	} catch {
		return null;
	}
}

function parseGuardado(cru: string): Guardado | null {
	try {
		const o = JSON.parse(cru) as Partial<Guardado>;
		if (o?.v === 1 && typeof o.id === 'string' && typeof o.exp === 'number') {
			return o as Guardado;
		}
	} catch {
		// formato antigo: 64 hex cru — sem `exp`, não autoriza pular
	}
	return null;
}

/** Id ainda válido no cliente, ou `null` (e apaga o que estiver podre). */
export function lerReauthGuardado(): string | null {
	const s = storage();
	if (!s) return null;
	const cru = s.getItem(STORAGE_KEY);
	if (!cru) return null;
	const parsed = parseGuardado(cru);
	if (!parsed || parsed.exp <= Date.now() || !ID_HEX.test(parsed.id)) {
		s.removeItem(STORAGE_KEY);
		return null;
	}
	return parsed.id;
}

export function gravarReauth(id: string): void {
	const s = storage();
	if (!s || !ID_HEX.test(id)) return;
	const payload: Guardado = {
		v: 1,
		id,
		exp: Date.now() + REAUTH_VALIDADE_MS - REAUTH_CLIENTE_MARGEM_MS
	};
	s.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function apagarReauth(): void {
	storage()?.removeItem(STORAGE_KEY);
}
