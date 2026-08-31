/**
 * `/gise/planos/novo` — os parâmetros gerais do plano operacional.
 *
 * Rota própria, e não modal: são quinze campos mais um calendário, e o README
 * §10 é explícito ("formulário longo vira rota"). Tem endereço, sobrevive a um
 * reload e admite ser retomada.
 *
 * ## Ordem obrigatória: valida → cria o plano → cria as equipes
 *
 * O plano precisa existir antes das equipes (elas apontam para ele), e falhar
 * na criação das equipes deixa um plano SEM equipe — estado válido, que o
 * editor resolve com um clique. O inverso não é representável. É a mesma ordem
 * de `criar` em `/gise/operacoes`, e pelo mesmo motivo.
 *
 * ## O que é copiado na criação, e por quê
 *
 * `custo_parametro_id` e o par `diretor_nome`/`diretor_cargo` são CONGELADOS
 * aqui. O plano guarda a versão de valores vigente no momento em que nasceu e o
 * signatário de então — reajustar valores ou trocar o Diretor depois não pode
 * reescrever um documento já emitido.
 *
 * ## O signatário é escolhido AQUI, e não há padrão global
 *
 * Quem assina VARIA por operação (o Titular assina umas, o Adjunto outras),
 * então o formulário tem o campo. O nome vem da busca no cadastro, como o
 * coordenador, e o que se grava são os dois: `diretor_id` (para o editor
 * reabrir mostrando a seleção) e `diretor_nome` (o texto congelado que o PDF
 * imprime).
 *
 * Sem escolha, o plano nasce sem signatário e o documento imprime a linha de
 * assinatura em BRANCO — que é o estado honesto de um plano cujo signatário
 * ainda não foi definido, e visível para quem for emitir. Houve um padrão
 * global em `/config-custos`; ele saiu porque um padrão único para um dado que
 * varia ou é ignorado quase sempre, ou leva a mudar a configuração de todos os
 * planos seguintes para acertar um.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getDB,
	criarPlano,
	criarEquipes,
	adicionarOpcao,
	buscarCustoParametrosVigente,
	auditar,
	contextoDeEvento,
	buscarPolicial
} from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { hojeBrasilISO } from '$lib/utils/datas';
import { validarHora, normalizarHora } from '$lib/gise/horarios';
import { logger } from '$lib/server/logger';
import {
	FINALIDADE_PADRAO,
	ACOES_PADRAO,
	DEPARTAMENTO_PADRAO,
	CARGO_SIGNATARIO_PADRAO,
	cargoSignatarioValido
} from '$lib/planos/padroes';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!isAdminGeral(locals.usuario)) redirect(302, '/gise');

	const db = getDB(platform);
	const vigente = await buscarCustoParametrosVigente(db);

	return {
		hoje: hojeBrasilISO(),
		finalidadePadrao: FINALIDADE_PADRAO,
		acoesPadrao: ACOES_PADRAO,
		/**
		 * Há tabela de valores gravada? A tela avisa quando não há — sem ela o
		 * Anexo II sairia zerado, e um custo zero indistinguível de "não custa
		 * nada" é pior do que um aviso na criação.
		 */
		temValores: vigente !== null,
		/** O primeiro da lista fechada — quem assina de fato se escolhe no campo. */
		diretorCargo: CARGO_SIGNATARIO_PADRAO
	};
};

/** Inteiro entre `min` e `max`, ou `null` quando não é número válido. */
function inteiro(fd: FormData, campo: string, min: number, max: number): number | null {
	const n = Number(String(fd.get(campo) ?? '').trim());
	if (!Number.isInteger(n) || n < min || n > max) return null;
	return n;
}

/** Texto aparado e limitado. */
function texto(fd: FormData, campo: string, max: number): string {
	return String(fd.get(campo) ?? '')
		.trim()
		.slice(0, max);
}

export const actions: Actions = {
	criar: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!isAdminGeral(u)) return fail(403, { error: 'Somente Administrador Geral' });

		const fd = await request.formData();

		const nome = texto(fd, 'nome', 160);
		if (!nome) return fail(400, { error: 'O nome da operação é obrigatório.' });

		const dataInicio = texto(fd, 'data_inicio', 10);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio)) {
			return fail(400, { error: 'Escolha a data da operação no calendário.' });
		}

		// Horários: início é obrigatório; fim é opcional e, sem ele, a tela não
		// oferece a sugestão automática de horas (ver `classificarJanela`).
		const horaInicio = normalizarHora(texto(fd, 'hora_inicio', 5));
		if (!horaInicio || !validarHora(horaInicio)) {
			return fail(400, { error: 'Horário de início inválido. Use HH:MM.' });
		}
		const horaFimBruta = texto(fd, 'hora_fim', 5);
		let horaFim: string | null = null;
		if (horaFimBruta) {
			horaFim = normalizarHora(horaFimBruta);
			if (!horaFim || !validarHora(horaFim)) {
				return fail(400, { error: 'Horário de término inválido. Use HH:MM.' });
			}
		}

		const dataFimBruta = texto(fd, 'data_fim', 10);
		const dataFim = /^\d{4}-\d{2}-\d{2}$/.test(dataFimBruta) ? dataFimBruta : null;
		if (dataFim && dataFim < dataInicio) {
			return fail(400, { error: 'A data de término é anterior à de início.' });
		}

		const qtdEquipes = inteiro(fd, 'qtd_equipes', 0, 50);
		if (qtdEquipes === null) {
			return fail(400, { error: 'Quantidade de equipes deve ser um número de 0 a 50.' });
		}
		const oipPorEquipe = inteiro(fd, 'oip_por_equipe', 0, 99);
		if (oipPorEquipe === null) {
			return fail(400, { error: 'OIPs por equipe deve ser um número de 0 a 99.' });
		}

		const coordenadorId = inteiro(fd, 'coordenador_id', 1, Number.MAX_SAFE_INTEGER);
		const demandanteId = inteiro(fd, 'demandante_unidade_id', 1, Number.MAX_SAFE_INTEGER);
		const diretorId = inteiro(fd, 'diretor_id', 1, Number.MAX_SAFE_INTEGER);

		const db = getDB(platform);

		// A versão de valores e o signatário são congelados AGORA — ver o cabeçalho
		// do módulo. Sem escolha, o nome fica vazio e o documento imprime a linha
		// de assinatura em branco.
		const [vigente, escolhido] = await Promise.all([
			buscarCustoParametrosVigente(db),
			diretorId ? buscarPolicial(db, diretorId) : Promise.resolve(null)
		]);

		const diretorNome = escolhido?.nome ?? '';
		const diretorCargo = cargoSignatarioValido(texto(fd, 'diretor_cargo', 160));

		let criado: { id: number; numero: number; ano: number };
		try {
			criado = await criarPlano(db, {
				nome,
				finalidade: texto(fd, 'finalidade', 2000) || FINALIDADE_PADRAO,
				acoes: texto(fd, 'acoes', 2000) || ACOES_PADRAO,
				nup: texto(fd, 'nup', 40) || null,
				data_inicio: dataInicio,
				hora_inicio: horaInicio,
				data_fim: dataFim,
				hora_fim: horaFim,
				feriado: fd.get('feriado') != null,
				coordenador_id: coordenadorId,
				demandante_unidade_id: demandanteId,
				departamento: texto(fd, 'departamento', 60) || DEPARTAMENTO_PADRAO,
				oip_por_equipe_padrao: oipPorEquipe,
				diretor_id: escolhido?.id ?? null,
				diretor_nome: diretorNome,
				diretor_cargo: diretorCargo,
				custo_parametro_id: vigente?.id ?? null
			});
		} catch (e) {
			logger.error('[gise/planos/novo] criar', { error: String(e) });
			return fail(500, { error: 'Erro ao criar o plano operacional.' });
		}

		// O briefing e o destino informados aqui viram a PRIMEIRA opção de cada
		// lista, já marcada como padrão (é `adicionarOpcao` quem decide isso). O
		// editor acrescenta as demais depois — a criação pede uma de cada porque é
		// o caso comum, e uma lista vazia deixaria as equipes nascendo em branco.
		const briefingPadrao = texto(fd, 'local_briefing_padrao', 200);
		const destinoPadrao = texto(fd, 'cidade_destino_padrao', 200);
		try {
			if (briefingPadrao) await adicionarOpcao(db, criado.id, 'briefing', briefingPadrao);
			if (destinoPadrao) await adicionarOpcao(db, criado.id, 'destino', destinoPadrao);
		} catch (e) {
			logger.error('[gise/planos/novo] criar opções', { error: String(e), plano: criado.id });
		}

		// Equipes num terceiro passo: falhar aqui deixa o plano existindo sem
		// equipe, que o editor resolve. Derrubar a requisição esconderia isso.
		try {
			await criarEquipes(db, criado.id, {
				quantidade: qtdEquipes,
				comSeint: fd.get('tem_seint') != null,
				briefingPadrao,
				destinoPadrao
			});
		} catch (e) {
			logger.error('[gise/planos/novo] criar equipes', { error: String(e), plano: criado.id });
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'criar_plano_operacional',
				usuario: u,
				entidade: 'plano_operacional',
				entidade_id: criado.id,
				detalhes: `Plano ${criado.numero}/${criado.ano} "${nome}" criado`,
				dados_depois: {
					numero: criado.numero,
					ano: criado.ano,
					nome,
					data_inicio: dataInicio,
					equipes: qtdEquipes,
					seint: fd.get('tem_seint') != null,
					custo_parametro_id: vigente?.id ?? null
				},
				...contexto
			},
			{ env }
		);

		redirect(303, `/gise/planos/${criado.id}`);
	}
};
