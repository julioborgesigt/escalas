import { eq, and, desc, sql } from 'drizzle-orm';
import { giseAssinaturasRelatorios, gisePresencaTermos, policiais } from '../../server/schema';
import type { Database } from '../core';
import { anonimizarIp } from '../audit';
import { parseUserAgent } from '../../server/document-utils';
import { cifrarCpfParaArmazenar, type CpfCriptoEnv } from '../../crypto/cpf-cripto';

function gps2(v?: number): number | undefined {
	return v !== undefined ? Math.round(v * 100) / 100 : undefined;
}

export async function buscarAssinaturasRelatoriosGise(db: Database, giseId: number) {
	return db
		.select()
		.from(giseAssinaturasRelatorios)
		.where(eq(giseAssinaturasRelatorios.gise_id, giseId))
		.all();
}

export async function buscarAssinaturaRelatorioGise(
	db: Database,
	giseId: number,
	seccionalId: number,
	tipo: 'extraordinario' | 'produtividade'
) {
	return db
		.select({
			id: giseAssinaturasRelatorios.id,
			gise_id: giseAssinaturasRelatorios.gise_id,
			seccional_id: giseAssinaturasRelatorios.seccional_id,
			tipo: giseAssinaturasRelatorios.tipo,
			assinante_id: giseAssinaturasRelatorios.assinante_id,
			assinante_nome: giseAssinaturasRelatorios.assinante_nome,
			assinante_cpf: giseAssinaturasRelatorios.assinante_cpf,
			assinante_matricula: policiais.matricula,
			tipo_assinatura: giseAssinaturasRelatorios.tipo_assinatura,
			rubrica: giseAssinaturasRelatorios.rubrica,
			verification_hash: giseAssinaturasRelatorios.verification_hash,
			selfie_key: giseAssinaturasRelatorios.selfie_key,
			ip_address: giseAssinaturasRelatorios.ip_address,
			user_agent: giseAssinaturasRelatorios.user_agent,
			latitude: giseAssinaturasRelatorios.latitude,
			longitude: giseAssinaturasRelatorios.longitude,
			r2_key: giseAssinaturasRelatorios.r2_key,
			created_at: giseAssinaturasRelatorios.created_at
		})
		.from(giseAssinaturasRelatorios)
		.leftJoin(policiais, eq(giseAssinaturasRelatorios.assinante_id, policiais.id))
		.where(
			and(
				eq(giseAssinaturasRelatorios.gise_id, giseId),
				eq(giseAssinaturasRelatorios.seccional_id, seccionalId),
				eq(giseAssinaturasRelatorios.tipo, tipo)
			)
		)
		.orderBy(desc(giseAssinaturasRelatorios.created_at))
		.get();
}

export async function salvarAssinaturaRelatorioGise(
	db: Database,
	data: {
		gise_id: number;
		seccional_id: number;
		tipo: 'extraordinario' | 'produtividade';
		assinante_id?: number | null;
		assinante_nome: string;
		assinante_cpf?: string | null;
		tipo_assinatura: 'simples' | 'webpki' | 'serpro';
		rubrica?: string;
		verification_hash?: string;
		ip_address?: string;
		user_agent?: string;
		latitude?: number;
		longitude?: number;
		selfie_key?: string;
		arquivo_hash?: string;
		r2_key?: string | null;
		assinante_email?: string | null;
		tipo_carimbo_tempo?: string;
		// Metadados CAdES-LT (migração 0012)
		cert_issuer?: string | null;
		cert_serial?: string | null;
		cert_valido_de?: string | null;
		cert_valido_ate?: string | null;
		cms_sha256?: string | null;
		ocsp_response_b64?: string | null;
		ocsp_consultado_em?: string | null;
		tst_token_b64?: string | null;
	},
	env?: CpfCriptoEnv
) {
	const ipAnonimizado = anonimizarIp(data.ip_address) ?? undefined;
	const uaResumido = data.user_agent ? parseUserAgent(data.user_agent) : undefined;
	const uaRaw = data.user_agent ? data.user_agent.slice(0, 1024) : undefined;
	const lat2 = gps2(data.latitude ?? undefined);
	const lng2 = gps2(data.longitude ?? undefined);
	// CPF cifrado em repouso (LGPD Fase 2). Coluna NOT NULL → fallback ''.
	const cpfArmazenado = (await cifrarCpfParaArmazenar(data.assinante_cpf, env)) ?? '';
	return db
		.insert(giseAssinaturasRelatorios)
		.values({
			...data,
			assinante_id: data.assinante_id ?? null,
			assinante_cpf: cpfArmazenado,
			ip_address: ipAnonimizado,
			user_agent: uaResumido,
			user_agent_raw: uaRaw,
			latitude: lat2,
			longitude: lng2
		})
		.onConflictDoUpdate({
			target: [
				giseAssinaturasRelatorios.gise_id,
				giseAssinaturasRelatorios.seccional_id,
				giseAssinaturasRelatorios.tipo
			],
			set: {
				assinante_id: data.assinante_id ?? null,
				assinante_nome: data.assinante_nome,
				assinante_cpf: cpfArmazenado,
				tipo_assinatura: data.tipo_assinatura,
				rubrica: data.rubrica,
				verification_hash: data.verification_hash,
				ip_address: ipAnonimizado,
				user_agent: uaResumido,
				user_agent_raw: uaRaw,
				latitude: lat2,
				longitude: lng2,
				selfie_key: data.selfie_key,
				arquivo_hash: data.arquivo_hash,
				r2_key: data.r2_key,
				assinante_email: data.assinante_email ?? null,
				tipo_carimbo_tempo: data.tipo_carimbo_tempo || 'servidor',
				cert_issuer: data.cert_issuer ?? null,
				cert_serial: data.cert_serial ?? null,
				cert_valido_de: data.cert_valido_de ?? null,
				cert_valido_ate: data.cert_valido_ate ?? null,
				cms_sha256: data.cms_sha256 ?? null,
				ocsp_response_b64: data.ocsp_response_b64 ?? null,
				ocsp_consultado_em: data.ocsp_consultado_em ?? null,
				tst_token_b64: data.tst_token_b64 ?? null,
				created_at: sql`datetime('now', '-3 hours')`
			}
		});
}

/**
 * Persiste o Termo de Confirmação de Presença assinado por Token A3 (desktop)
 * na tabela dedicada `gise_presenca_termos`. Mesmo tratamento de privacidade
 * dos demais registros (CPF cifrado, IP anonimizado, UA resumido + bruto).
 */
export async function salvarTermoPresencaGise(
	db: Database,
	data: {
		gise_id: number;
		policial_id: number;
		tipo: 'entrada' | 'saida';
		assinante_nome: string;
		assinante_cpf?: string | null;
		assinante_email?: string | null;
		verification_hash?: string;
		r2_key?: string | null;
		arquivo_hash?: string;
		ip_address?: string;
		user_agent?: string;
		latitude?: number;
		longitude?: number;
		tipo_carimbo_tempo?: string;
		cert_issuer?: string | null;
		cert_serial?: string | null;
		cert_valido_de?: string | null;
		cert_valido_ate?: string | null;
		cms_sha256?: string | null;
		ocsp_response_b64?: string | null;
		ocsp_consultado_em?: string | null;
		tst_token_b64?: string | null;
	},
	env?: CpfCriptoEnv
) {
	const cpfArmazenado = (await cifrarCpfParaArmazenar(data.assinante_cpf, env)) ?? null;
	return db.insert(gisePresencaTermos).values({
		gise_id: data.gise_id,
		policial_id: data.policial_id,
		tipo: data.tipo,
		assinante_nome: data.assinante_nome,
		assinante_cpf: cpfArmazenado,
		assinante_email: data.assinante_email ?? null,
		verification_hash: data.verification_hash,
		r2_key: data.r2_key ?? null,
		arquivo_hash: data.arquivo_hash,
		ip_address: anonimizarIp(data.ip_address) ?? undefined,
		user_agent: data.user_agent ? parseUserAgent(data.user_agent) : undefined,
		user_agent_raw: data.user_agent ? data.user_agent.slice(0, 1024) : undefined,
		latitude: gps2(data.latitude),
		longitude: gps2(data.longitude),
		tipo_carimbo_tempo: data.tipo_carimbo_tempo || 'servidor',
		cert_issuer: data.cert_issuer ?? null,
		cert_serial: data.cert_serial ?? null,
		cert_valido_de: data.cert_valido_de ?? null,
		cert_valido_ate: data.cert_valido_ate ?? null,
		cms_sha256: data.cms_sha256 ?? null,
		ocsp_response_b64: data.ocsp_response_b64 ?? null,
		ocsp_consultado_em: data.ocsp_consultado_em ?? null,
		tst_token_b64: data.tst_token_b64 ?? null,
		created_at: sql`datetime('now', '-3 hours')`
	});
}
