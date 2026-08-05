/**
 * `load` e as 15 actions da tela de UMA ESCALA — o arquivo com mais pontos de
 * decisão do projeto (154). Quase toda a densidade vem de uma coisa só: o tipo
 * da escala muda o que cada operação significa.
 *
 * **Todas as actions começam por `carregarEscalaComPermissao`**, declarando o
 * que vão fazer (`'conteudo'` ou `'ciclo'`). É o preâmbulo único: autentica,
 * valida o id, confere permissão e — para conteúdo — que a escala ainda POSSA
 * mudar. Duas regras moram só ali:
 *
 *   - DPC admin com solicitação de assinatura pode VER e ASSINAR, mas não
 *     MUTAR; por isso a restrição por lotação continua valendo mesmo depois de
 *     a leitura ter passado;
 *   - escala assinada ou finalizada não tem o conteúdo alterado. Voltar a
 *     editar exige revogar a assinatura ou reabrir o FDS — os dois caminhos
 *     explícitos e auditados (FLW-ESC-003).
 *
 * Item de `escala_policiais` é sempre buscado por `id` **e** `escala_id`: sem
 * o par, um `item_id` de outra escala é aceito por quem só tem permissão nesta
 * (FLW-ESC-002).
 *
 * As actions, agrupadas pelo que decidem:
 *
 * - **composição** (`adicionar`, `adicionarPlantao`, `adicionarTodos`,
 *   `editar`, `remover`, `removerTodos`, `removerSelecionados`) — quem está na
 *   escala. `adicionarPlantao` recebe as datas já projetadas pelo cliente
 *   (ciclo 1x3/2x6) e insere uma linha por dia;
 * - **datas e horários** (`editarPlantaoAgrupado`, `editarDiasEscala`,
 *   `repetir`) — mexem nas linhas existentes sem trocar quem serve;
 * - **ciclo de vida do FDS** (`finalizar`, `desfinalizar`, `reenviarEmail`) —
 *   a escala de fim de semana não é assinada, é ENVIADA por e-mail com o
 *   `.docx` anexo. `finalizar` grava o destinatário e dispara o envio;
 *   `reenviarEmail` repete o envio sem refazer o registro;
 * - **projeção** (`gerarProximoMes`) — cria a escala do mês seguinte a partir
 *   desta, avançando a rotação. Recusa com 409 se já existir escala
 *   equivalente, porque "equivalente" varia por tipo (ver
 *   `verificarEscalaExistente`).
 *
 * O que NÃO está aqui: assinar. A assinatura é dos endpoints
 * `/api/escalas/[id]/*`, porque envolve R2, CMS e carimbo de tempo — fluxo que
 * não cabe em form action.
 */
import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { decifrarCpfDoDB } from '$lib/crypto/cpf-cripto';
import { intervaloDeDatas } from '$lib/utils/datas';
import {
	getDB,
	buscarEscala,
	listarPoliciaisEscala,
	listarPoliciaisEscalaQuery,
	buscarDocumentoEscala,
	adicionarMultiplasDatasPlantao,
	adicionarTodosPoliciais,
	criarEscala,
	verificarEscalaExistente,
	registrarAuditComContexto,
	contextoDeEvento,
	finalizarEscalaFDS,
	desfinalizarEscalaFDS,
	buscarSolicitacaoAssinatura
} from '$lib/db';
import * as exportLib from '$lib/server/export';
import { enviarEscalaFDSPorEmail } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import { eq, and, inArray } from 'drizzle-orm';
import { escalaPoliciais, escalas as escalasTable } from '$lib/server/schema';
import {
	verificarConflitoGlobal,
	verificarConflitoGlobalBatch
} from '$lib/server/escalas/conflict';
import {
	calcularProximoMesDias,
	proximoMes,
	primeiroDiaDoMes,
	ultimoDiaDoMes,
	calcularDataSaida,
	agruparDiasPorPolicial,
	MESES_PT
} from '$lib/rotacao';
import { verificarPermissaoEscala, podeMexerNaEscala } from '$lib/server/escalas/permissao';
import { registrarMudancaEscala, nomeDoPolicial } from './_actions/desfecho';
import { erroDeDatasForaDoPeriodo } from '$lib/server/escalas/periodo';

/**
 * O que a action vai fazer com a escala. **Parâmetro obrigatório de
 * propósito**: é ele que decide se o guard de imutabilidade roda, e deixá-lo
 * opcional faria a próxima action nascer sem proteção por omissão.
 *
 * - `'conteudo'` — mexe em QUEM está na escala ou em QUANDO (composição,
 *   datas, horários). É o que o documento assinado atesta, e por isso trava
 *   depois de assinar ou finalizar.
 * - `'ciclo'` — o ciclo de vida em si (finalizar, reabrir, reenviar) e a
 *   projeção do mês seguinte, que cria escala NOVA sem tocar nesta. Não pode
 *   travar pelo próprio estado que ela existe para mudar.
 */
type OperacaoEscala = 'conteudo' | 'ciclo';

/**
 * Preâmbulo único das actions: autentica, valida o id, confere permissão e —
 * para operações de conteúdo — que a escala ainda possa mudar.
 *
 * DPC admin com solicitação de assinatura pode VER e ASSINAR, mas não MUTAR;
 * por isso a restrição por lotação continua valendo aqui, mesmo depois de a
 * leitura ter passado por `verificarPermissaoEscala`.
 *
 * **Imutabilidade após assinatura (FLW-ESC-003).** Havia PDF assinado, com
 * hash e carimbo de tempo, atestando uma composição que qualquer das dez
 * actions de conteúdo podia trocar por baixo — o documento seguia válido
 * criptograficamente e passava a descrever uma escala que não existe mais. A
 * UI escondia os controles; o servidor aceitava o POST. Só uma das catorze
 * actions checava `finalizada_em`, e nenhuma checava assinatura.
 *
 * Voltar a poder editar exige o caminho explícito e auditado que já existe:
 * revogar a assinatura (`DELETE /api/escalas/[id]/documento-assinado`) ou
 * reabrir o FDS (action `desfinalizar`).
 *
 * Devolve `db`/`escala`/`escalaId`/`usuario`, ou um `fail()` pronto.
 */
async function carregarEscalaComPermissao(
	platform: App.Platform | undefined,
	usuario: App.Locals['usuario'],
	escalaIdRaw: string | undefined,
	operacao: OperacaoEscala
) {
	if (!usuario) {
		return { erro: fail(401, { error: 'Não autorizado' }) } as const;
	}
	const escalaId = Number(escalaIdRaw);
	if (isNaN(escalaId)) {
		return { erro: fail(400, { error: 'ID da escala inválido' }) } as const;
	}
	const db = getDB(platform);
	const escala = await buscarEscala(db, escalaId);
	if (!escala) {
		return { erro: fail(404, { error: 'Escala não encontrada' }) } as const;
	}
	if (!podeMexerNaEscala(usuario, escala.lotacao)) {
		return { erro: fail(403, { error: 'Sem permissão para alterar esta escala' }) } as const;
	}

	if (operacao === 'conteudo') {
		if (escala.finalizada_em) {
			return {
				erro: fail(409, {
					error: 'Escala finalizada. Reabra-a antes de alterar a composição.'
				})
			} as const;
		}
		if (await buscarDocumentoEscala(db, escalaId)) {
			return {
				erro: fail(409, {
					error: 'Escala já assinada. Revogue a assinatura antes de alterar a composição.'
				})
			} as const;
		}
	}

	return { db, escala, escalaId, usuario } as const;
}

function podeOIPSolicitar(u: App.Locals['usuario']): boolean {
	if (!u) return false;
	if (u.tipo === 'admin') return true;
	return (u.papel === 'admin_seccional' || u.papel === 'admin_unidade') && u.cargo === 'OIP';
}

/**
 * Tela de uma escala (`/escalas/[id]`) — o núcleo do módulo de escalas.
 *
 * Um mesmo arquivo atende os TRÊS tipos, que têm ciclos de vida diferentes:
 *
 * - **plantão mensal**: cada policial ocupa vários dias do mês, em rotação
 *   (24×72 h etc.). Actions próprias: `adicionarPlantao`, `repetir`,
 *   `editarPlantaoAgrupado`, `gerarProximoMes`;
 * - **expediente mensal**: uma linha por policial no mês, com horário próprio;
 * - **FDS**: escala de fim de semana/feriado, que se ENCERRA por e-mail
 *   (`finalizar` → `reenviarEmail` → `desfinalizar`) em vez de assinatura.
 *
 * Todas as mutações passam por `carregarEscalaComPermissao`, que concentra o
 * guard de edição: Admin Geral em qualquer escala, ou dono da lotação. Só a
 * LEITURA é mais ampla (ver comentários no `load`), e assinar é fluxo à parte.
 *
 * Convenção herdada da planilha original: hora padrão '08' quando o formulário
 * não manda nada, e `calcularDataSaida` resolve o turno que vira o dia.
 */
export const load: PageServerLoad = async ({ locals, platform, params, depends }) => {
	const escalaId = Number(params.id);
	if (!isNaN(escalaId)) depends(`escala:${escalaId}`);

	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	const db = getDB(platform);
	if (isNaN(escalaId)) redirect(302, '/escalas');

	const [escala, policiaisEscala, docInfo] = await Promise.all([
		buscarEscala(db, escalaId),
		listarPoliciaisEscala(db, escalaId),
		buscarDocumentoEscala(db, escalaId).then(async (d) =>
			d
				? {
						existe: true,
						assinante_nome: d.assinante_nome,
						// CPF cifrado em repouso (LGPD) — decifra para exibição.
						assinante_cpf: await decifrarCpfDoDB(d.assinante_cpf, platform?.env),
						data: d.created_at
					}
				: { existe: false }
		)
	]);

	if (!escala) redirect(302, '/escalas');

	// Permissão de LEITURA fora da própria lotação. Um admin_seccional/admin_unidade
	// é um POLICIAL (u.tipo === 'policial') com u.papel definido — por isso a regra
	// depende do PAPEL/escopo, não do tipo. `verificarPermissaoEscala` concentra
	// tudo: Admin Geral irrestrito; mesma lotação; escopo do papel cobre a lotação
	// da escala (a seccional vê as escalas das suas unidades); DPC admin com
	// solicitação direcionada. Vale para qualquer tipo de escala (fds/plantão/
	// expediente). Policial comum continua restrito à própria lotação.
	if (u.tipo !== 'admin' && escala.lotacao !== u.lotacao) {
		const perm = await verificarPermissaoEscala(db, escalaId, escala.lotacao, u);
		if (!perm.permitido) redirect(302, '/escalas');
	}

	// Permissão de EDIÇÃO (mutar servidores/finalizar). É a MESMA função que as
	// actions usam — não uma cópia que espelha o guard, como era antes: a tela
	// recalculava a regra e a aplicava em um dos sete componentes de edição.
	// Um admin_seccional que apenas VÊ a escala de uma unidade sob seu escopo NÃO
	// edita — mas continua podendo ASSINAR (fluxo próprio, cross-unidade).
	const podeEditarEscala = podeMexerNaEscala(u, escala.lotacao);

	const oipPodeSolicitar = podeOIPSolicitar(u);
	const jaAssinada = docInfo.existe;
	const solicitacaoAtual =
		oipPodeSolicitar && (escala.tipo === 'plantao' || escala.tipo === 'expediente') && !jaAssinada
			? await buscarSolicitacaoAssinatura(db, escalaId)
			: null;

	// A lista completa de policiais NÃO é mais carregada no load (era até 10 000
	// linhas em todo acesso). O `<SearchableSelect>` agora consulta
	// `/api/policiais/search` sob demanda com debounce, paginado.

	return {
		escala,
		policiaisEscala,
		documentoAssinadoInfo: docInfo,
		escalaId,
		podeEditarEscala,
		podeOIPSolicitar: oipPodeSolicitar,
		solicitacaoAtual: solicitacaoAtual
			? {
					tipo: solicitacaoAtual.tipo,
					destinatario_id: solicitacaoAtual.destinatario_id ?? undefined
				}
			: null
	};
};

export const actions: Actions = {
	/** Inclui UM policial num dia (plantão avulso ou expediente). */
	adicionar: async (event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		const data = await request.formData();
		const policial_id = Number(data.get('policial_id'));
		const data_plantao = data.get('data_plantao')?.toString() || '';
		const hora_entrada = data.get('hora_entrada')?.toString() || '08';
		const minuto_entrada = data.get('minuto_entrada')?.toString() || '00';
		const hora_saida = data.get('hora_saida')?.toString() || '08';
		const minuto_saida = data.get('minuto_saida')?.toString() || '00';
		const equipe = data.get('equipe')?.toString() || '';
		const observacoes = data.get('observacoes')?.toString() || '';
		const dataSaidaOverride = data.get('data_saida_override')?.toString() || '';

		if (isNaN(policial_id) || !data_plantao) {
			return fail(400, { error: 'Dados inválidos' });
		}

		// A data vem do cliente e o calendário é markup (FLW-ESC-005).
		const foraDoPeriodo = erroDeDatasForaDoPeriodo(escala, [data_plantao]);
		if (foraDoPeriodo) return fail(400, { error: foraDoPeriodo });

		const horaEnt = `${hora_entrada}:${minuto_entrada}`;
		const horaSai = `${hora_saida}:${minuto_saida}`;
		const dataSaida = dataSaidaOverride || calcularDataSaida(data_plantao, horaEnt, horaSai);

		// -1 = sem exclusão: verifica TODAS as escalas, inclusive a atual (impede duplicatas)
		const conflito = await verificarConflitoGlobal(
			db,
			policial_id,
			data_plantao,
			horaEnt,
			horaSai,
			-1
		);
		if (!conflito.ok) return fail(409, { error: conflito.motivo });

		try {
			// D1 batch: insert + listagem em 1 round-trip (antes: 2 round-trips serializados)
			const [, policiais] = await db.batch([
				db.insert(escalaPoliciais).values({
					escala_id: escalaId,
					policial_id,
					data_plantao,
					data_saida: dataSaida,
					hora_entrada: horaEnt,
					hora_saida: horaSai,
					observacoes,
					equipe
				}),
				listarPoliciaisEscalaQuery(db, escalaId)
			]);

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'adicionar_policial_escala',
				alvo: { tipo: 'policial', id: policial_id, nome: await nomeDoPolicial(db, policial_id) },
				detalhes: `Escalado em ${data_plantao}, ${horaEnt} às ${horaSai}`,
				itens: 1,
				dados_depois: {
					data_plantao,
					data_saida: dataSaida,
					hora_entrada: horaEnt,
					hora_saida: horaSai,
					equipe,
					observacoes
				}
			});

			return { success: true, policiais };
		} catch {
			return fail(500, { error: 'Erro ao adicionar policial' });
		}
	},

	/**
	 * Inclui um policial em VÁRIOS dias de uma vez (as datas vêm do calendário
	 * do modal, num campo oculto JSON).
	 */
	adicionarPlantao: async (event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		const data = await request.formData();
		const policial_id = Number(data.get('policial_id'));
		const hora_entrada = data.get('hora_entrada')?.toString() || '08';
		const minuto_entrada = data.get('minuto_entrada')?.toString() || '00';
		const hora_saida = data.get('hora_saida')?.toString() || '08';
		const minuto_saida = data.get('minuto_saida')?.toString() || '00';
		const equipe = data.get('equipe')?.toString() || '';

		// Parse datas selecionadas (JSON string no hidden field)
		const datasJson = data.get('datas')?.toString() || '[]';
		let datas: Array<{ data_plantao: string; data_saida: string }>;
		try {
			datas = JSON.parse(datasJson);
		} catch {
			return fail(400, { error: 'Datas inválidas' });
		}

		if (isNaN(policial_id) || datas.length === 0) {
			return fail(400, { error: 'Selecione pelo menos uma data' });
		}

		const foraDoPeriodo = erroDeDatasForaDoPeriodo(
			escala,
			datas.map((d) => d.data_plantao)
		);
		if (foraDoPeriodo) return fail(400, { error: foraDoPeriodo });

		const he = `${hora_entrada}:${minuto_entrada}`;
		const hs = `${hora_saida}:${minuto_saida}`;

		// Verifica conflitos em batch (-1 = sem exclusão, verifica inclusive a escala atual)
		const datasStr = datas.map((d) => d.data_plantao);
		const conflitosMap = await verificarConflitoGlobalBatch(db, policial_id, datasStr, he, hs, -1);

		const datasLimpas = datas.filter((d) => !conflitosMap.has(d.data_plantao));
		const conflitantes = Array.from(conflitosMap.entries()).map(([data, motivo]) => ({
			data,
			motivo
		}));

		if (datasLimpas.length === 0) {
			const primeiro = conflitantes[0];
			return fail(409, {
				error: `Choque de horário em todas as datas. Ex: ${primeiro.data} — ${primeiro.motivo}`
			});
		}

		try {
			await adicionarMultiplasDatasPlantao(db, escalaId, policial_id, datasLimpas, he, hs, equipe);
			const policiais = await listarPoliciaisEscala(db, escalaId);

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'adicionar_policial_escala',
				alvo: { tipo: 'policial', id: policial_id, nome: await nomeDoPolicial(db, policial_id) },
				detalhes: `Escalado em ${datasLimpas.length} dia(s) de plantão, ${he} às ${hs}`,
				itens: datasLimpas.length,
				// As datas RECUSADAS entram no evento: a tela avisa o operador e o
				// aviso some no reload; a trilha é onde ele volta a existir.
				metadados: { equipe, recusadas_por_conflito: conflitantes },
				dados_depois: { datas: datasLimpas.map((d) => d.data_plantao) }
			});

			return { success: true, policiais, conflitantes };
		} catch {
			return fail(500, { error: 'Erro ao adicionar policial à escala de plantão' });
		}
	},

	/**
	 * Preenche a escala com todos os policiais da lotação, no horário padrão da
	 * própria escala. Atalho do início do mês, antes dos ajustes individuais.
	 */
	adicionarTodos: async (event) => {
		const { locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		if (escala.tipo !== 'plantao' && escala.tipo !== 'expediente') {
			return fail(400, { error: 'Operação inválida para este tipo de escala' });
		}

		const he = escala.hora_entrada || '08:00';
		const hs = escala.hora_saida || '08:00';
		const ds =
			escala.tipo === 'expediente'
				? escala.data_fim
				: calcularDataSaida(escala.data_inicio, he, hs);

		try {
			const quantidade = await adicionarTodosPoliciais(
				db,
				escalaId,
				escala.lotacao,
				escala.tipo,
				escala.data_inicio,
				ds,
				he,
				hs
			);
			const policiais = await listarPoliciaisEscala(db, escalaId);

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'adicionar_policial_escala',
				alvo: { tipo: 'escala', id: escalaId, nome: escala.titulo },
				detalhes: `${quantidade} servidor(es) da lotação ${escala.lotacao} incluídos de uma vez`,
				itens: quantidade,
				metadados: { lotacao: escala.lotacao, hora_entrada: he, hora_saida: hs }
			});

			return { success: true, quantidade, policiais };
		} catch (err) {
			logger.error('[escalas/adicionarTodos] Erro ao adicionar servidores', {
				escalaId,
				lotacao: escala.lotacao,
				tipo: escala.tipo,
				error: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack : undefined
			});
			return fail(500, { error: 'Erro ao adicionar servidores' });
		}
	},

	/**
	 * Clona a escala para o mês seguinte — a operação mais carregada de regra do
	 * módulo:
	 *
	 * - **expediente**: uma linha por policial (deduplicado) no primeiro dia do
	 *   mês novo, preservando o horário individual de cada um;
	 * - **plantão**: `calcularProximoMesDias` identifica a ROTAÇÃO de cada
	 *   policial a partir dos dias que ele cumpriu e projeta o mesmo ciclo no mês
	 *   seguinte. Quem não tem rotação reconhecível não é escalado no palpite: vai
	 *   para `nao_processados` e a tela mostra a lista, para lançamento manual —
	 *   errar a projeção é pior do que não projetar.
	 *
	 * Recusa com 409 (e o id da escala existente, para a tela oferecer o atalho)
	 * quando já há escala do mesmo tipo/lotação naquele mês.
	 */
	gerarProximoMes: async (event) => {
		const { locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'ciclo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala: escalaAtual, escalaId, usuario: u } = ctx;

		if (escalaAtual.tipo !== 'plantao' && escalaAtual.tipo !== 'expediente') {
			return fail(400, { error: 'Operação inválida para este tipo de escala' });
		}

		const [anoAtual, mesAtual] = escalaAtual.data_inicio.split('-').map(Number);
		const { ano: novoAno, mes: novoMes } = proximoMes(anoAtual, mesAtual);
		const novaDataInicio = primeiroDiaDoMes(novoAno, novoMes);
		const novaDataFim = ultimoDiaDoMes(novoAno, novoMes);

		const existente = await verificarEscalaExistente(
			db,
			escalaAtual.lotacao,
			escalaAtual.tipo,
			novaDataInicio
		);
		if (existente) {
			return fail(409, {
				error: `Já existe uma Escala de ${escalaAtual.tipo === 'plantao' ? 'Plantão' : 'Expediente'} para ${escalaAtual.lotacao} em ${MESES_PT[novoMes - 1]} ${novoAno}.`,
				escala_id: existente.id
			});
		}

		const tipoLabel = escalaAtual.tipo === 'plantao' ? 'PLANTÃO' : 'EXPEDIENTE';
		const novoTitulo = `ESCALA DE ${tipoLabel} DA ${escalaAtual.lotacao.toUpperCase()} – ${MESES_PT[novoMes - 1].toUpperCase()} ${novoAno}`;

		try {
			const result = await criarEscala(db, {
				titulo: novoTitulo,
				cidade: escalaAtual.cidade,
				data_inicio: novaDataInicio,
				data_fim: novaDataFim,
				horario: escalaAtual.horario,
				hora_entrada: escalaAtual.hora_entrada,
				hora_saida: escalaAtual.hora_saida,
				lotacao: escalaAtual.lotacao,
				tipo: escalaAtual.tipo
			});

			const novaEscalaId = result[0]?.id;
			if (!novaEscalaId) return fail(500, { error: 'Erro ao criar nova escala' });

			// Copiar policiais
			const policiaisAtuais = await listarPoliciaisEscala(db, escalaId);
			let adicionados = 0;
			const naoProcessados: Array<{ nome: string; motivo: string }> = [];
			const linhasParaInserir: (typeof escalaPoliciais.$inferInsert)[] = [];

			if (escalaAtual.tipo === 'expediente') {
				const policialIdsVistos = new Set<number>();
				const he = escalaAtual.hora_entrada || '00:00';
				const hs = escalaAtual.hora_saida || '23:59';

				for (const p of policiaisAtuais) {
					if (policialIdsVistos.has(p.policial_id)) continue;
					policialIdsVistos.add(p.policial_id);

					const dsEntrada = p.hora_entrada || he;
					const dsSaida = p.hora_saida || hs;
					const dataSaida = calcularDataSaida(novaDataInicio, dsEntrada, dsSaida);

					linhasParaInserir.push({
						escala_id: novaEscalaId,
						policial_id: p.policial_id,
						data_plantao: novaDataInicio,
						data_saida: dataSaida,
						hora_entrada: dsEntrada,
						hora_saida: dsSaida
					});
					adicionados++;
				}
			} else {
				const diasPorPolicial = agruparDiasPorPolicial(policiaisAtuais);

				const he = escalaAtual.hora_entrada || '00:00';
				const hs = escalaAtual.hora_saida || '23:59';
				for (const [policialId, { nome, dias, equipe }] of diasPorPolicial) {
					const { dias: novosDias, rotacao } = calcularProximoMesDias(dias, novoAno, novoMes);
					if (novosDias.length === 0) {
						naoProcessados.push({
							nome,
							motivo: rotacao === null ? 'Rotação não identificada' : 'Nenhum dia calculado'
						});
						continue;
					}
					for (const dia of novosDias) {
						const dataSaida = calcularDataSaida(dia, he, hs);
						linhasParaInserir.push({
							escala_id: novaEscalaId,
							policial_id: policialId,
							data_plantao: dia,
							data_saida: dataSaida,
							hora_entrada: he,
							hora_saida: hs,
							equipe
						});
					}
					adicionados++;
				}
			}

			// Batch único em vez de N INSERTs sequenciais
			if (linhasParaInserir.length > 0) {
				await db.insert(escalaPoliciais).values(linhasParaInserir);
			}

			const { contexto, env } = contextoDeEvento(event);
			await registrarAuditComContexto(db, {
				usuario: u,
				acao: 'criar_escala',
				entidade: 'escala',
				entidade_id: novaEscalaId,
				alvo_tipo: 'escala',
				alvo_id: novaEscalaId,
				detalhes: `Escala do próximo mês gerada a partir da escala ${escalaId}`,
				...contexto,
				env
			});

			return {
				success: true,
				escala_id: novaEscalaId,
				adicionados,
				nao_processados: naoProcessados
			};
		} catch {
			return fail(500, { error: 'Erro ao gerar escala do próximo mês' });
		}
	},

	/** Edita uma linha (dia/horário/equipe/observações) de um policial. */
	editar: async (event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		const data = await request.formData();
		const item_id = Number(data.get('item_id'));
		const data_plantao = data.get('data_plantao')?.toString() || '';
		const data_saida = data.get('data_saida')?.toString() || '';
		const hora_entrada = data.get('hora_entrada')?.toString() || '';
		const hora_saida = data.get('hora_saida')?.toString() || '';
		const observacoes = data.get('observacoes')?.toString() || '';

		if (isNaN(item_id)) return fail(400, { error: 'ID inválido' });

		if (data_plantao) {
			const foraDoPeriodo = erroDeDatasForaDoPeriodo(escala, [data_plantao]);
			if (foraDoPeriodo) return fail(400, { error: foraDoPeriodo });
		}

		// Busca policial_id do registro para validar conflito
		const registro = await db
			.select({
				policial_id: escalaPoliciais.policial_id,
				data_plantao: escalaPoliciais.data_plantao,
				data_saida: escalaPoliciais.data_saida,
				hora_entrada: escalaPoliciais.hora_entrada,
				hora_saida: escalaPoliciais.hora_saida,
				observacoes: escalaPoliciais.observacoes
			})
			.from(escalaPoliciais)
			// `escala_id` junto do `id`: sem isso, um `item_id` de OUTRA escala é
			// aceito por quem só tem permissão nesta (FLW-ESC-002).
			.where(and(eq(escalaPoliciais.escala_id, escalaId), eq(escalaPoliciais.id, item_id)))
			.get();

		// Recusa explícita em vez de UPDATE que não acha linha e devolve sucesso:
		// item de outra escala tem de ser indistinguível de item inexistente.
		if (!registro) return fail(404, { error: 'Item não encontrado nesta escala' });

		if (hora_entrada && hora_saida && data_plantao) {
			const conflito = await verificarConflitoGlobal(
				db,
				registro.policial_id,
				data_plantao,
				hora_entrada,
				hora_saida,
				escalaId
			);
			if (!conflito.ok) return fail(409, { error: conflito.motivo });
		}

		try {
			// D1 batch: update + listagem em 1 round-trip
			const [, policiais] = await db.batch([
				db
					.update(escalaPoliciais)
					.set({
						data_plantao,
						data_saida,
						hora_entrada,
						hora_saida,
						observacoes
					})
					.where(and(eq(escalaPoliciais.escala_id, escalaId), eq(escalaPoliciais.id, item_id))),
				listarPoliciaisEscalaQuery(db, escalaId)
			]);

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'editar_escala',
				alvo: {
					tipo: 'policial',
					id: registro.policial_id,
					nome: await nomeDoPolicial(db, registro.policial_id)
				},
				detalhes: `Plantão de ${registro.data_plantao} alterado para ${data_plantao}, ${hora_entrada} às ${hora_saida}`,
				itens: 1,
				metadados: { item_id },
				dados_antes: {
					data_plantao: registro.data_plantao,
					data_saida: registro.data_saida,
					hora_entrada: registro.hora_entrada,
					hora_saida: registro.hora_saida,
					observacoes: registro.observacoes
				},
				dados_depois: { data_plantao, data_saida, hora_entrada, hora_saida, observacoes }
			});

			return { success: true, policiais };
		} catch {
			return fail(500, { error: 'Erro ao salvar alterações' });
		}
	},

	/** Remove uma linha e devolve a listagem já atualizada, em um round-trip. */
	remover: async (event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escalaId, usuario: u } = ctx;

		const data = await request.formData();
		const item_id = Number(data.get('item_id'));

		if (isNaN(item_id)) return fail(400, { error: 'ID inválido' });

		// Estado ANTERIOR completo: depois do delete não há de onde tirar quem foi
		// desescalado nem de que dia.
		const alvo = await db
			.select({
				id: escalaPoliciais.id,
				policial_id: escalaPoliciais.policial_id,
				data_plantao: escalaPoliciais.data_plantao,
				hora_entrada: escalaPoliciais.hora_entrada,
				hora_saida: escalaPoliciais.hora_saida
			})
			.from(escalaPoliciais)
			.where(and(eq(escalaPoliciais.escala_id, escalaId), eq(escalaPoliciais.id, item_id)))
			.get();
		if (!alvo) return fail(404, { error: 'Item não encontrado nesta escala' });

		const nomeAlvo = await nomeDoPolicial(db, alvo.policial_id);

		try {
			// D1 batch: delete + listagem em 1 round-trip
			const [, policiais] = await db.batch([
				db
					.delete(escalaPoliciais)
					.where(and(eq(escalaPoliciais.escala_id, escalaId), eq(escalaPoliciais.id, item_id))),
				listarPoliciaisEscalaQuery(db, escalaId)
			]);

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'remover_policial_escala',
				alvo: { tipo: 'policial', id: alvo.policial_id, nome: nomeAlvo },
				detalhes: `Retirado do plantão de ${alvo.data_plantao}`,
				itens: 1,
				metadados: { item_id },
				dados_antes: {
					data_plantao: alvo.data_plantao,
					hora_entrada: alvo.hora_entrada,
					hora_saida: alvo.hora_saida
				}
			});

			return { success: true, policiais };
		} catch {
			return fail(500, { error: 'Erro ao remover policial' });
		}
	},

	/**
	 * Repete um policial já escalado em novas datas, herdando horário e equipe da
	 * linha de origem — evita redigitar o que já está na escala.
	 */
	repetir: async (event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		const data = await request.formData();
		const policial_id = Number(data.get('policial_id'));
		const hora_entrada = data.get('hora_entrada')?.toString() || '08:00';
		const hora_saida = data.get('hora_saida')?.toString() || '08:00';
		const equipe = data.get('equipe')?.toString() || '';
		const datasJson = data.get('datas')?.toString() || '[]';

		let datasStr: string[];
		try {
			datasStr = JSON.parse(datasJson);
		} catch {
			return fail(400, { error: 'Datas inválidas' });
		}

		if (isNaN(policial_id) || datasStr.length === 0) {
			return fail(400, { error: 'Selecione pelo menos uma data' });
		}

		const foraDoPeriodo = erroDeDatasForaDoPeriodo(escala, datasStr);
		if (foraDoPeriodo) return fail(400, { error: foraDoPeriodo });

		const todos = await db
			.select({
				policial_id: escalaPoliciais.policial_id,
				data_plantao: escalaPoliciais.data_plantao
			})
			.from(escalaPoliciais)
			.where(eq(escalaPoliciais.escala_id, escalaId));

		const ocupados = new Set(todos.map((r) => `${r.policial_id}|${r.data_plantao}`));

		const datasDisponiveis = datasStr.filter((d) => !ocupados.has(`${policial_id}|${d}`));

		if (datasDisponiveis.length === 0) {
			return fail(400, { error: 'Este servidor já está em todos os dias selecionados' });
		}

		// Verifica conflitos em batch (-1 = sem exclusão; datasDisponiveis já excluiu duplicatas na escala atual)
		const conflitosMap = await verificarConflitoGlobalBatch(
			db,
			policial_id,
			datasDisponiveis,
			hora_entrada,
			hora_saida,
			-1
		);

		const novas = datasDisponiveis
			.filter((d) => !conflitosMap.has(d))
			.map((d) => ({
				data_plantao: d,
				data_saida: calcularDataSaida(d, hora_entrada, hora_saida)
			}));
		const conflitantes = Array.from(conflitosMap.entries()).map(([data, motivo]) => ({
			data,
			motivo
		}));

		if (novas.length === 0) {
			const primeiro = conflitantes[0];
			return fail(409, {
				error: `Choque de horário em todas as datas. Ex: ${primeiro.data} — ${primeiro.motivo}`
			});
		}

		try {
			await adicionarMultiplasDatasPlantao(
				db,
				escalaId,
				policial_id,
				novas,
				hora_entrada,
				hora_saida,
				equipe
			);
			const policiais = await listarPoliciaisEscala(db, escalaId);

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'adicionar_policial_escala',
				alvo: { tipo: 'policial', id: policial_id, nome: await nomeDoPolicial(db, policial_id) },
				detalhes: `Repetido em ${novas.length} dia(s), ${hora_entrada} às ${hora_saida}`,
				itens: novas.length,
				metadados: { equipe, recusadas_por_conflito: conflitantes },
				dados_depois: { datas: novas.map((d) => d.data_plantao) }
			});

			return { success: true, policiais, conflitantes };
		} catch {
			return fail(500, { error: 'Erro ao repetir servidor na escala' });
		}
	},

	/**
	 * Edita de uma vez TODAS as linhas de um policial no plantão mensal: a tela
	 * mostra uma linha por pessoa (com os dias agrupados), então salvar precisa
	 * reconciliar o conjunto — os dias que saíram são apagados e os que entraram,
	 * inseridos.
	 */
	editarPlantaoAgrupado: async (event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		const data = await request.formData();
		const idsJson = data.get('ids')?.toString() || '[]';
		const datasJson = data.get('datas')?.toString() || '[]';
		const hora_entrada = data.get('hora_entrada')?.toString() || '08:00';
		const hora_saida = data.get('hora_saida')?.toString() || '08:00';
		const observacoes = data.get('observacoes')?.toString() || '';

		let ids: number[];
		let datasStr: string[];
		try {
			ids = JSON.parse(idsJson);
			datasStr = JSON.parse(datasJson);
		} catch {
			return fail(400, { error: 'Dados inválidos' });
		}

		if (ids.length === 0) return fail(400, { error: 'IDs de origem não fornecidos' });
		if (datasStr.length === 0) return fail(400, { error: 'Selecione pelo menos uma data' });

		const foraDoPeriodo = erroDeDatasForaDoPeriodo(escala, datasStr);
		if (foraDoPeriodo) return fail(400, { error: foraDoPeriodo });

		const origin = await db
			.select({ policial_id: escalaPoliciais.policial_id, equipe: escalaPoliciais.equipe })
			.from(escalaPoliciais)
			.where(and(eq(escalaPoliciais.escala_id, escalaId), eq(escalaPoliciais.id, ids[0])))
			.get();
		if (!origin) return fail(404, { error: 'Registro não encontrado' });

		const policial_id = origin.policial_id;
		const equipe = origin.equipe || '';

		const oldRows = await db
			.select()
			.from(escalaPoliciais)
			.where(and(eq(escalaPoliciais.escala_id, escalaId), inArray(escalaPoliciais.id, ids)))
			.all();
		await db
			.delete(escalaPoliciais)
			.where(and(eq(escalaPoliciais.escala_id, escalaId), inArray(escalaPoliciais.id, ids)));

		const conflitosMap = await verificarConflitoGlobalBatch(
			db,
			policial_id,
			datasStr,
			hora_entrada,
			hora_saida,
			-1
		);
		const datasLimpas = datasStr.filter((d) => !conflitosMap.has(d));
		const conflitantes = Array.from(conflitosMap.entries()).map(([data, motivo]) => ({
			data,
			motivo
		}));

		if (datasLimpas.length === 0) {
			await db.insert(escalaPoliciais).values(oldRows);
			const primeiro = conflitantes[0];
			return fail(409, {
				error: `Choque de horário em todas as datas. Ex: ${primeiro.data} — ${primeiro.motivo}`
			});
		}

		try {
			const linhasParaInserir = datasLimpas.map((d) => ({
				escala_id: escalaId,
				policial_id,
				data_plantao: d,
				data_saida: calcularDataSaida(d, hora_entrada, hora_saida),
				hora_entrada,
				hora_saida,
				equipe,
				observacoes
			}));
			await db.insert(escalaPoliciais).values(linhasParaInserir);
			const policiais = await listarPoliciaisEscala(db, escalaId);

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'editar_escala',
				alvo: { tipo: 'policial', id: policial_id, nome: await nomeDoPolicial(db, policial_id) },
				detalhes: `Plantão do mês reconciliado: ${oldRows.length} dia(s) → ${datasLimpas.length} dia(s)`,
				itens: datasLimpas.length,
				metadados: { equipe, recusadas_por_conflito: conflitantes },
				// A action APAGA as linhas antigas e insere as novas; sem o antes, a
				// trilha registra a inserção e some com o que estava lá.
				dados_antes: { datas: oldRows.map((r) => r.data_plantao) },
				dados_depois: { datas: datasLimpas, hora_entrada, hora_saida, observacoes }
			});

			return { success: true, policiais, conflitantes };
		} catch {
			await db.insert(escalaPoliciais).values(oldRows);
			return fail(500, { error: 'Erro ao salvar alterações' });
		}
	},

	/**
	 * Troca as datas de uma escala de FDS (ex.: feriado prolongado que muda de
	 * dia). Só antes de finalizar: depois do envio por e-mail, o documento já
	 * circulou.
	 */
	editarDiasEscala: async (event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		if (escala.tipo !== 'fds')
			return fail(400, { error: 'Operação válida apenas para escalas de FDS' });
		if (escala.finalizada_em) return fail(400, { error: 'Escala já finalizada' });

		const formData = await request.formData();
		const datasJson = formData.get('datas')?.toString() || '[]';
		let novasDatas: string[];
		try {
			novasDatas = JSON.parse(datasJson);
		} catch {
			return fail(400, { error: 'Dados inválidos' });
		}

		if (!Array.isArray(novasDatas) || novasDatas.length === 0) {
			return fail(400, { error: 'Selecione pelo menos um dia' });
		}

		const sorted = [...novasDatas].sort();
		const novaDataInicio = sorted[0];
		const novaDataFim = sorted[sorted.length - 1];

		// Dias atualmente no range da escala
		const getDaysInRange = intervaloDeDatas;

		const velhoRange = getDaysInRange(escala.data_inicio, escala.data_fim);
		const novoRangeSet = new Set(getDaysInRange(novaDataInicio, novaDataFim));
		const diasRemovidos = velhoRange.filter((d) => !novoRangeSet.has(d));

		if (diasRemovidos.length > 0) {
			// Verifica se algum dia removido tem policiais escalados
			const comPoliciais = await db
				.select({ data_plantao: escalaPoliciais.data_plantao })
				.from(escalaPoliciais)
				.where(
					and(
						eq(escalaPoliciais.escala_id, escalaId),
						inArray(escalaPoliciais.data_plantao, diasRemovidos)
					)
				)
				.all();

			if (comPoliciais.length > 0) {
				const diasStr = [
					...new Set(
						comPoliciais.map((p) => {
							const [, m, d] = p.data_plantao.split('-');
							return `${d}/${m}`;
						})
					)
				].join(', ');
				return fail(409, {
					error: `Não é possível remover o(s) dia(s) ${diasStr} — há policiais escalados. Remova-os primeiro e tente novamente.`
				});
			}
		}

		const dS = novaDataInicio.split('-')[2];
		const mS = novaDataInicio.split('-')[1];
		const dF = novaDataFim.split('-')[2];
		const mF = novaDataFim.split('-')[1];
		const novoTitulo = `ESCALA DE PLANTÃO DO FINAL DE SEMANA - ${escala.lotacao} - ${dS}/${mS} a ${dF}/${mF}`;

		await db
			.update(escalasTable)
			.set({ data_inicio: novaDataInicio, data_fim: novaDataFim, titulo: novoTitulo })
			.where(eq(escalasTable.id, escalaId));

		const policiais = await listarPoliciaisEscala(db, escalaId);

		await registrarMudancaEscala(event, {
			db,
			escalaId,
			usuario: u,
			acao: 'editar_escala',
			alvo: { tipo: 'escala', id: escalaId, nome: novoTitulo },
			detalhes: `Dias do FDS: ${escala.data_inicio}–${escala.data_fim} → ${novaDataInicio}–${novaDataFim}`,
			itens: policiais.length,
			dados_antes: {
				data_inicio: escala.data_inicio,
				data_fim: escala.data_fim,
				titulo: escala.titulo
			},
			dados_depois: {
				data_inicio: novaDataInicio,
				data_fim: novaDataFim,
				titulo: novoTitulo
			}
		});

		return {
			success: true,
			data_inicio: novaDataInicio,
			data_fim: novaDataFim,
			titulo: novoTitulo,
			policiais
		};
	},

	/**
	 * Encerra a escala de FDS ENVIANDO o PDF por e-mail ao destino informado.
	 *
	 * No FDS não há assinatura digital (a escala não exige): o marco de conclusão
	 * é a entrega, e é o envio que grava `finalizada_em`.
	 */
	finalizar: async (event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'ciclo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		if (escala.tipo !== 'fds')
			return fail(400, { error: 'Operação válida apenas para escalas de FDS' });

		const formData = await request.formData();
		const emailDestino = (formData.get('email_destino') as string | null)?.trim() ?? '';
		if (!emailDestino || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailDestino)) {
			return fail(400, { error: 'E-mail de destino inválido' });
		}

		// Finalizar duas vezes gravaria um novo `finalizada_em` por cima do
		// primeiro — a data de conclusão do documento passaria a ser a da segunda
		// tentativa. Para reenviar existe a action própria.
		if (escala.finalizada_em) {
			return fail(409, {
				error: 'Escala já finalizada. Use "Reenviar e-mail" para mandar de novo.'
			});
		}

		try {
			const policiais = await listarPoliciaisEscala(db, escalaId);
			const nomeArquivo = `${escala.titulo.replace(/[/\\?%*:|"<>]/g, '-')}.docx`;

			// A ENTREGA VEM PRIMEIRO, e a ordem é a correção (FLW-ESC-006).
			//
			// No FDS não há assinatura digital: o marco de conclusão É a entrega por
			// e-mail. Gravar `finalizada_em` antes de enviar invertia isso — a
			// falha virava um `logger.warn`, a resposta dizia sucesso e a trilha
			// registrava "finalizada e enviada para X" para um e-mail que não saiu.
			// A escala ficava fechada para edição, com destinatário nenhum
			// informado, e ninguém sabia.
			//
			// Falhando o envio, nada é gravado: a escala continua editável e o
			// operador tenta de novo. O risco invertido — timeout que na verdade
			// entregou, e o reenvio manda duas vezes — é aceitável: e-mail
			// duplicado se resolve lendo; escala fechada sem entrega, não.
			try {
				await Promise.race([
					(async () => {
						const docxBuffer = await exportLib.gerarDocx(escala, policiais);
						await enviarEscalaFDSPorEmail(
							emailDestino,
							escala.titulo,
							u.nome,
							docxBuffer,
							nomeArquivo,
							platform
						);
					})(),
					new Promise<void>((_, reject) =>
						setTimeout(() => reject(new Error('Timeout (25s)')), 25_000)
					)
				]);
			} catch (emailErr) {
				const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);
				logger.error('[escalas/finalizar] Envio falhou — escala NÃO foi finalizada', {
					escalaId,
					emailDestino,
					error: msg
				});

				const { contexto, env } = contextoDeEvento(event);
				await registrarAuditComContexto(db, {
					usuario: u,
					acao: 'finalizar_escala_fds',
					entidade: 'escala',
					entidade_id: escalaId,
					alvo_tipo: 'escala',
					alvo_id: escalaId,
					// `resultado: 'falha'` é o que separa a tentativa do ato na trilha.
					resultado: 'falha',
					detalhes: `Falha ao entregar a escala de FDS em ${emailDestino}: ${msg}`,
					metadados: { emailDestino, emailEnviado: false },
					...contexto,
					env
				});

				return fail(502, {
					error:
						'Não foi possível enviar a escala por e-mail. Ela continua aberta — ' +
						'confira o endereço e tente novamente.'
				});
			}

			await finalizarEscalaFDS(db, escalaId, emailDestino);

			const { contexto, env } = contextoDeEvento(event);
			await registrarAuditComContexto(db, {
				usuario: u,
				acao: 'finalizar_escala_fds',
				entidade: 'escala',
				entidade_id: escalaId,
				alvo_tipo: 'escala',
				alvo_id: escalaId,
				detalhes: `Escala de FDS finalizada e enviada para ${emailDestino}: ${escala.titulo}`,
				metadados: { emailDestino, emailEnviado: true },
				...contexto,
				env
			});
			return { success: true, emailDestino, emailEnviado: true };
		} catch {
			return fail(500, { error: 'Erro ao finalizar escala' });
		}
	},

	/** Reenvia o PDF da escala de FDS já finalizada (endereço errado, caixa cheia). */
	reenviarEmail: async (event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'ciclo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		if (escala.tipo !== 'fds')
			return fail(400, { error: 'Operação válida apenas para escalas de FDS' });

		const formData = await request.formData();
		const emailDestino = (formData.get('email_destino') as string | null)?.trim() ?? '';
		if (!emailDestino || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailDestino)) {
			return fail(400, { error: 'E-mail de destino inválido' });
		}

		try {
			const policiais = await listarPoliciaisEscala(db, escalaId);
			const nomeArquivo = `${escala.titulo.replace(/[/\\?%*:|"<>]/g, '-')}.docx`;

			// Atualiza o e-mail armazenado caso tenha mudado
			if (emailDestino !== escala.email_envio) {
				await db
					.update(escalasTable)
					.set({ email_envio: emailDestino })
					.where(eq(escalasTable.id, escalaId));
			}

			await Promise.race([
				(async () => {
					const docxBuffer = await exportLib.gerarDocx(escala, policiais);
					await enviarEscalaFDSPorEmail(
						emailDestino,
						escala.titulo,
						u.nome,
						docxBuffer,
						nomeArquivo,
						platform
					);
				})(),
				new Promise<void>((_, reject) =>
					setTimeout(() => reject(new Error('Timeout (25s)')), 25_000)
				)
			]);

			// Entrega de documento a um endereço externo: é o mesmo ato que
			// `finalizar` audita, repetido — e o motivo de repeti-lo (endereço
			// errado, caixa cheia) é exatamente o que se quer poder reconstituir.
			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'reenviar_escala_fds',
				alvo: { tipo: 'escala', id: escalaId, nome: escala.titulo },
				detalhes: `Escala de FDS reenviada para ${emailDestino}`,
				itens: policiais.length,
				metadados: { emailDestino, email_anterior: escala.email_envio }
			});

			return { success: true, emailDestino };
		} catch (err) {
			const msg =
				err instanceof Error && err.message.startsWith('Timeout')
					? 'O envio demorou demais. Tente novamente.'
					: 'Erro ao reenviar e-mail';
			return fail(500, { error: msg });
		}
	},

	/** Reabre a escala de FDS para correção, limpando `finalizada_em`. */
	desfinalizar: async (event) => {
		const { locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'ciclo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		if (escala.tipo !== 'fds')
			return fail(400, { error: 'Operação válida apenas para escalas de FDS' });

		try {
			await desfinalizarEscalaFDS(db, escalaId);

			// Reabrir desfaz um documento que JÁ CIRCULOU fora do sistema: o PDF
			// está na caixa de entrada de alguém e vai divergir da escala a partir
			// da próxima edição. É `critico` no catálogo por isso.
			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'reabrir_escala_fds',
				alvo: { tipo: 'escala', id: escalaId, nome: escala.titulo },
				detalhes: `Escala de FDS reaberta para correção (havia sido enviada para ${escala.email_envio ?? 'destino não registrado'})`,
				itens: 0,
				dados_antes: { finalizada_em: escala.finalizada_em, email_envio: escala.email_envio },
				dados_depois: { finalizada_em: null }
			});

			return { success: true };
		} catch {
			return fail(500, { error: 'Erro ao reabrir escala' });
		}
	},

	/** Esvazia a escala (recomeçar o mês do zero). */
	removerTodos: async (event) => {
		const { locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		try {
			// Contado ANTES: depois do delete não há como saber quantos saíram, e
			// "esvaziou a escala" sem o número não distingue uma linha de trinta.
			const antes = await listarPoliciaisEscala(db, escalaId);
			await db.delete(escalaPoliciais).where(eq(escalaPoliciais.escala_id, escalaId));

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'remover_policial_escala',
				alvo: { tipo: 'escala', id: escalaId, nome: escala.titulo },
				detalhes: `Escala esvaziada: ${antes.length} servidor(es) retirados de uma vez`,
				itens: antes.length,
				dados_antes: { policiais: antes.map((p) => p.policial_id) }
			});

			return { success: true, policiais: [] };
		} catch {
			return fail(500, { error: 'Erro ao remover todos os servidores' });
		}
	},

	/** Remove em lote as linhas marcadas na tabela. */
	removerSelecionados: async (event) => {
		const { request, locals, platform, params } = event;
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id, 'conteudo');
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId, usuario: u } = ctx;

		const data = await request.formData();
		const idsJson = data.get('ids')?.toString() || '[]';
		let ids: number[];
		try {
			ids = JSON.parse(idsJson);
			if (!Array.isArray(ids) || ids.length === 0) throw new Error('empty');
		} catch {
			return fail(400, { error: 'IDs inválidos' });
		}

		// Lidos ANTES do delete: `ids` é o que o cliente PEDIU para remover, e o
		// que a trilha precisa dizer é o que realmente saiu — um id de outra escala
		// no corpo do formulário não conta, e o `WHERE` já o descarta.
		const alvos = await db
			.select({
				policial_id: escalaPoliciais.policial_id,
				data_plantao: escalaPoliciais.data_plantao
			})
			.from(escalaPoliciais)
			.where(and(eq(escalaPoliciais.escala_id, escalaId), inArray(escalaPoliciais.id, ids)))
			.all();

		try {
			const [, policiais] = await db.batch([
				db
					.delete(escalaPoliciais)
					.where(and(eq(escalaPoliciais.escala_id, escalaId), inArray(escalaPoliciais.id, ids))),
				listarPoliciaisEscalaQuery(db, escalaId)
			]);

			await registrarMudancaEscala(event, {
				db,
				escalaId,
				usuario: u,
				acao: 'remover_policial_escala',
				alvo: { tipo: 'escala', id: escalaId, nome: escala.titulo },
				detalhes: `${alvos.length} linha(s) removidas em lote`,
				itens: alvos.length,
				metadados: { ids_pedidos: ids.length },
				dados_antes: {
					removidos: alvos.map((a) => ({
						policial_id: a.policial_id,
						data_plantao: a.data_plantao
					}))
				}
			});

			return { success: true, policiais, removidos: ids.length };
		} catch {
			return fail(500, { error: 'Erro ao remover servidores selecionados' });
		}
	}
};
