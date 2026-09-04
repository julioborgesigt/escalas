/**
 * Teto de varredura do hash no portal público de validação.
 *
 * O código de verificação tem ~40 bits. Enumerá-lo inteiro é inviável, e não é
 * disso que se trata: o portal é público DE PROPÓSITO — ele existe para que
 * qualquer pessoa confira um documento sem ter conta. O que o teto impede é a
 * varredura barata, que custa uma consulta ao D1 por tentativa e não deixa
 * ninguém de fora quando ausente.
 *
 * **Duas portas, e até ago/2026 só uma tinha teto.** A rota de DOWNLOAD já
 * limitava (FLW-AUT-016) e a PÁGINA não — e é a página que responde "este hash
 * existe?", sem sessão nenhuma. Proteger o download e deixar a página aberta é a
 * forma que este projeto cataloga: a regra certa num caminho, ausente no irmão.
 * Este módulo existe para que as duas façam a MESMA pergunta, e é por isso que
 * ele devolve um VEREDITO em vez de uma `Response`: a rota de API responde 429,
 * a página precisa renderizar um estado — a mesma decisão não cabe nas duas
 * formas.
 *
 * **Propósitos separados**, como manda o desenho de `recovery_attempts`: um
 * flood de consultas não pode consumir o orçamento de quem baixa, nem
 * vice-versa. São atos diferentes, com custos e públicos diferentes.
 *
 * O que isto NÃO é: defesa contra varredura distribuída, que não se resolve
 * contando por IP e sim na borda. É o teto que impede UMA origem de varrer à
 * vontade — o caso comum, e o único que este código enxerga.
 */

import { contarRecoveryAttempts, registrarRecoveryAttempt } from '../auth/recovery-rate-limit';
import { logger } from '../logger';
import { mensagemDeErro } from '$lib/utils/erro';
import type { Database } from '$lib/db';

/** Janela de contagem das duas portas, em minutos. */
export const VALIDAR_WINDOW_MIN = 10;

/**
 * Teto do DOWNLOAD do PDF íntegro — exige sessão, então o alcance de quem varre
 * já é menor. Valor herdado da implementação original (FLW-AUT-016).
 */
export const VALIDAR_DOWNLOAD_MAX = 60;

/**
 * Teto da CONSULTA da página — mais folgado que o do download, e de propósito.
 *
 * A página é anônima, então o IP é a única chave disponível; e um IP anônimo é
 * frequentemente um NAT inteiro (a corporação, um evento onde muita gente lê o
 * mesmo QR). Apertar aqui trancaria gente legítima em bloco, que é o efeito
 * colateral que `chaveRateLimitIp` descreve para a /24. Cento e vinte consultas
 * em dez minutos é muito acima de qualquer uso humano em série e muito abaixo do
 * que uma varredura precisa para ser útil.
 */
export const VALIDAR_CONSULTA_MAX = 120;

/** As duas portas do portal, isoladas uma da outra no contador. */
export type PortaDeValidacao = 'validar_download' | 'validar_consulta';

/**
 * `'liberado'` segue; `'excedido'` estourou o teto; `'indisponivel'` é o
 * contador fora do ar.
 *
 * `'indisponivel'` é um veredito próprio, e não um `'liberado'` otimista, porque
 * o chamador precisa FALHAR FECHADO: D1 fora não pode virar enumeração livre
 * (FLW-AUT-016). Ele também não é `'excedido'` — a mensagem que o usuário vê
 * muda, e dizer "muitas tentativas" a quem não fez nenhuma manda a pessoa
 * esperar por um motivo que não existe.
 */
export type VeredictoDeTeto = 'liberado' | 'excedido' | 'indisponivel';

/**
 * Consulta e REGISTRA a tentativa. Chame uma vez por requisição.
 *
 * Registra sempre que libera, porque aqui o que se cobra é a consulta em si —
 * diferente dos usos de autenticação da mesma tabela, que só contam a falha.
 */
export async function tetoDeVarreduraDeHash(
	db: Database,
	ip: string,
	porta: PortaDeValidacao,
	hash: string
): Promise<VeredictoDeTeto> {
	const max = porta === 'validar_download' ? VALIDAR_DOWNLOAD_MAX : VALIDAR_CONSULTA_MAX;
	try {
		const { blocked } = await contarRecoveryAttempts(db, ip, porta, VALIDAR_WINDOW_MIN, max);
		if (blocked) {
			logger.warn(`[${porta}] Rate-limit excedido`, { hash });
			return 'excedido';
		}
		await registrarRecoveryAttempt(db, ip, porta);
		return 'liberado';
	} catch (err) {
		logger.error(`[${porta}] Falha no rate-limit (fail-closed)`, {
			hash,
			error: mensagemDeErro(err)
		});
		return 'indisponivel';
	}
}
