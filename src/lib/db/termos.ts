/**
 * DB helpers para a tabela `aceites_termos`.
 *
 * Não há tabela de "termos" — o texto vigente fica em código
 * (src/lib/server/termo/termo-vigente.ts). Aqui guardamos só os
 * registros de aceite individuais.
 */

import { and, desc, eq } from 'drizzle-orm';
import { aceitesTermos } from '../server/schema';
import type { AceiteTermo } from '../server/schema';
import type { Database } from './core';
import { anonimizarIp } from './audit';
import { parseUserAgent } from '../server/document-utils';

export interface RegistrarAceiteInput {
	usuario_tipo: 'policial' | 'admin';
	usuario_id: number;
	versao_termo: string;
	hash_termo: string;
	aceitou_lgpd: boolean;
	aceitou_uso_email?: boolean;
	aceitou_uso_localizacao?: boolean;
	ip?: string | null;
	user_agent?: string | null;
}

export async function registrarAceite(
	db: Database,
	input: RegistrarAceiteInput
): Promise<AceiteTermo> {
	const inserido = await db
		.insert(aceitesTermos)
		.values({
			usuario_tipo: input.usuario_tipo,
			usuario_id: input.usuario_id,
			versao_termo: input.versao_termo,
			hash_termo: input.hash_termo,
			aceitou_lgpd: input.aceitou_lgpd ? 1 : 0,
			aceitou_uso_email: input.aceitou_uso_email ? 1 : 0,
			aceitou_uso_localizacao: input.aceitou_uso_localizacao ? 1 : 0,
			ip: anonimizarIp(input.ip),
			user_agent: input.user_agent ? parseUserAgent(input.user_agent) : null
		})
		.returning()
		.get();
	return inserido;
}

/**
 * Retorna o aceite mais recente do usuário (ou undefined se nunca aceitou).
 */
export async function buscarUltimoAceite(
	db: Database,
	tipo: 'policial' | 'admin',
	usuarioId: number
): Promise<AceiteTermo | undefined> {
	return db
		.select()
		.from(aceitesTermos)
		.where(and(eq(aceitesTermos.usuario_tipo, tipo), eq(aceitesTermos.usuario_id, usuarioId)))
		.orderBy(desc(aceitesTermos.aceitou_em))
		.limit(1)
		.get();
}

/**
 * Verifica se o usuário tem um aceite vigente para a versão+hash informados.
 */
export async function temAceiteVigente(
	db: Database,
	tipo: 'policial' | 'admin',
	usuarioId: number,
	versao: string,
	hash: string
): Promise<boolean> {
	const ult = await buscarUltimoAceite(db, tipo, usuarioId);
	return !!ult && ult.versao_termo === versao && ult.hash_termo === hash;
}
