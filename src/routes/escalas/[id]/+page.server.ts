/**
 * `load` e as 15 actions da tela de UMA ESCALA — o arquivo com mais pontos de
 * decisão do projeto (154). Quase toda a densidade vem de uma coisa só: o tipo
 * da escala muda o que cada operação significa.
 *
 * **Todas as actions começam por `carregarEscalaComPermissao`.** É o preâmbulo
 * único: autentica, valida o id e devolve `{db, escala, escalaId, usuario}` ou
 * um `fail()` pronto. A regra que ele carrega e que não está em lugar nenhum
 * além dele: DPC admin com solicitação de assinatura pode VER e ASSINAR, mas
 * não MUTAR — por isso a restrição por lotação continua valendo aqui, mesmo
 * que a leitura já tenha passado.
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
import { intervaloDeDatas } from '$lib/utils';
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
import * as exportLib from '$lib/server/export/export';
import { enviarEscalaFDSPorEmail } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import { eq, and, inArray } from 'drizzle-orm';
import { escalaPoliciais, escalas as escalasTable } from '$lib/server/schema';
import {
	verificarConflitoGlobal,
	verificarConflitoGlobalBatch
} from '$lib/server/escalas/escala-conflict';
import {
	calcularProximoMesDias,
	proximoMes,
	primeiroDiaDoMes,
	ultimoDiaDoMes,
	calcularDataSaida,
	agruparDiasPorPolicial,
	MESES_PT
} from '$lib/rotacao';
import { verificarPermissaoEscala } from '$lib/server/escalas/escala-permissao';

/**
 * Preâmbulo único das actions: autentica, valida o id e garante que o usuário
 * tem permissão para mutar a escala alvo (adicionar/remover policiais etc.).
 * DPC admins com solicitação de assinatura podem VISUALIZAR e ASSINAR, mas não mutam
 * diretamente a escala — portanto essa função mantém a restrição por lotação para mutations.
 * Devolve `db`/`escala`/`usuario` para reaproveitamento; ou um `fail()` pronto para retornar.
 */
async function carregarEscalaComPermissao(
	platform: App.Platform | undefined,
	usuario: App.Locals['usuario'],
	escalaIdRaw: string | undefined
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
	if (usuario.tipo !== 'admin' && usuario.lotacao !== escala.lotacao) {
		return { erro: fail(403, { error: 'Sem permissão para alterar esta escala' }) } as const;
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
export const load: PageServerLoad = async ({ locals, platform, params }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');

	const db = getDB(platform);
	const escalaId = Number(params.id);
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

	// Permissão de EDIÇÃO (mutar servidores/finalizar). Espelha exatamente o guard
	// das actions (`carregarEscalaComPermissao`): Admin Geral em qualquer escala, ou
	// dono da lotação. Um admin_seccional que apenas VÊ a escala de uma unidade sob
	// seu escopo NÃO edita — mas continua podendo ASSINAR (fluxo próprio, cross-unidade).
	const podeEditarEscala = u.tipo === 'admin' || escala.lotacao === u.lotacao;

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
	adicionar: async ({ request, locals, platform, params }) => {
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id);
		if ('erro' in ctx) return ctx.erro;
		const { db, escalaId } = ctx;

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
			return { success: true, policiais };
		} catch {
			return fail(500, { error: 'Erro ao adicionar policial' });
		}
	},

	/**
	 * Inclui um policial em VÁRIOS dias de uma vez (as datas vêm do calendário
	 * do modal, num campo oculto JSON).
	 */
	adicionarPlantao: async ({ request, locals, platform, params }) => {
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id);
		if ('erro' in ctx) return ctx.erro;
		const { db, escalaId } = ctx;

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
			return { success: true, policiais, conflitantes };
		} catch {
			return fail(500, { error: 'Erro ao adicionar policial à escala de plantão' });
		}
	},

	/**
	 * Preenche a escala com todos os policiais da lotação, no horário padrão da
	 * própria escala. Atalho do início do mês, antes dos ajustes individuais.
	 */
	adicionarTodos: async ({ locals, platform, params }) => {
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id);
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId } = ctx;

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
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id);
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
	editar: async ({ request, locals, platform, params }) => {
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id);
		if ('erro' in ctx) return ctx.erro;
		const { db, escalaId } = ctx;

		const data = await request.formData();
		const item_id = Number(data.get('item_id'));
		const data_plantao = data.get('data_plantao')?.toString() || '';
		const data_saida = data.get('data_saida')?.toString() || '';
		const hora_entrada = data.get('hora_entrada')?.toString() || '';
		const hora_saida = data.get('hora_saida')?.toString() || '';
		const observacoes = data.get('observacoes')?.toString() || '';

		if (isNaN(item_id)) return fail(400, { error: 'ID inválido' });

		// Busca policial_id do registro para validar conflito
		const registro = await db
			.select({ policial_id: escalaPoliciais.policial_id })
			.from(escalaPoliciais)
			.where(eq(escalaPoliciais.id, item_id))
			.get();

		if (registro && hora_entrada && hora_saida && data_plantao) {
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
					.where(eq(escalaPoliciais.id, item_id)),
				listarPoliciaisEscalaQuery(db, escalaId)
			]);
			return { success: true, policiais };
		} catch {
			return fail(500, { error: 'Erro ao salvar alterações' });
		}
	},

	/** Remove uma linha e devolve a listagem já atualizada, em um round-trip. */
	remover: async ({ request, locals, platform, params }) => {
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id);
		if ('erro' in ctx) return ctx.erro;
		const { db, escalaId } = ctx;

		const data = await request.formData();
		const item_id = Number(data.get('item_id'));

		if (isNaN(item_id)) return fail(400, { error: 'ID inválido' });

		try {
			// D1 batch: delete + listagem em 1 round-trip
			const [, policiais] = await db.batch([
				db.delete(escalaPoliciais).where(eq(escalaPoliciais.id, item_id)),
				listarPoliciaisEscalaQuery(db, escalaId)
			]);
			return { success: true, policiais };
		} catch {
			return fail(500, { error: 'Erro ao remover policial' });
		}
	},

	/**
	 * Repete um policial já escalado em novas datas, herdando horário e equipe da
	 * linha de origem — evita redigitar o que já está na escala.
	 */
	repetir: async ({ request, locals, platform, params }) => {
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id);
		if ('erro' in ctx) return ctx.erro;
		const { db, escalaId } = ctx;

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
	editarPlantaoAgrupado: async ({ request, locals, platform, params }) => {
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id);
		if ('erro' in ctx) return ctx.erro;
		const { db, escalaId } = ctx;

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

		const origin = await db
			.select({ policial_id: escalaPoliciais.policial_id, equipe: escalaPoliciais.equipe })
			.from(escalaPoliciais)
			.where(eq(escalaPoliciais.id, ids[0]))
			.get();
		if (!origin) return fail(404, { error: 'Registro não encontrado' });

		const policial_id = origin.policial_id;
		const equipe = origin.equipe || '';

		const oldRows = await db
			.select()
			.from(escalaPoliciais)
			.where(inArray(escalaPoliciais.id, ids))
			.all();
		await db.delete(escalaPoliciais).where(inArray(escalaPoliciais.id, ids));

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
	editarDiasEscala: async ({ request, locals, platform, params }) => {
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id);
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId } = ctx;

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
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id);
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

			await finalizarEscalaFDS(db, escalaId, emailDestino);

			let emailEnviado = false;
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
				emailEnviado = true;
			} catch (emailErr) {
				logger.warn('[escalas/finalizar] Falha ao enviar e-mail (finalização prossegue)', {
					escalaId,
					emailDestino,
					error: emailErr instanceof Error ? emailErr.message : String(emailErr)
				});
			}

			const { contexto, env } = contextoDeEvento(event);
			await registrarAuditComContexto(db, {
				usuario: u,
				acao: 'finalizar_escala_fds',
				entidade: 'escala',
				entidade_id: escalaId,
				alvo_tipo: 'escala',
				alvo_id: escalaId,
				detalhes: `Escala de FDS finalizada e enviada para ${emailDestino}: ${escala.titulo}`,
				metadados: { emailDestino, emailEnviado },
				...contexto,
				env
			});
			return { success: true, emailDestino, emailEnviado };
		} catch {
			return fail(500, { error: 'Erro ao finalizar escala' });
		}
	},

	/** Reenvia o PDF da escala de FDS já finalizada (endereço errado, caixa cheia). */
	reenviarEmail: async ({ request, locals, platform, params }) => {
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id);
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
	desfinalizar: async ({ locals, platform, params }) => {
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id);
		if ('erro' in ctx) return ctx.erro;
		const { db, escala, escalaId } = ctx;

		if (escala.tipo !== 'fds')
			return fail(400, { error: 'Operação válida apenas para escalas de FDS' });

		try {
			await desfinalizarEscalaFDS(db, escalaId);
			return { success: true };
		} catch {
			return fail(500, { error: 'Erro ao reabrir escala' });
		}
	},

	/** Esvazia a escala (recomeçar o mês do zero). */
	removerTodos: async ({ locals, platform, params }) => {
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id);
		if ('erro' in ctx) return ctx.erro;
		const { db, escalaId } = ctx;

		try {
			await db.delete(escalaPoliciais).where(eq(escalaPoliciais.escala_id, escalaId));
			return { success: true, policiais: [] };
		} catch {
			return fail(500, { error: 'Erro ao remover todos os servidores' });
		}
	},

	/** Remove em lote as linhas marcadas na tabela. */
	removerSelecionados: async ({ request, locals, platform, params }) => {
		const ctx = await carregarEscalaComPermissao(platform, locals.usuario, params.id);
		if ('erro' in ctx) return ctx.erro;
		const { db, escalaId } = ctx;

		const data = await request.formData();
		const idsJson = data.get('ids')?.toString() || '[]';
		let ids: number[];
		try {
			ids = JSON.parse(idsJson);
			if (!Array.isArray(ids) || ids.length === 0) throw new Error('empty');
		} catch {
			return fail(400, { error: 'IDs inválidos' });
		}

		try {
			const [, policiais] = await db.batch([
				db
					.delete(escalaPoliciais)
					.where(and(eq(escalaPoliciais.escala_id, escalaId), inArray(escalaPoliciais.id, ids))),
				listarPoliciaisEscalaQuery(db, escalaId)
			]);
			return { success: true, policiais, removidos: ids.length };
		} catch {
			return fail(500, { error: 'Erro ao remover servidores selecionados' });
		}
	}
};
