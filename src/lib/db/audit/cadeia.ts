/**
 * Cadeia de hash da trilha de auditoria (tamper-evidence) e a configuração de
 * cripto que a acompanha.
 *
 * `canonicalAudit` e `calcularHashRegistro` ficam JUNTOS de propósito: o hash é
 * calculado sobre a FORMA CANÔNICA, e a ordem dos campos faz parte dela.
 * Separá-los, ou reordenar um campo, invalidaria silenciosamente a verificação
 * de toda a trilha já gravada — `verificarIntegridadeAudit` recalcula os hashes
 * antigos com o código novo.
 */
import { bytesToHex, hexToBytes } from '../../crypto/hex';
import { logger } from '../../server/logger';
import { sha256Hex } from '../../crypto/digest';
import { mensagemDeErro } from '$lib/utils/erro';

// ---- Configuração de criptografia ------------------------------------------

export interface AuditCriptoEnv {
	/** AES-256-GCM para o IP completo (hex 32 bytes). Sem ela: só IP anonimizado. */
	AUDIT_IP_ENCRYPTION_KEY?: string;
	/** HMAC-SHA256 da cadeia de hash (hex 32 bytes). Sem ela: cadeia em SHA-256 puro. */
	AUDIT_CHAIN_KEY?: string;
}

/** Chave de env em hex, ou `undefined` se ausente/ inválida. */
export function lerChave(valor: string | undefined): string | undefined {
	const v = valor?.trim();
	return v ? v : undefined;
}

// ---- Cadeia de hash (tamper-evidence) --------------------------------------

/** Âncora da cadeia: o `hash_anterior` do primeiro registro. */
export const GENESIS = 'GENESIS';

async function hmacHex(keyHex: string, s: string): Promise<string> {
	const raw = hexToBytes(keyHex);
	if (!raw || raw.length !== 32) {
		throw new Error('AUDIT_CHAIN_KEY inválida: esperado 32 bytes em hex (64 chars).');
	}
	const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign'
	]);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(s) as BufferSource);
	return bytesToHex(new Uint8Array(sig));
}

/** Campos que entram, em ordem fixa, na serialização canônica usada pelo hash. */
interface LinhaHashavel {
	seq: number;
	created_at: string;
	actor_tipo: string | null;
	usuario_id: number | null;
	usuario_nome: string;
	usuario_papel: string | null;
	acao: string;
	categoria: string | null;
	severidade: string | null;
	resultado: string | null;
	entidade: string;
	entidade_id: number | null;
	alvo_tipo: string | null;
	alvo_id: number | null;
	alvo_nome: string | null;
	detalhes: string | null;
	metadados: string | null;
	dados_antes: string | null;
	dados_depois: string | null;
	ip: string | null;
	ip_cifrado: string | null;
	user_agent: string | null;
	request_id: string | null;
	rota: string | null;
	metodo: string | null;
	hash_anterior: string;
}

/**
 * Serialização canônica e determinística da linha — o que entra no hash. A ordem
 * é FIXA; alterá-la quebra a verificação de linhas já gravadas. Em caso de
 * mudança de formato, introduza uma nova tag de versão no hash (ver `tagHash`).
 */
export function canonicalAudit(l: LinhaHashavel): string {
	return JSON.stringify([
		l.seq,
		l.created_at,
		l.actor_tipo,
		l.usuario_id,
		l.usuario_nome,
		l.usuario_papel,
		l.acao,
		l.categoria,
		l.severidade,
		l.resultado,
		l.entidade,
		l.entidade_id,
		l.alvo_tipo,
		l.alvo_id,
		l.alvo_nome,
		l.detalhes,
		l.metadados,
		l.dados_antes,
		l.dados_depois,
		l.ip,
		l.ip_cifrado,
		l.user_agent,
		l.request_id,
		l.rota,
		l.metodo,
		l.hash_anterior
	]);
}

/**
 * Calcula `hash_registro` a partir do hash anterior e do payload canônico.
 * Prefixo de algoritmo (`h:` HMAC / `s:` SHA-256) torna a cadeia verificável
 * mesmo se a chave HMAC for adotada no meio da vida do log.
 *
 * Resiliência: uma `AUDIT_CHAIN_KEY` inválida (hex fora do tamanho) NÃO pode
 * derrubar a auditoria inteira — neste caso caímos para SHA-256 (tag `s:`) e
 * registramos um aviso. Melhor uma cadeia degradada do que perder o evento.
 */
export async function calcularHashRegistro(
	hashAnterior: string,
	canonical: string,
	chainKey?: string
): Promise<string> {
	const material = hashAnterior + '\n' + canonical;
	if (chainKey) {
		try {
			return 'h:' + (await hmacHex(chainKey, material));
		} catch (err) {
			logger.warn('[audit] AUDIT_CHAIN_KEY inválida — usando SHA-256 neste registro', {
				error: mensagemDeErro(err)
			});
		}
	}
	return 's:' + (await sha256Hex(material));
}
