/**
 * Mensagens e recusas da chave de assinatura (passkey).
 *
 * A chave é da PESSOA, não do aparelho. Cadastro só no celular (decisão 3).
 * Sem chave ativa, o titular lê; o POST de avançada (quando a flag exige)
 * recusa com uma frase que distingue celular de desktop — nunca afirma
 * "dispositivo registrado".
 */
import { forbidden } from '$lib/server/api';
import {
	buscarCredencialAtiva,
	type CredencialWebauthn,
	type Database,
	type DonoCredencial
} from '$lib/db';
import { ehDispositivoMovelUA } from './document-utils';

export const ERRO_PASSKEY_UM_TIRO =
	'Esta assinatura exige a chave do seu celular. Use o fluxo de assinatura por chave.';

export const ERRO_CADASTRO_CHAVE_DESKTOP =
	'O cadastro da chave de assinatura só pode ser feito pelo celular.';

/**
 * Recusa o cadastro da chave neste user-agent. Sempre — não depende da
 * política `restringirSmartphone` da avançada: a chave nasce no celular
 * mesmo quando a corporação ainda assina em tela no desktop.
 */
export function recusarCadastroChavePorUA(userAgent: string): boolean {
	return !ehDispositivoMovelUA(userAgent);
}

/**
 * 403 de avançada sem chave ativa. Distingue o que fazer: cadastrar neste
 * celular, ou usar o Token A3 no computador.
 */
export function mensagemSemChaveAssinatura(userAgent: string): string {
	if (ehDispositivoMovelUA(userAgent)) {
		return (
			'Cadastre a chave de assinatura no celular (Meu Perfil) e repita a operação. ' +
			'Cadastrar de novo substitui a chave anterior.'
		);
	}
	return (
		'A assinatura avançada em tela é no celular. Neste computador, use o Token A3, ' +
		'ou cadastre a chave no celular (Meu Perfil).'
	);
}

/** 403 se o user-agent não for celular — cadastro da chave nunca no desktop. */
export function recusaCadastroChaveDesktop(userAgent: string): Response | null {
	if (recusarCadastroChavePorUA(userAgent)) return forbidden(ERRO_CADASTRO_CHAVE_DESKTOP);
	return null;
}

/**
 * Credencial ativa do titular, ou 403 com a frase que distingue celular de
 * desktop. Usado no `preparar` de cada recurso: sem chave, o POST morre antes
 * de montar PDF ou queimar 2FA.
 */
export async function exigirChaveAtiva(
	db: Database,
	dono: DonoCredencial,
	userAgent: string
): Promise<{ credencial: CredencialWebauthn } | { recusa: Response }> {
	const credencial = await buscarCredencialAtiva(db, dono);
	if (!credencial) return { recusa: forbidden(mensagemSemChaveAssinatura(userAgent)) };
	return { credencial };
}
