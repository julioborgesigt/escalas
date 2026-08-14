/**
 * Leitura do `authenticatorData` — a estrutura binária que o autenticador
 * assina junto com o hash do `clientDataJSON`.
 *
 * Layout (WebAuthn §6.1), sempre nesta ordem e sem CBOR nos 37 primeiros bytes:
 *
 *     [0..31]  rpIdHash    SHA-256 do RP ID (o domínio)
 *     [32]     flags       bitmask
 *     [33..36] signCount   uint32 big-endian
 *     [37..]   attestedCredentialData + extensões (só no REGISTRO)
 *
 * Os flags são o que impede esta fase de repetir o erro do user-agent:
 *
 *   - `UV` (0x04) — o autenticador VERIFICOU o usuário (biometria/PIN). Sem
 *     ele a asserção prova só posse do aparelho desbloqueado, não do titular.
 *   - `BE` (0x08, backup eligible) — a credencial PODE ser sincronizada.
 *   - `BS` (0x10, backup state) — a credencial ESTÁ sincronizada agora.
 *
 * `BE`/`BS` são a diferença entre "esta chave vive neste aparelho" e "esta
 * chave vive no keychain do titular e está copiada nos aparelhos dele". iOS e
 * Android sincronizam passkeys POR PADRÃO, então o caso comum é `BE=1`. O
 * manifesto tem de dizer qual dos dois foi — afirmar "aparelho" sobre uma
 * credencial sincronizada é a mesma promessa vazia que o user-agent fazia.
 *
 * Só o registro traz `attestedCredentialData` (AAGUID + id + chave COSE). Aqui
 * lemos apenas o AAGUID, que identifica o MODELO do autenticador; a chave
 * pública vem do `getPublicKey()` do navegador, já em SPKI, o que dispensa
 * decodificar CBOR no servidor (ver `registro.ts`).
 */
import { bytesToHex } from '$lib/crypto/hex';

/** Tamanho mínimo: rpIdHash (32) + flags (1) + signCount (4). */
const TAMANHO_MINIMO = 37;

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

export interface AuthenticatorData {
	/** SHA-256 do RP ID, para conferir contra o domínio esperado. */
	rpIdHash: Uint8Array;
	/** Presença do usuário (toque). */
	usuarioPresente: boolean;
	/** Verificação do usuário: biometria ou PIN. */
	usuarioVerificado: boolean;
	/** A credencial pode ser sincronizada (multi-dispositivo). */
	backupElegivel: boolean;
	/** A credencial está sincronizada neste momento. */
	backupAtivo: boolean;
	/** Contador de assinaturas; 0 quando o autenticador não implementa. */
	contador: number;
	/** AAGUID em hex — só no registro; `null` na asserção. */
	aaguid: string | null;
}

/**
 * Decodifica os campos fixos do `authenticatorData`.
 *
 * @throws {Error} se o buffer for curto demais para conter o cabeçalho — o
 * caller trata como asserção inválida.
 */
export function lerAuthenticatorData(dados: Uint8Array): AuthenticatorData {
	if (dados.length < TAMANHO_MINIMO) {
		throw new Error(`authenticatorData curto demais (${dados.length} bytes)`);
	}

	const flags = dados[32];
	const view = new DataView(dados.buffer, dados.byteOffset, dados.byteLength);

	// AAGUID são os 16 bytes que abrem o attestedCredentialData, presente só
	// quando o flag AT está ligado (registro).
	const temCredencial = (flags & FLAG_AT) !== 0;
	const aaguid =
		temCredencial && dados.length >= TAMANHO_MINIMO + 16
			? bytesToHex(dados.slice(TAMANHO_MINIMO, TAMANHO_MINIMO + 16))
			: null;

	return {
		rpIdHash: dados.slice(0, 32),
		usuarioPresente: (flags & FLAG_UP) !== 0,
		usuarioVerificado: (flags & FLAG_UV) !== 0,
		backupElegivel: (flags & FLAG_BE) !== 0,
		backupAtivo: (flags & FLAG_BS) !== 0,
		contador: view.getUint32(33, false),
		aaguid
	};
}

/**
 * Frase que o manifesto imprime sobre a natureza da credencial.
 *
 * Deliberadamente sem a palavra "aparelho" no caso sincronizado: a credencial
 * está no keychain do titular, copiada nos dispositivos dele. Dizer menos aqui
 * é o que sustenta o resto do documento em perícia.
 */
export function descreverVinculoCredencial(dados: {
	backupElegivel: boolean;
	backupAtivo: boolean;
}): string {
	if (!dados.backupElegivel) return 'vinculada a este aparelho (não sincronizável)';
	return dados.backupAtivo
		? 'sincronizada na conta do titular (presente em outros aparelhos dele)'
		: 'sincronizável na conta do titular; sem cópia ativa no momento';
}
