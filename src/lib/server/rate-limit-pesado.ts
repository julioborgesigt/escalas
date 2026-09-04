/**
 * Teto de requisições para as rotas que GERAM documento — PDF de escala,
 * comprovante, relatório, export.
 *
 * Estas rotas são autenticadas e autorizadas: quem chega nelas tem direito ao
 * que pede. O que faltava não era permissão, era CUSTO. Montar um PDF assinado
 * lê o D1, busca o blob no R2, remonta o documento e recalcula hash — dezenas
 * de vezes o preço de um GET comum. Sem teto, uma conta legítima em laço
 * (script de usuário, retry agressivo de app, aba recarregando) consome a
 * quota do Worker para todo mundo. É indisponibilidade servida pela porta da
 * frente, sem precisar de invasor.
 *
 * **Conta por USUÁRIO, não por IP**, e isso é a decisão do módulo. O
 * `chaveRateLimitIp` avisa que, sem `RATE_LIMIT_IP_SALT`, a chave degrada para
 * a /24 — "5 falhas bloqueiam a /24 inteira (ex.: o NAT da corporação)". Numa
 * polícia, é exatamente o caso: a delegacia inteira sai pelo mesmo endereço, e
 * limitar por IP faria um plantão derrubar o acesso dos colegas. Como aqui há
 * sessão, dá para cobrar de quem gastou: a chave sintética
 * `pesado:<tipo>:<id>` isola cada conta, e quem abusa se limita sozinho.
 *
 * Reusa `recovery_attempts` — que, no nível do banco, é um log genérico
 * `(ip, purpose, attempted_at)` sem CHECK na coluna `purpose` (ver a nota em
 * `schema.ts` e a migration 0022). Purpose próprio, então um flood daqui não
 * infla o contador de login nem o de reset, e vice-versa. Sem migration.
 *
 * Sendo preciso sobre o que isto NÃO é: não é defesa contra DDoS distribuído
 * (que se resolve na borda, na Cloudflare, e não aqui) nem contra quem tenha
 * várias contas. É o teto que impede UMA conta de monopolizar a geração — o
 * caso comum, e o único que este código consegue enxergar.
 */

import { contarRecoveryAttempts, registrarRecoveryAttempt } from './auth/recovery-rate-limit';
import { rateLimited } from './api';
import type { Database } from '$lib/db';

/** Janela de contagem, em minutos. */
export const JANELA_PESADA_MIN = 10;

/**
 * Quantas gerações uma conta pode disparar na janela.
 *
 * Folgado de propósito: o uso legítimo mais pesado é o admin que baixa os
 * documentos de uma escala inteira em sequência, e o teto não pode transformar
 * o trabalho normal dele em erro. O alvo é o laço, que passa disto em segundos.
 */
export const MAX_PESADO_POR_JANELA = 40;

/** Quem está pedindo — o suficiente para montar a chave. */
export interface AtorPesado {
	tipo: string;
	id: number;
}

/**
 * Recusa com 429 quando a conta estourou o teto; devolve `null` para seguir.
 *
 * Registra a tentativa SEMPRE que libera, porque aqui o que se cobra é o custo
 * de gerar — diferente dos usos de autenticação da mesma tabela, que só contam
 * a FALHA. Chame depois da autorização: o 429 não deve vazar para quem nem
 * podia pedir aquele documento.
 *
 * @example
 *   const excedeu = await limitarGeracaoPesada(db, u);
 *   if (excedeu) return excedeu;
 */
export async function limitarGeracaoPesada(
	db: Database,
	usuario: AtorPesado
): Promise<Response | null> {
	const chave = `pesado:${usuario.tipo}:${usuario.id}`;
	const { blocked } = await contarRecoveryAttempts(
		db,
		chave,
		'geracao_pesada',
		JANELA_PESADA_MIN,
		MAX_PESADO_POR_JANELA
	);
	if (blocked) {
		return rateLimited(
			`Muitos downloads seguidos. Aguarde ${JANELA_PESADA_MIN} minutos e tente novamente.`
		);
	}
	await registrarRecoveryAttempt(db, chave, 'geracao_pesada');
	return null;
}
