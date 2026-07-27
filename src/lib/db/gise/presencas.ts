/**
 * Presença dos escalados na GISE: uma linha por policial, com entrada e saída.
 *
 * Cada confirmação guarda rubrica, foto (prova de vida), IP e GPS — é o que
 * sustenta o termo de presença e, depois, o relatório de extra.
 */
import { eq, and, sql } from 'drizzle-orm';
import { gisePresencas, policiais } from '../../server/schema';
import type { Database } from '../core';
import { anonimizarIp } from '../audit';
import { parseUserAgent, reduzirPrecisaoGps } from '../../server/document-utils';
import { decifrarCpfDoDB, type CpfCriptoEnv } from '../../crypto/cpf-cripto';

/** Confirma (ou re-confirma) a entrada — upsert por (gise, policial). */
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
	// Instante REAL em UTC (ISO com Z). A formatação para horário de Brasília é
	// responsabilidade de cada exibição (Intl com timeZone America/Sao_Paulo).
	// NÃO usar getNowBR().toISOString() aqui: gravava o horário de Brasília
	// rotulado como UTC, causando -3h em quem reformatava para America/Sao_Paulo.
	const now = new Date().toISOString();

	// Mesmos campos no INSERT e no UPDATE (ver `documentos.ts`): montados uma vez
	// para não divergirem. Chave do conflito: (gise_id, policial_id).
	const dados = {
		entrada_timestamp: now,
		entrada_rubrica: rubrica,
		entrada_selfie_key: selfieKey,
		ip_address: anonimizarIp(ipAddress) ?? undefined,
		user_agent: userAgent ? parseUserAgent(userAgent) : undefined,
		latitude: reduzirPrecisaoGps(latitude),
		longitude: reduzirPrecisaoGps(longitude),
		updated_at: sql`datetime('now', '-3 hours')`
	};

	return db
		.insert(gisePresencas)
		.values({ gise_id: giseId, policial_id: policialId, ...dados })
		.onConflictDoUpdate({
			target: [gisePresencas.gise_id, gisePresencas.policial_id],
			// Reconfirmar a entrada substitui a anterior (correção de rubrica/foto).
			set: dados
		});
}

/**
 * Confirma a saída. É UPDATE, não upsert: sem linha de entrada não há saída a
 * registrar, e o `where` simplesmente não casa.
 */
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
			saida_timestamp: new Date().toISOString(), // UTC real (ver salvarEntradaGise)
			saida_rubrica: rubrica,
			saida_selfie_key: selfieKey,
			ip_address: anonimizarIp(ipAddress) ?? undefined,
			user_agent: userAgent ? parseUserAgent(userAgent) : undefined,
			latitude: reduzirPrecisaoGps(latitude),
			longitude: reduzirPrecisaoGps(longitude),
			updated_at: sql`datetime('now', '-3 hours')`
		})
		.where(and(eq(gisePresencas.gise_id, giseId), eq(gisePresencas.policial_id, policialId)));
}

/** Presenças da GISE com os dados do policial (para o painel e os relatórios). */
export async function buscarPresencasGise(
	db: Database,
	giseId: number,
	env: CpfCriptoEnv | undefined
) {
	const rows = await db
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
	// CPF é cifrado em repouso (LGPD) — decifra para assinatura/exibição do GISE.
	return Promise.all(
		rows.map(async (r) => ({
			...r,
			policial_cpf: (await decifrarCpfDoDB(r.policial_cpf, env)) || null
		}))
	);
}
