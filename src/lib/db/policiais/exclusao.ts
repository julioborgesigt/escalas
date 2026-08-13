/**
 * O que impede apagar o cadastro de um policial — FLW-POLICIAL-002.
 *
 * `excluirPolicial` é um DELETE físico, e seis tabelas vêm em cascata:
 * `escala_policiais`, `escala_solicitacoes_assinatura`, `gise_membros`,
 * `gise_presencas`, `gise_respostas_formulario` e `policial_historico`.
 *
 * Duas dessas doem de verdade. `gise_presencas` é o fato que o TERMO DE
 * PRESENÇA assinado atesta; `policial_historico` guarda `documento_r2_key`
 * apontando para portarias no bucket. Apagar o policial some com a presença e
 * com o histórico — e o PDF assinado **continua existindo**, agora
 * referenciando uma pessoa e um fato que o banco não tem mais.
 *
 * A regra decidida pelo operador não é "nunca apagar": é **nunca apagar o que
 * um documento assinado referencia**. Cadastro digitado errado ontem continua
 * podendo sumir; quem já foi atestado em documento, não — esse é desativado
 * (`atualizarPolicial(db, id, { ativo: 0 })`), que preserva tudo e já era o
 * caminho recomendado no próprio `excluirPolicial`.
 *
 * As quatro perguntas abaixo são as formas de um policial aparecer num
 * documento assinado. Duas por AUTORIA (ele assinou) e duas por MENÇÃO (o
 * documento o lista). As duas contam: um PDF que lista alguém inexistente é tão
 * inconsistente quanto um assinado por alguém inexistente.
 */
import { eq, sql } from 'drizzle-orm';
import {
	escalaDocumentos,
	escalaPoliciais,
	giseAssinaturasRelatorios,
	giseDocumentos,
	giseEquipes,
	giseMembros,
	giseSeccionais,
	gisePresencaTermos
} from '../../server/schema';
import type { Database } from '../core';

/** Onde o policial aparece em documento assinado. Zero em tudo = pode apagar. */
export interface VinculosAssinados {
	/** Termos de presença emitidos para ele. */
	termosPresenca: number;
	/** Relatórios de extra que ele assinou. */
	relatoriosAssinados: number;
	/** Escalas ASSINADAS em que ele está escalado. */
	escalasAssinadas: number;
	/** GISEs ASSINADAS de que ele é membro. */
	gisesAssinadas: number;
}

const total = (r: { n: number } | undefined) => Number(r?.n ?? 0);

/**
 * Conta, por tipo, os documentos assinados que referenciam o policial.
 *
 * Uma consulta por pergunta em vez de um `UNION`: o chamador precisa dizer ao
 * operador QUAL vínculo impede a exclusão, e um total agregado só responderia
 * "não pode" sem dizer por quê.
 */
export async function vinculosAssinadosDoPolicial(
	db: Database,
	policialId: number
): Promise<VinculosAssinados> {
	const [termos, relatorios, escalasAss, gisesAss] = await Promise.all([
		db
			.select({ n: sql<number>`count(*)` })
			.from(gisePresencaTermos)
			.where(eq(gisePresencaTermos.policial_id, policialId))
			.get(),
		db
			.select({ n: sql<number>`count(*)` })
			.from(giseAssinaturasRelatorios)
			.where(eq(giseAssinaturasRelatorios.assinante_id, policialId))
			.get(),
		// Menção: ele está na escala, e a escala tem documento assinado.
		db
			.select({ n: sql<number>`count(*)` })
			.from(escalaPoliciais)
			.innerJoin(escalaDocumentos, eq(escalaDocumentos.escala_id, escalaPoliciais.escala_id))
			.where(eq(escalaPoliciais.policial_id, policialId))
			.get(),
		// Idem para GISE, subindo membro → equipe → seccional → escala.
		db
			.select({ n: sql<number>`count(*)` })
			.from(giseMembros)
			.innerJoin(giseEquipes, eq(giseMembros.equipe_id, giseEquipes.id))
			.innerJoin(giseSeccionais, eq(giseEquipes.gise_seccional_id, giseSeccionais.id))
			.innerJoin(giseDocumentos, eq(giseDocumentos.gise_id, giseSeccionais.gise_id))
			.where(eq(giseMembros.policial_id, policialId))
			.get()
	]);

	return {
		termosPresenca: total(termos),
		relatoriosAssinados: total(relatorios),
		escalasAssinadas: total(escalasAss),
		gisesAssinadas: total(gisesAss)
	};
}

/** Rótulo de cada vínculo, para a mensagem que o operador lê. */
const ROTULOS: Record<keyof VinculosAssinados, string> = {
	termosPresenca: 'termo(s) de presença',
	relatoriosAssinados: 'relatório(s) de extra assinado(s)',
	escalasAssinadas: 'escala(s) assinada(s)',
	gisesAssinadas: 'GISE(s) assinada(s)'
};

/**
 * `null` quando pode apagar; a mensagem do impedimento quando não pode.
 *
 * A mensagem NOMEIA os vínculos porque a alternativa — desativar — é uma
 * decisão que o operador só toma sabendo o que está preservando.
 */
export function motivoParaNaoExcluir(v: VinculosAssinados): string | null {
	const partes = (Object.keys(ROTULOS) as (keyof VinculosAssinados)[])
		.filter((k) => v[k] > 0)
		.map((k) => `${v[k]} ${ROTULOS[k]}`);

	if (partes.length === 0) return null;
	return (
		`Este policial é referenciado por ${partes.join(', ')}. ` +
		'Documento assinado não pode passar a citar alguém que não existe mais — ' +
		'use a desvinculação, que inativa o cadastro e preserva o histórico.'
	);
}

/**
 * Atalho para os chamadores: consulta e já devolve o impedimento, ou `null`.
 */
export async function impedimentoParaExcluirPolicial(
	db: Database,
	policialId: number
): Promise<string | null> {
	return motivoParaNaoExcluir(await vinculosAssinadosDoPolicial(db, policialId));
}
