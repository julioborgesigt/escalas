/**
 * O gate de PRESENÇA: quando confirmar entrada ou saída é permitido.
 *
 * Duas regras, e as duas valiam só no `preparar-assinatura` — o finalizador
 * revalidava a participação e mais nada (FLW-GISE-008):
 *
 * - **janela de horário**: a confirmação só abre a partir do horário previsto.
 *   Estava escrita apenas no preparar, e a preparação é o passo BARATO: quem
 *   guardasse um `preparedPdf` e chamasse o finalizador depois passava por cima
 *   dela;
 * - **saída exige entrada**: sem a entrada registrada não existe saída para
 *   atestar. O `UPDATE` de saída não achava linha, o resultado era ignorado, e
 *   o endpoint gravava termo assinado e auditoria de SUCESSO para um ato que
 *   não aconteceu.
 *
 * As duas ficam aqui porque os dois endpoints precisam da MESMA resposta.
 * Duplicadas, divergem no primeiro estado novo — e foi o que já aconteceu: a
 * janela existia num lado e não no outro.
 *
 * Isto é a checagem PRÉVIA, que erra cedo e barato. A garantia de verdade da
 * segunda regra é o `WHERE entrada_timestamp IS NOT NULL` de `salvarSaidaGise`:
 * entre este gate e a gravação cabe uma requisição, e é a gravação que decide.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { conflict } from '../api';
import { gisePresencas } from '../schema';
import { horarioGiseLiberado } from '$lib/db';
import type { Database } from '$lib/db';

export type TipoPresenca = 'entrada' | 'saida';

/** O que `resolverParticipacaoGisePolicial` devolve e este gate consome. */
export interface ParticipacaoParaGate {
	horarioPrevisto?: { inicio: string; fim: string } | null;
	dataInicio?: string | null;
}

const RECUSADO = (resposta: Response) => ({ ok: false as const, resposta });
const LIBERADO = { ok: true as const };

export type ResultadoGate = { ok: true } | { ok: false; resposta: Response };

/**
 * A janela do horário previsto já abriu?
 *
 * Sem `horarioPrevisto` a GISE não define horário para esta pessoa, e não há
 * janela a impor — liberado.
 */
export function janelaDePresencaLiberada(
	part: ParticipacaoParaGate,
	tipo: TipoPresenca
): ResultadoGate {
	if (!part.horarioPrevisto || !part.dataInicio) return LIBERADO;

	const hora = tipo === 'entrada' ? part.horarioPrevisto.inicio : part.horarioPrevisto.fim;
	if (horarioGiseLiberado(part.dataInicio, hora)) return LIBERADO;

	return RECUSADO(
		conflict(
			`A confirmação de ${tipo === 'entrada' ? 'entrada' : 'saída'} ainda não está liberada ` +
				`(a partir das ${hora}).`
		)
	);
}

/**
 * O gate completo: janela liberada e, para saída, entrada já registrada.
 *
 * Chame ANTES de consumir o token de intenção e antes de gravar qualquer byte —
 * recusar cedo não custa nada, recusar depois custa o certificado consumido e
 * um blob órfão para compensar.
 */
export async function gateDePresenca(
	db: Database,
	part: ParticipacaoParaGate,
	giseId: number,
	policialId: number,
	tipo: TipoPresenca
): Promise<ResultadoGate> {
	const janela = janelaDePresencaLiberada(part, tipo);
	if (!janela.ok) return janela;

	if (tipo === 'saida') {
		const entrada = await db
			.select({ id: gisePresencas.id })
			.from(gisePresencas)
			.where(
				and(
					eq(gisePresencas.gise_id, giseId),
					eq(gisePresencas.policial_id, policialId),
					isNotNull(gisePresencas.entrada_timestamp)
				)
			)
			.get();

		if (!entrada) {
			return RECUSADO(
				conflict('Não há confirmação de ENTRADA registrada — a saída não pode ser assinada.')
			);
		}
	}

	return LIBERADO;
}
