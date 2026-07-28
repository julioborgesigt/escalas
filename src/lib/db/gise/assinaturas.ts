import { eq, and, desc, sql } from 'drizzle-orm';
import { giseAssinaturasRelatorios, gisePresencaTermos, policiais } from '../../server/schema';
import type { Database } from '../core';
import { anonimizarIp } from '../audit';
import { parseUserAgent, reduzirPrecisaoGps } from '../../server/document-utils';
import { cifrarCpfParaArmazenar, type CpfCriptoEnv } from '../../crypto/cpf-cripto';

/**
 * Assinaturas de RELATÓRIO da GISE (`gise_assinaturas_relatorios`) e termos de
 * presença — os documentos que cada seccional assina, distintos da assinatura
 * única da escala (`gise_documentos`).
 *
 * A identidade de uma assinatura de relatório é a trinca
 * `(gise_id, seccional_id, tipo)`: uma por seccional por tipo. `tipo` separa o
 * relatório `extraordinario` (do serviço) do de `produtividade`; a seccional 0
 * é o quadro de supervisão extra, que não é seccional de verdade.
 *
 * Mesma minimização LGPD da assinatura de escala: CPF cifrado, IP anonimizado,
 * user-agent resumido (com o bruto truncado) e GPS a ~1 km.
 */

/** Todas as assinaturas de relatório da GISE, sem filtro de seccional ou tipo. */
export async function buscarAssinaturasRelatoriosGise(db: Database, giseId: number) {
	return db
		.select()
		.from(giseAssinaturasRelatorios)
		.where(eq(giseAssinaturasRelatorios.gise_id, giseId))
		.all();
}

/**
 * A assinatura da trinca `(gise, seccional, tipo)`, com a matrícula do assinante
 * resolvida por `leftJoin` — `left` porque o assinante pode ter sido excluído do
 * cadastro depois de assinar, e a assinatura continua valendo (o nome e o CPF
 * foram copiados para a própria linha justamente por isso).
 *
 * `orderBy(desc(created_at))` é defensivo: a trinca é única, então há no máximo
 * uma linha; se um índice faltar em algum ambiente, a mais recente ganha.
 */
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

/**
 * Registra (ou substitui) a assinatura do relatório. Reassinar sobrescreve a
 * linha inteira, inclusive o `created_at`: o que vale é a assinatura vigente.
 *
 * `tipo_assinatura` guarda COMO foi assinado — `simples` (em tela),
 * `webpki`/`serpro` (certificado ICP-Brasil) — e é o que a validação usa para
 * decidir se há CMS a verificar. Os campos CAdES só vêm nos dois últimos.
 *
 * Nunca chame com o CPF já cifrado: a cifra é feita aqui, e cifrar duas vezes
 * torna o valor inútil para comparação.
 */
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
	const lat2 = reduzirPrecisaoGps(data.latitude ?? undefined);
	const lng2 = reduzirPrecisaoGps(data.longitude ?? undefined);
	// CPF cifrado em repouso (LGPD Fase 2). Coluna NOT NULL → fallback ''.
	const cpfArmazenado = (await cifrarCpfParaArmazenar(data.assinante_cpf, env)) ?? '';

	// A trinca do conflito fica de fora do payload: identifica a linha, não é
	// conteúdo a reescrever.
	const { gise_id, seccional_id, tipo, ...resto } = data;
	// Mesmos campos no INSERT e no UPDATE — montados uma vez para não divergirem
	// (a lista tem 24 colunas e cresce a cada campo novo de CAdES).
	const dados = {
		...resto,
		assinante_id: data.assinante_id ?? null,
		assinante_cpf: cpfArmazenado,
		assinante_email: data.assinante_email ?? null,
		ip_address: ipAnonimizado,
		user_agent: uaResumido,
		user_agent_raw: uaRaw,
		latitude: lat2,
		longitude: lng2,
		tipo_carimbo_tempo: data.tipo_carimbo_tempo || 'servidor'
	};

	return db
		.insert(giseAssinaturasRelatorios)
		.values({ gise_id, seccional_id, tipo, ...dados })
		.onConflictDoUpdate({
			target: [
				giseAssinaturasRelatorios.gise_id,
				giseAssinaturasRelatorios.seccional_id,
				giseAssinaturasRelatorios.tipo
			],
			// Reassinar substitui a assinatura anterior por inteiro, inclusive o
			// carimbo de criação.
			set: { ...dados, created_at: sql`datetime('now', '-3 hours')` }
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
		latitude: reduzirPrecisaoGps(data.latitude),
		longitude: reduzirPrecisaoGps(data.longitude),
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

/** Evidência mínima de um termo de presença qualificado (Token A3), para o
 *  manifesto do relatório extraordinário distinguir avançada × qualificada. */
export interface TermoPresencaEvidencia {
	verification_hash: string | null;
	tipo_carimbo_tempo: string | null;
	created_at: string | null;
	ip_address: string | null;
	user_agent: string | null;
	latitude: number | null;
	longitude: number | null;
}

/**
 * Mapa das presenças confirmadas por Token A3 (qualificadas) de uma GISE,
 * indexado por `${policial_id}-${tipo}` (tipo: 'entrada' | 'saida'). A ausência
 * de chave significa que aquela presença foi de tela/mobile (avançada).
 */
export async function buscarTermosPresencaGise(
	db: Database,
	giseId: number
): Promise<Map<string, TermoPresencaEvidencia>> {
	const rows = await db
		.select({
			policial_id: gisePresencaTermos.policial_id,
			tipo: gisePresencaTermos.tipo,
			verification_hash: gisePresencaTermos.verification_hash,
			tipo_carimbo_tempo: gisePresencaTermos.tipo_carimbo_tempo,
			created_at: gisePresencaTermos.created_at,
			ip_address: gisePresencaTermos.ip_address,
			user_agent: gisePresencaTermos.user_agent,
			latitude: gisePresencaTermos.latitude,
			longitude: gisePresencaTermos.longitude
		})
		.from(gisePresencaTermos)
		.where(eq(gisePresencaTermos.gise_id, giseId))
		.all();

	const map = new Map<string, TermoPresencaEvidencia>();
	for (const r of rows) {
		// Re-confirmação: o último registro inserido prevalece.
		map.set(`${r.policial_id}-${r.tipo}`, {
			verification_hash: r.verification_hash,
			tipo_carimbo_tempo: r.tipo_carimbo_tempo,
			created_at: r.created_at,
			ip_address: r.ip_address,
			user_agent: r.user_agent,
			latitude: r.latitude,
			longitude: r.longitude
		});
	}
	return map;
}

/**
 * Termo de presença QUALIFICADO (Token A3) de UM policial numa dada GISE, por tipo
 * (entrada/saída). Devolve `r2_key` e `verification_hash` para servir o PDF assinado
 * já guardado no R2 (fluxo de download do comprovante). Em re-confirmação, o último
 * registro (maior `id`) prevalece. `null` quando a presença foi de tela (avançada).
 */
export async function buscarTermoPresencaGise(
	db: Database,
	giseId: number,
	policialId: number,
	tipo: 'entrada' | 'saida'
): Promise<{ r2_key: string | null; verification_hash: string | null } | null> {
	const row = await db
		.select({
			r2_key: gisePresencaTermos.r2_key,
			verification_hash: gisePresencaTermos.verification_hash
		})
		.from(gisePresencaTermos)
		.where(
			and(
				eq(gisePresencaTermos.gise_id, giseId),
				eq(gisePresencaTermos.policial_id, policialId),
				eq(gisePresencaTermos.tipo, tipo)
			)
		)
		.orderBy(desc(gisePresencaTermos.id))
		.get();
	return row ?? null;
}
