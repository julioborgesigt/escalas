/**
 * DB helpers para a tabela `aceites_termos`.
 *
 * Não há tabela de "termos" — o texto vigente fica em código
 * (src/lib/server/termo/termo-vigente.ts). Aqui guardamos só os
 * registros de aceite individuais.
 */

import { aceitesTermos } from '../server/schema';
import type { AceiteTermo } from '../server/schema';
import type { Database } from './core';
import { anonimizarIp } from './audit';
import { parseUserAgent } from '../server/assinatura/document-utils';

interface RegistrarAceiteInput {
	usuario_tipo: 'policial' | 'admin';
	usuario_id: number;
	versao_termo: string;
	hash_termo: string;
	aceitou_lgpd: boolean;
	aceitou_uso_email?: boolean;
	aceitou_uso_localizacao?: boolean;
	/**
	 * Aceite EXPRESSO da assinatura eletrônica avançada (Lei 14.063/2020 art. 4º II).
	 * Caixa obrigatória dedicada — base da oponibilidade da modalidade avançada.
	 */
	aceitou_assinatura_avancada: boolean;
	ip?: string | null;
	user_agent?: string | null;
	/**
	 * HTML do termo no momento do aceite. Preservado para reprodução
	 * em juízo sem depender de git history (a versão de código em produção
	 * na data do aceite pode ter sido sobrescrita por squash/rewrite).
	 */
	conteudo_html_snapshot?: string | null;
}

/**
 * Grava o aceite e devolve a linha inserida. É uma tabela de LOG: nunca
 * atualiza, cada aceite é uma linha nova, e a vigência é decidida na leitura
 * (`aceiteEhVigente` sobre o aceite mais recente). Termo novo publicado
 * simplesmente deixa os aceites antigos fora de vigência, sem apagá-los.
 *
 * IP e user-agent passam pela mesma minimização dos documentos assinados
 * (anonimizado / reduzido a navegador+SO). O `conteudo_html_snapshot` faz o
 * oposto de minimizar, de propósito: guarda o texto exato aceito, para que a
 * prova não dependa do histórico do Git.
 */
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
			aceitou_assinatura_avancada: input.aceitou_assinatura_avancada ? 1 : 0,
			ip: anonimizarIp(input.ip),
			user_agent: input.user_agent ? parseUserAgent(input.user_agent) : null,
			conteudo_html_snapshot: input.conteudo_html_snapshot ?? null
		})
		.returning()
		.get();
	return inserido;
}

/**
 * Predicado puro de vigência: o aceite corresponde à versão+hash vigentes?
 * Único ponto com a regra — usado por `temAceiteVigente` e pelo batch de
 * sessão em `$lib/auth` (`validarSessaoComAceite`).
 */
export function aceiteEhVigente(
	aceite: { versao_termo: string; hash_termo: string } | null | undefined,
	versao: string,
	hash: string
): boolean {
	return !!aceite && aceite.versao_termo === versao && aceite.hash_termo === hash;
}
