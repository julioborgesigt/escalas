import { eq, and, sql } from 'drizzle-orm';
import { gisePresencas, policiais } from '../../server/schema';
import type { Database } from '../core';
import { getNowBR } from '../../utils';
import { anonimizarIp } from '../audit';
import { parseUserAgent } from '../../server/document-utils';

function gps2(v?: number): number | undefined {
	return v !== undefined ? Math.round(v * 100) / 100 : undefined;
}

export async function salvarEntradaGise(
	db: Database,
	giseId: number,
	policialId: number,
	rubrica: string,
	ipAddress?: string,
	userAgent?: string,
	latitude?: number,
	longitude?: number,
	selfieKey?: string
) {
	const now = getNowBR().toISOString();
	return db
		.insert(gisePresencas)
		.values({
			gise_id: giseId,
			policial_id: policialId,
			entrada_timestamp: now,
			entrada_rubrica: rubrica,
			entrada_selfie_key: selfieKey,
			ip_address: anonimizarIp(ipAddress) ?? undefined,
			user_agent: userAgent ? parseUserAgent(userAgent) : undefined,
			latitude: gps2(latitude),
			longitude: gps2(longitude),
			updated_at: sql`datetime('now', '-3 hours')`
		})
		.onConflictDoUpdate({
			target: [gisePresencas.gise_id, gisePresencas.policial_id],
			set: {
				entrada_timestamp: now,
				entrada_rubrica: rubrica,
				entrada_selfie_key: selfieKey,
				ip_address: anonimizarIp(ipAddress) ?? undefined,
				user_agent: userAgent ? parseUserAgent(userAgent) : undefined,
				latitude: gps2(latitude),
				longitude: gps2(longitude),
				updated_at: sql`datetime('now', '-3 hours')`
			}
		});
}

export async function salvarSaidaGise(
	db: Database,
	giseId: number,
	policialId: number,
	rubrica: string,
	ipAddress?: string,
	userAgent?: string,
	latitude?: number,
	longitude?: number,
	selfieKey?: string
) {
	return db
		.update(gisePresencas)
		.set({
			saida_timestamp: getNowBR().toISOString(),
			saida_rubrica: rubrica,
			saida_selfie_key: selfieKey,
			ip_address: anonimizarIp(ipAddress) ?? undefined,
			user_agent: userAgent ? parseUserAgent(userAgent) : undefined,
			latitude: gps2(latitude),
			longitude: gps2(longitude),
			updated_at: sql`datetime('now', '-3 hours')`
		})
		.where(and(eq(gisePresencas.gise_id, giseId), eq(gisePresencas.policial_id, policialId)));
}

export async function buscarPresencasGise(db: Database, giseId: number) {
	return db
		.select({
			id: gisePresencas.id,
			gise_id: gisePresencas.gise_id,
			policial_id: gisePresencas.policial_id,
			policial_nome: policiais.nome,
			policial_matricula: policiais.matricula,
			policial_cpf: policiais.cpf,
			policial_cargo: policiais.cargo,
			policial_classe: policiais.classe,
			policial_lotacao: policiais.lotacao,
			entrada_timestamp: gisePresencas.entrada_timestamp,
			entrada_rubrica: gisePresencas.entrada_rubrica,
			entrada_selfie_key: gisePresencas.entrada_selfie_key,
			saida_timestamp: gisePresencas.saida_timestamp,
			saida_rubrica: gisePresencas.saida_rubrica,
			saida_selfie_key: gisePresencas.saida_selfie_key,
			ip_address: gisePresencas.ip_address,
			user_agent: gisePresencas.user_agent,
			latitude: gisePresencas.latitude,
			longitude: gisePresencas.longitude
		})
		.from(gisePresencas)
		.innerJoin(policiais, eq(gisePresencas.policial_id, policiais.id))
		.where(eq(gisePresencas.gise_id, giseId))
		.all();
}
