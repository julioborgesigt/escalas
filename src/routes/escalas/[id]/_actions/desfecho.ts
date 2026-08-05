/**
 * O DESFECHO de uma mutação de `/escalas/[id]`: o que ficou registrado.
 *
 * `carregarEscalaComPermissao`, no `+page.server.ts`, é o preâmbulo — autentica,
 * confere a lotação e recusa escala finalizada ou assinada. Este arquivo é o
 * outro lado, e existe porque catorze actions inseriam, editavam, removiam,
 * reenviavam e reabriam escala sem deixar rastro: só duas das catorze chamavam
 * a auditoria (FLW-ESC-007). Trocar quem está de plantão num sábado é ato
 * administrativo com consequência funcional, e o histórico não sabia dizer quem
 * trocou.
 *
 * Diferente do desfecho da GISE, aqui não há invalidação a declarar: o
 * preâmbulo já recusa qualquer mutação de conteúdo depois da assinatura. O que
 * o evento precisa carregar são os ITENS — a mesma action serve para uma linha
 * e para trinta, e "editou a escala" sem dizer quantas pessoas mudaram de dia
 * não responde a pergunta que se faz a uma trilha.
 */
import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import type { Database } from '$lib/db';
import { auditarDoEvento, type AcaoAudit } from '$lib/db/audit';
import { policiais } from '$lib/server/schema';

/**
 * O nome que vai para a trilha. Uma consulta a mais por mutação, de propósito:
 * o `alvo_id` identifica, mas o console é lido por gente, e "matrícula 4821"
 * não responde "quem foi tirado do plantão de sábado".
 *
 * Em remoções, chame ANTES do delete — depois a linha não existe mais.
 */
export async function nomeDoPolicial(db: Database, id: number): Promise<string | null> {
	const p = await db
		.select({ nome: policiais.nome })
		.from(policiais)
		.where(eq(policiais.id, id))
		.get();
	return p?.nome ?? null;
}

/** O que a action precisa dizer sobre a mutação que acabou de gravar. */
export interface MudancaEscala {
	db: Database;
	escalaId: number;
	usuario: NonNullable<App.Locals['usuario']>;
	acao: AcaoAudit;
	/**
	 * Quem/o que a mutação atingiu. Um policial quando a action é sobre uma
	 * pessoa; a própria escala quando é sobre o conjunto (esvaziar, reabrir).
	 */
	alvo: { tipo: 'policial' | 'escala'; id: number | null; nome?: string | null };
	/** Frase que o operador lê na listagem, sem abrir os metadados. */
	detalhes: string;
	/**
	 * Quantas LINHAS de `escala_policiais` a mutação criou, mudou ou apagou.
	 *
	 * Obrigatório mesmo quando é 1: é o número que separa "corrigiu um horário"
	 * de "trocou o mês inteiro", e uma action que o omitisse tornaria a listagem
	 * inútil justamente nos casos grandes.
	 */
	itens: number;
	metadados?: Record<string, unknown> | null;
	dados_antes?: Record<string, unknown> | null;
	dados_depois?: Record<string, unknown> | null;
}

/**
 * Grava o evento da mutação. Chamada DEPOIS de a mutação ter dado certo — o
 * caminho de erro de cada action devolve `fail()` sem passar por aqui, que é
 * como "falha não pode simular sucesso" fica garantido.
 */
export async function registrarMudancaEscala(event: RequestEvent, m: MudancaEscala): Promise<void> {
	await auditarDoEvento(event, m.db, {
		acao: m.acao,
		usuario: m.usuario,
		entidade: 'escala',
		entidade_id: m.escalaId,
		alvo_tipo: m.alvo.tipo,
		alvo_id: m.alvo.id,
		alvo_nome: m.alvo.nome ?? null,
		detalhes: m.detalhes,
		metadados: { ...(m.metadados ?? {}), itens: m.itens },
		dados_antes: m.dados_antes ?? null,
		dados_depois: m.dados_depois ?? null
	});
}
