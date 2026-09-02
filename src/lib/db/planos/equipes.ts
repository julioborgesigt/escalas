/**
 * As equipes de um plano operacional.
 *
 * ## `NULL` é herança, não vazio
 *
 * `data_inicio`, `hora_inicio`, `hora_fim` e `local_briefing` nulos significam
 * **herda do plano**. Isso é o que faz mudar o horário do plano alcançar as
 * equipes que não têm horário próprio — se a criação copiasse o valor do plano
 * para cada equipe, elas congelariam no horário do dia em que foram criadas e a
 * correção do plano não chegaria a nenhuma.
 *
 * `janelaDaEquipe` é a fonte única dessa cascata. Quem precisa do horário
 * efetivo de uma equipe chama ela, e não lê a coluna direto — ler direto é como
 * o horário do plantão acabou com `'08:00'` numa tela e `'08'` nas outras
 * (tabela de duplicação do `CLAUDE.md`).
 *
 * ## Ordem e nome são coisas diferentes
 *
 * `ordem` decide a posição no Anexo I; `nome` é editável e pode virar qualquer
 * coisa ("Equipe Alfa"). Derivar a apresentação do nome faria "Equipe 10"
 * aparecer entre a 1 e a 2.
 */
import { asc, eq } from 'drizzle-orm';
import { planoEquipes } from '../../server/schema';
import type { PlanoEquipe, PlanoOperacional } from '../../server/schema';
import { batchNonEmpty, linhasAfetadas, type Database } from '../core';
import type { JanelaOperacao } from '../../planos/horas-extras';
import { calcularDataSaida } from '../../utils/datas';

/** Os campos que a tela edita numa equipe. */
export type PatchEquipe = Partial<{
	nome: string;
	tipo: 'operacional' | 'seint';
	viatura_modelo: string;
	viatura_placa: string;
	data_inicio: string | null;
	hora_inicio: string | null;
	hora_fim: string | null;
	cidade_origem: string;
	cidade_destino: string;
	distancia_km: number | null;
	local_briefing: string | null;
	tipo_custo: 'sem_custo' | 'hora_extra' | 'diaria';
	horas_normais: number;
	horas_plus: number;
	diaria_tipo: 'estadual' | 'interestadual' | null;
	diarias_meias: number;
}>;

/** Nome padrão da n-ésima equipe: `Equipe 01`, `Equipe 02`… */
export function nomePadraoEquipe(ordem: number): string {
	return `Equipe ${String(ordem).padStart(2, '0')}`;
}

/** As equipes do plano, na ordem em que o Anexo I as imprime. */
export async function listarEquipes(db: Database, planoId: number): Promise<PlanoEquipe[]> {
	return db
		.select()
		.from(planoEquipes)
		.where(eq(planoEquipes.plano_id, planoId))
		.orderBy(asc(planoEquipes.ordem), asc(planoEquipes.id))
		.all();
}

/** Uma equipe pelo id, ou `null`. */
export async function buscarEquipe(db: Database, id: number): Promise<PlanoEquipe | null> {
	const row = await db.select().from(planoEquipes).where(eq(planoEquipes.id, id)).get();
	return row ?? null;
}

/**
 * Cria `quantidade` equipes operacionais numeradas em sequência, mais uma SEINT
 * quando pedida, e devolve os ids na ordem criada.
 *
 * A `ordem` continua de onde a última parou, para acrescentar equipe a um plano
 * já montado não colidir com as existentes.
 */
export async function criarEquipes(
	db: Database,
	planoId: number,
	opts: {
		quantidade: number;
		comSeint?: boolean;
		/** Opção padrão de briefing do plano, copiada para cada equipe nova. */
		briefingPadrao?: string;
		/** Opção padrão de origem do plano, copiada para cada equipe nova. */
		origemPadrao?: string;
		/** Opção padrão de destino do plano, copiada para cada equipe nova. */
		destinoPadrao?: string;
	}
): Promise<number[]> {
	const existentes = await listarEquipes(db, planoId);
	let ordem = existentes.reduce((max, e) => Math.max(max, e.ordem), 0);

	const novas: Array<{
		plano_id: number;
		ordem: number;
		nome: string;
		tipo: 'operacional' | 'seint';
		local_briefing: string;
		cidade_origem: string;
		cidade_destino: string;
	}> = [];

	// Os padrões do plano entram COPIADOS, não herdados por cascata: a equipe é
	// dona do que o documento imprime, e trocar a opção padrão depois não pode
	// reescrever o destino de equipes já montadas.
	//
	// `distancia_km` NÃO é copiada, e não há padrão dela: a distância é do PAR
	// origem→destino daquela equipe. Copiar a de outra equipe embutiria no
	// cálculo da diária um número que ninguém mediu para este trajeto.
	const briefing = opts.briefingPadrao?.trim() ?? '';
	const origem = opts.origemPadrao?.trim() ?? '';
	const destino = opts.destinoPadrao?.trim() ?? '';

	for (let i = 0; i < opts.quantidade; i++) {
		ordem += 1;
		novas.push({
			plano_id: planoId,
			ordem,
			nome: nomePadraoEquipe(ordem),
			tipo: 'operacional',
			local_briefing: briefing,
			cidade_origem: origem,
			cidade_destino: destino
		});
	}

	if (opts.comSeint) {
		ordem += 1;
		// A SEINT nasce nomeada pelo que é, não por número: ela é uma só e atende
		// todas as operacionais, então "Equipe 04" esconderia a função dela.
		novas.push({
			plano_id: planoId,
			ordem,
			nome: 'Equipe SEINT',
			tipo: 'seint',
			local_briefing: briefing,
			cidade_origem: origem,
			cidade_destino: destino
		});
	}

	if (novas.length === 0) return [];

	const linhas = await db.insert(planoEquipes).values(novas).returning({ id: planoEquipes.id });
	return linhas.map((l) => l.id);
}

/** Patch da equipe. Chaves ausentes não são tocadas. */
export async function atualizarEquipe(
	db: Database,
	id: number,
	dados: PatchEquipe
): Promise<boolean> {
	const r = await db.update(planoEquipes).set(dados).where(eq(planoEquipes.id, id));
	return linhasAfetadas(r) > 0;
}

/** Exclui a equipe. Os membros vão junto pelo CASCADE. */
export async function excluirEquipe(db: Database, id: number): Promise<boolean> {
	const r = await db.delete(planoEquipes).where(eq(planoEquipes.id, id));
	return linhasAfetadas(r) > 0;
}

/**
 * Renumera as equipes de um plano em 1..N, na ordem atual.
 *
 * Chamada depois de excluir uma equipe do meio, para não ficar um buraco na
 * sequência do Anexo I. **Não renomeia**: a equipe que o admin batizou de
 * "Equipe Alfa" continua Alfa, e a que ficou com o nome padrão continua com o
 * nome que já estava impresso em qualquer rascunho baixado — renomear em massa
 * transformaria uma exclusão numa mudança silenciosa de todo o documento.
 */
export async function renumerarEquipes(db: Database, planoId: number): Promise<void> {
	const equipes = await listarEquipes(db, planoId);
	const desalinhadas = equipes
		.map((e, i) => ({ id: e.id, nova: i + 1, atual: e.ordem }))
		.filter((e) => e.atual !== e.nova);
	if (desalinhadas.length === 0) return;

	// Um UPDATE por equipe, em lote — e não um `UPDATE ... SET ordem = (subquery
	// correlacionada)`. Duas razões, ambas medidas: o drizzle qualifica a coluna
	// do SET (`SET "plano_equipes"."ordem" = ...`), que o SQLite recusa; e numa
	// subconsulta correlacionada ele emite as colunas SEM qualificar, o que muda
	// silenciosamente a que tabela elas pertencem. Uma equipe são poucas linhas —
	// não vale um SQL que só funciona por sorte.
	await batchNonEmpty(
		db,
		desalinhadas.map((e) =>
			db.update(planoEquipes).set({ ordem: e.nova }).where(eq(planoEquipes.id, e.id))
		)
	);
}

/**
 * A janela efetiva de uma equipe — a cascata equipe → plano, com o primeiro
 * não-nulo vencendo.
 *
 * Fonte ÚNICA do horário efetivo: é o que a sugestão de horas, a tela e o PDF
 * consultam. Cada um lendo `equipe.hora_inicio ?? plano.hora_inicio` por conta
 * própria é como as três cópias divergem — e aqui a divergência sairia como
 * hora extra a mais ou a menos no documento.
 */
export function janelaDaEquipe(
	equipe: Pick<PlanoEquipe, 'data_inicio' | 'hora_inicio' | 'hora_fim'>,
	plano: Pick<PlanoOperacional, 'data_inicio' | 'hora_inicio' | 'data_fim' | 'hora_fim' | 'feriado'>
): JanelaOperacao {
	const dataInicio = equipe.data_inicio ?? plano.data_inicio;
	const horaInicio = equipe.hora_inicio ?? plano.hora_inicio;
	const horaFim = equipe.hora_fim ?? plano.hora_fim;

	// A equipe não tem `data_fim` própria — ela é DERIVADA do par de horários,
	// que é o mesmo desenho de `calcularDataSaida` no plantão das escalas.
	//
	// A coluna chegou a ser cogitada e recusada por "não haver caso de uso
	// conhecido". Há: equipe que sai às 23h da véspera para garantir a chegada.
	// Sem derivar, `hora_fim < hora_inicio` no mesmo dia é uma janela invertida, e
	// `classificarJanela` devolve TUDO ZERADO — a equipe que rodou a noite inteira
	// fica sem hora nenhuma sugerida, em silêncio. A `data_fim` do plano cobria o
	// caso por acidente, quando estava preenchida, porque ela descreve a operação
	// e não aquela equipe.
	//
	// Sem hora de fim não há janela para virar o dia — e `calcularDataSaida` leria
	// a string vazia como meia-noite, empurrando a data para a frente.
	const viraODia = horaFim ? calcularDataSaida(dataInicio, horaInicio, horaFim) : dataInicio;

	return {
		dataInicio,
		horaInicio,
		// O fim do PLANO ainda vale como teto: operação de vários dias tem a data
		// dela, e a equipe não termina depois do que a operação declarou.
		dataFim: plano.data_fim && plano.data_fim > viraODia ? plano.data_fim : viraODia,
		horaFim,
		feriado: plano.feriado
	};
}

/**
 * O local de briefing efetivo: o da equipe, ou o VALOR da opção padrão do plano.
 *
 * Mesma cascata de `janelaDaEquipe`, e pelo mesmo motivo — o Anexo I imprime
 * este texto por equipe.
 *
 * O segundo argumento é o valor já resolvido (ver `valorPadrao` em
 * `opcoes.ts`), e não o plano: desde que as opções viraram lista, "o padrão do
 * plano" é uma linha de outra tabela, e passar o plano inteiro aqui obrigaria
 * esta função a consultá-la.
 */
export function briefingDaEquipe(
	equipe: Pick<PlanoEquipe, 'local_briefing'>,
	padrao: string
): string {
	const proprio = equipe.local_briefing?.trim();
	return proprio ? proprio : padrao;
}

/**
 * A cidade de destino efetiva: a da equipe, ou a opção padrão do plano.
 *
 * Gêmea de `briefingDaEquipe`. As duas existem porque o Anexo I imprime os
 * dois campos por equipe, e equipe com o campo em branco não é equipe sem
 * destino — é equipe que ficou no destino que a operação declarou.
 */
export function destinoDaEquipe(
	equipe: Pick<PlanoEquipe, 'cidade_destino'>,
	padrao: string
): string {
	const proprio = equipe.cidade_destino?.trim();
	return proprio ? proprio : padrao;
}

/**
 * A cidade de ORIGEM efetiva: a da equipe, ou a opção padrão do plano.
 *
 * Terceira da mesma família. Existe porque é ela, com o destino, que mede o
 * deslocamento — e é o deslocamento que decide entre diária e hora extra (ver
 * `sugerirCusteio` em `$lib/planos/custeio`). Uma equipe sem origem própria
 * saiu de onde a operação declarou que todas saem.
 */
export function origemDaEquipe(equipe: Pick<PlanoEquipe, 'cidade_origem'>, padrao: string): string {
	const proprio = equipe.cidade_origem?.trim();
	return proprio ? proprio : padrao;
}
