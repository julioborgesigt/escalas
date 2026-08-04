/**
 * CRUD da escala GISE — a linha de `gise_escalas` e a árvore que pende dela:
 *
 *     gise_escalas
 *       └── gise_seccionais            (uma por seccional participante)
 *             └── gise_seccional_unidades  ("slots": qual unidade ocupa a vaga)
 *                   └── gise_equipes       (operacional | seint, com nº de vagas)
 *                         └── gise_membros (os policiais)
 *
 * Regra de negócio central do módulo: **só existe uma GISE não finalizada por
 * vez**. É isso que `buscarGiseAtiva` assume, e é o que faz `/gise` conseguir
 * abrir "a" escala corrente sem que o usuário escolha nada.
 *
 * A regra NÃO é protegida por constraint nem serializada na criação — só
 * assumida (achado FLW-GISE-010 em
 * docs/auditorias/PLANO_AUDITORIA_FLUXOS_INTEGRIDADE_2026-08-02.md). Se mais
 * de uma GISE ativa existir, `buscarGiseAtiva` escolhe a mais recente por
 * `data_inicio` e as demais ficam ocultas em silêncio, sem erro.
 *
 * O ciclo de status (`em_definicao_supervisor` → `em_preenchimento` →
 * `aguardando_assinatura` → `em_andamento` → `aguardando_relatorios` →
 * `aguardando_assinatura_relat` → `pronta_para_finalizar` → `finalizada`) é
 * dirigido por `escalas-status.ts`; aqui só se GRAVA o status que aquele módulo
 * decidiu.
 */
import { eq, and, ne, isNotNull, desc, inArray, sql } from 'drizzle-orm';
import {
	giseEscalas,
	giseSeccionais,
	giseEquipes,
	giseSeccionalUnidades,
	giseDocumentos,
	giseAssinaturasRelatorios,
	gisePresencas,
	unidades
} from '../../server/schema';
import type * as schema from '../../server/schema';
import type { Database } from '../core';
import { buscarVagasPadraoEquipesGise } from './vagas-padrao';
import { criarSlotComEquipesPadrao } from './seccionais';

/** Linha crua de `gise_escalas`, sem nada da árvore de seccionais/equipes. */
export async function buscarGiseEscala(
	db: Database,
	id: number
): Promise<schema.GiseEscala | undefined> {
	return db.select().from(giseEscalas).where(eq(giseEscalas.id, id)).get();
}

/**
 * A GISE corrente — a mais recente que ainda não foi finalizada — enriquecida
 * com três contadores que a UI usa para decidir o que mostrar:
 *
 * - `temSaidaConfirmada`: alguém já registrou saída. Marca a escala como "em
 *   encerramento" mesmo antes do status mudar;
 * - `totalSeccionais`: se for 0, a escala foi criada em branco e ainda não tem
 *   seccional nenhuma — a tela pede a montagem antes de qualquer outra coisa;
 * - `assinaturasRelatorioExtra`: assinaturas do relatório do quadro de
 *   supervisão (`tipo = 'extraordinario'`), contadas à parte porque esse quadro
 *   não pertence a nenhuma seccional.
 *
 * Devolve `undefined` quando todas estão finalizadas — estado normal entre uma
 * GISE e a próxima, não erro.
 */
export async function buscarGiseAtiva(db: Database) {
	const ativa = await db
		.select()
		.from(giseEscalas)
		.where(ne(giseEscalas.status, 'finalizada'))
		.orderBy(desc(giseEscalas.data_inicio))
		.get();

	if (!ativa) return undefined;

	const [temSaida, totalSecRow, assExtraRow] = await Promise.all([
		db
			.select({ id: gisePresencas.id })
			.from(gisePresencas)
			.where(and(eq(gisePresencas.gise_id, ativa.id), isNotNull(gisePresencas.saida_timestamp)))
			.limit(1)
			.get(),
		db
			.select({ count: sql<number>`count(*)` })
			.from(giseSeccionais)
			.where(eq(giseSeccionais.gise_id, ativa.id))
			.get(),
		db
			.select({ count: sql<number>`count(*)` })
			.from(giseAssinaturasRelatorios)
			.where(
				and(
					eq(giseAssinaturasRelatorios.gise_id, ativa.id),
					eq(giseAssinaturasRelatorios.tipo, 'extraordinario')
				)
			)
			.get()
	]);

	return {
		...ativa,
		temSaidaConfirmada: !!temSaida,
		totalSeccionais: totalSecRow?.count ?? 0,
		assinaturasRelatorioExtra: assExtraRow?.count ?? 0
	};
}

/**
 * Cria a escala VAZIA e devolve o id — sem seccionais, sem equipes. Montar a
 * árvore é do chamador (`/gise` cria as seccionais em seguida no modo
 * "completa"), ou de `clonarGiseParaData`, que faz as duas coisas.
 *
 * `feriado` é `boolean` na API e `0|1` na coluna; a conversão fica aqui para
 * que nenhum chamador precise saber disso.
 */
export async function criarGiseEscala(
	db: Database,
	dataInicio: string,
	horaEntrada: string,
	horaSaida: string,
	statusInicial: 'em_definicao_supervisor' | 'em_preenchimento' = 'em_definicao_supervisor',
	feriado = false
): Promise<number> {
	const result = await db
		.insert(giseEscalas)
		.values({
			data_inicio: dataInicio,
			feriado: feriado ? 1 : 0,
			hora_entrada: horaEntrada,
			hora_saida: horaSaida,
			status: statusInicial
		})
		.returning({ id: giseEscalas.id });
	return result[0].id;
}

/**
 * Patch da linha da escala: escreve exatamente os campos recebidos. É por onde
 * passam tanto o avanço de status quanto a designação do quadro de supervisão
 * (`supervisor_id`, `assessor_id`, `seint1_id`, `seint2_id`).
 *
 * Não valida a transição de status — quem decide é `escalas-status.ts`. Chamar
 * com um status arbitrário coloca a escala nesse estado sem checagem alguma.
 */
export async function atualizarGiseEscala(
	db: Database,
	id: number,
	data: Partial<{
		data_inicio: string;
		hora_entrada: string;
		hora_saida: string;
		status:
			| 'em_definicao_supervisor'
			| 'em_preenchimento'
			| 'aguardando_assinatura'
			| 'em_andamento'
			| 'aguardando_relatorios'
			| 'aguardando_assinatura_relat'
			| 'pronta_para_finalizar'
			| 'finalizada';
		supervisor_id: number | null;
		assessor_id: number | null;
		seint1_id: number | null;
		seint2_id: number | null;
		assessor_email_notificacao: string | null;
		breve_relatorio_titulo: string | null;
		breve_relatorio_texto_seccional: string | null;
		breve_relatorio_texto_supervisao: string | null;
		planilha_base_equipe_alimentada_em: string | null;
	}>
) {
	return db.update(giseEscalas).set(data).where(eq(giseEscalas.id, id));
}

/**
 * DESFAZ o encerramento da escala: apaga documentos assinados, assinaturas de
 * relatório e presenças, e volta o status para `em_preenchimento`.
 *
 * É destrutivo por desenho — reabrir significa que a escala vai ser refeita e
 * reassinada, então as evidências do ciclo anterior não podem sobreviver e
 * confundir a conferência.
 *
 * **Apaga apenas as LINHAS.** Os blobs correspondentes no R2 (PDF assinado,
 * cópias de conferência e selfies de presença) ficam órfãos se o chamador não
 * limpar antes — ver `limparR2DaGise` no endpoint de revogação (R2-2/R2-3).
 * A ordem importa: R2 primeiro, banco depois, porque é a linha que diz quais
 * objetos existem.
 *
 * As seccionais e equipes NÃO são tocadas: a composição continua montada, é o
 * preenchimento que recomeça.
 */
export async function reabrirGiseEscala(db: Database, giseId: number) {
	// Todas as operações são independentes — executa em paralelo
	await Promise.all([
		db.delete(giseDocumentos).where(eq(giseDocumentos.gise_id, giseId)),
		db.delete(giseAssinaturasRelatorios).where(eq(giseAssinaturasRelatorios.gise_id, giseId)),
		db.delete(gisePresencas).where(eq(gisePresencas.gise_id, giseId)),
		atualizarGiseEscala(db, giseId, {
			status: 'em_preenchimento',
			planilha_base_equipe_alimentada_em: null
		})
	]);
}

/**
 * Cria uma GISE nova para `novaData` reaproveitando a estrutura de outra — o
 * caminho normal de abrir a escala do próximo plantão, já que a composição
 * costuma repetir.
 *
 * Dois modos:
 * - `'clonada'` — copia as seccionais da GISE de origem com seus slots e
 *   equipes (tipo e número de vagas). **Membros e presenças não vêm junto**: a
 *   escala nova nasce vazia de gente, para ser preenchida do zero;
 * - `'completa'` — ignora a origem e cria uma seccional para CADA unidade do
 *   tipo `seccional` cadastrada.
 *
 * A parte delicada é o remapeamento de ids. Equipe aponta para slot
 * (`gise_unidade_id`), e slot aponta para seccional; copiar os ids antigos
 * faria a escala nova apontar para a árvore da velha. Daí os dois mapas
 * `old id → new id` (`secIdMap`, `slotIdMap`) e os inserts SEQUENCIAIS: cada
 * `returning` precisa ser conhecido antes do insert que o referencia, e o D1
 * não permite aninhar transações em `batch`.
 *
 * Fechamento de lacuna: seccional que terminar sem nenhum slot (sempre no modo
 * `'completa'`, ou na origem incompleta) ganha um slot vazio e o par de equipes
 * padrão operacional + SEINT, com as vagas de `buscarVagasPadraoEquipesGise`.
 * Assim nenhuma seccional nasce impossível de preencher.
 *
 * A escala nova nasce sempre em `em_definicao_supervisor`, independentemente do
 * status da origem, e herda hora de entrada/saída e feriado quando os
 * parâmetros correspondentes não são passados.
 */
export async function clonarGiseParaData(
	db: Database,
	giseId: number,
	novaData: string,
	modo: 'clonada' | 'completa' = 'clonada',
	horaEntrada?: string,
	horaSaida?: string,
	feriado?: boolean
): Promise<number> {
	const gise = await db.select().from(giseEscalas).where(eq(giseEscalas.id, giseId)).get();
	if (!gise) throw new Error('GISE não encontrada');

	const feriadoNovo = feriado ?? !!gise.feriado;
	const novoId = await criarGiseEscala(
		db,
		novaData,
		horaEntrada ?? gise.hora_entrada,
		horaSaida ?? gise.hora_saida,
		'em_definicao_supervisor',
		feriadoNovo
	);

	const secsParaClonar: { seccional_id: number; id?: number }[] =
		modo === 'clonada'
			? await db.select().from(giseSeccionais).where(eq(giseSeccionais.gise_id, giseId)).all()
			: (await db.select().from(unidades).where(eq(unidades.tipo, 'seccional')).all()).map((s) => ({
					seccional_id: s.id
				}));

	if (secsParaClonar.length === 0) return novoId;

	// Insert seccionais sequencialmente (D1 não suporta transações aninhadas com batch)
	const secsInsert: { id: number; seccional_id: number }[] = [];
	for (const sec of secsParaClonar) {
		const [inserted] = await db
			.insert(giseSeccionais)
			.values({
				gise_id: novoId,
				seccional_id: sec.seccional_id,
				unidade_operacional_id: null,
				status: 'pendente' as const
			})
			.returning({ id: giseSeccionais.id, seccional_id: giseSeccionais.seccional_id });
		secsInsert.push(inserted);
	}

	// Build map: old seccional id -> new seccional id
	const secIdMap = new Map<number, number>();
	if (modo === 'clonada') {
		for (let i = 0; i < secsParaClonar.length; i++) {
			const oldId = secsParaClonar[i].id;
			if (oldId !== undefined) {
				secIdMap.set(oldId, secsInsert[i].id);
			}
		}
	}

	// Clonar slots e equipes (modo clonada) ou criar slot padrão (modo completa)
	if (modo === 'clonada') {
		const oldSecIds = secsParaClonar.filter((s) => s.id).map((s) => s.id as number);
		if (oldSecIds.length > 0) {
			// Clona slots de unidade
			const slotsOriginais = await db
				.select()
				.from(giseSeccionalUnidades)
				.where(inArray(giseSeccionalUnidades.gise_seccional_id, oldSecIds));

			const slotIdMap = new Map<number, number>(); // old slot id -> new slot id

			for (const slot of slotsOriginais) {
				const newSecId = secIdMap.get(slot.gise_seccional_id);
				if (newSecId) {
					const [newSlot] = await db
						.insert(giseSeccionalUnidades)
						.values({
							gise_seccional_id: newSecId,
							unidade_id: slot.unidade_id
						})
						.returning({ id: giseSeccionalUnidades.id });
					slotIdMap.set(slot.id, newSlot.id);
				}
			}

			// Clona equipes com gise_unidade_id remapeado
			const equipesOriginais = await db
				.select()
				.from(giseEquipes)
				.where(inArray(giseEquipes.gise_seccional_id, oldSecIds));

			for (const eq_ of equipesOriginais) {
				const newSecId = secIdMap.get(eq_.gise_seccional_id);
				if (newSecId) {
					const newUnidadeId =
						eq_.gise_unidade_id !== null ? (slotIdMap.get(eq_.gise_unidade_id) ?? null) : null;
					await db.insert(giseEquipes).values({
						gise_seccional_id: newSecId,
						gise_unidade_id: newUnidadeId,
						tipo: eq_.tipo,
						slots_dpc: eq_.slots_dpc,
						slots_oip: eq_.slots_oip
					});
				}
			}
		}
	}

	// Criar slot + equipe padrão para seccionais sem slots (modo completa ou fallback)
	const novasSecIds = secsInsert.map((s) => s.id);
	if (novasSecIds.length > 0) {
		const slotsExistentes = await db
			.select({ gise_seccional_id: giseSeccionalUnidades.gise_seccional_id })
			.from(giseSeccionalUnidades)
			.where(inArray(giseSeccionalUnidades.gise_seccional_id, novasSecIds));

		const secIdsSemSlot = novasSecIds.filter(
			(id) => !slotsExistentes.some((s) => s.gise_seccional_id === id)
		);

		// Vagas lidas uma vez só: são as mesmas para todos os slots do laço.
		const v = await buscarVagasPadraoEquipesGise(db);
		for (const secId of secIdsSemSlot) {
			await criarSlotComEquipesPadrao(db, secId, null, v);
		}
	}

	return novoId;
}
