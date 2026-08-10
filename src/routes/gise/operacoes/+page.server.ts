/**
 * `/gise/operacoes` — o cadastro das operações extraordinárias (Admin Geral).
 *
 * É a tela que torna "operação" um dado e não uma constante do código: GISE,
 * OPERAÇÃO CRAJUBAR, EDGE, e as que vierem. Três decisões dela valem registro:
 *
 * - **criar pede em qual operação basear o formulário.** Começar do zero é uma
 *   opção, não o padrão — o formulário de produtividade tem dezenas de perguntas
 *   e reescrevê-las a cada operação nova seria o caminho para operações
 *   incomparáveis entre si;
 * - **não existe excluir.** Só desativar. Escala histórica e PDF assinado
 *   continuam apontando para a operação, e apagá-la deixaria documento entregue
 *   sem origem. Mesma regra de `unidades`;
 * - **o clone só acontece na CRIAÇÃO.** Editar uma operação existente não
 *   reclona: isso sobrescreveria em silêncio um formulário que já está em uso,
 *   e as respostas gravadas continuariam com as `key` antigas.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getDB,
	listarOperacoes,
	buscarOperacao,
	criarOperacao,
	atualizarOperacao,
	definirAtivoOperacao,
	contarEscalasPorOperacao,
	clonarModelosFormulario,
	normalizarTiposEquipe,
	tiposEquipeDaOperacao,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { isAdminGeral } from '$lib/auth';
import { ehViolacaoUnique } from '$lib/server/db-errors';
import { logger } from '$lib/server/logger';

export const load: PageServerLoad = async ({ locals, platform, depends }) => {
	depends('app:operacoes');
	if (!isAdminGeral(locals.usuario)) redirect(302, '/gise');

	const db = getDB(platform);
	const [operacoes, contagem] = await Promise.all([
		listarOperacoes(db),
		contarEscalasPorOperacao(db)
	]);

	return {
		operacoes: operacoes.map((o) => ({
			...o,
			// Quantas escalas já usam a operação — é o que explica ao admin por que
			// desativar é a única saída disponível.
			escalas: contagem.get(o.id) ?? 0
		}))
	};
};

/** Texto do formulário, aparado e limitado. Vazio vira `''`, nunca `undefined`. */
function texto(fd: FormData, campo: string, max: number): string {
	return String(fd.get(campo) ?? '')
		.trim()
		.slice(0, max);
}

/** Checkbox do HTML: presente = ligado. */
function marcado(fd: FormData, campo: string): boolean {
	return fd.get(campo) != null;
}

/** `YYYY-MM-DD` ou `null`. Formato inválido vira `null` em vez de erro: o ciclo é opcional. */
function dataOuNulo(fd: FormData, campo: string): string | null {
	const v = texto(fd, campo, 10);
	return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export const actions: Actions = {
	/**
	 * Cria a operação e, se pedido, clona o formulário de outra.
	 *
	 * Ordem obrigatória: valida → cria → clona. O clone depende do id novo, e
	 * falhar depois de criar deixa a operação existindo com formulário padrão —
	 * estado recuperável pelo editor. O inverso (clonar antes de existir) não é
	 * representável.
	 */
	criar: async (event) => {
		const { request, locals, platform } = event;
		if (!isAdminGeral(locals.usuario)) return fail(403, { error: 'Somente Administrador Geral' });

		const fd = await request.formData();
		const nome = texto(fd, 'nome', 120);
		if (!nome) return fail(400, { error: 'O nome da operação é obrigatório.' });

		const tipos = normalizarTiposEquipe(marcado(fd, 'usa_operacional'), marcado(fd, 'usa_seint'));
		if (!tipos) {
			return fail(400, {
				error: 'Selecione ao menos um tipo de equipe — sem nenhum, a operação não escala ninguém.'
			});
		}

		const baseIdBruto = Number(fd.get('basear_em'));
		const baseId = Number.isInteger(baseIdBruto) && baseIdBruto > 0 ? baseIdBruto : null;

		const db = getDB(platform);

		// A operação-base precisa existir. Um id inválido é recusado em vez de
		// ignorado: o admin pediu para basear em algo, e criar em branco calado
		// entregaria uma operação diferente da que ele pediu.
		if (baseId != null && !(await buscarOperacao(db, baseId))) {
			return fail(400, { error: 'A operação escolhida como base não existe.' });
		}

		let novoId: number;
		try {
			novoId = await criarOperacao(db, {
				nome,
				sigla: texto(fd, 'sigla', 30),
				descricao: texto(fd, 'descricao', 500),
				usaEquipeOperacional: tipos.usa_equipe_operacional,
				usaEquipeSeint: tipos.usa_equipe_seint,
				dataInicio: dataOuNulo(fd, 'data_inicio'),
				dataFim: dataOuNulo(fd, 'data_fim')
			});
		} catch (e) {
			if (ehViolacaoUnique(e)) {
				return fail(409, { error: `Já existe uma operação chamada "${nome}".` });
			}
			logger.error('[gise/operacoes] criar', { error: String(e) });
			return fail(500, { error: 'Erro ao criar a operação.' });
		}

		let clonados: string[] = [];
		if (baseId != null) {
			try {
				clonados = await clonarModelosFormulario(db, baseId, novoId, tiposEquipeDaOperacao(tipos));
			} catch (e) {
				// A operação já existe e é utilizável — o editor resolve o formulário.
				// Derrubar a requisição aqui só esconderia isso do admin.
				logger.error('[gise/operacoes] clonar formulário', { error: String(e), baseId, novoId });
			}
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'criar_operacao',
				usuario: locals.usuario,
				entidade: 'operacao',
				entidade_id: novoId,
				detalhes: `Operação "${nome}" criada`,
				dados_depois: {
					nome,
					tipos: tiposEquipeDaOperacao(tipos),
					baseadaEm: baseId,
					formulariosClonados: clonados
				},
				...contexto
			},
			{ env }
		);

		return { success: true, criada: nome, clonados };
	},

	/** Patch dos campos editáveis. Não reclona formulário — ver o cabeçalho. */
	editar: async (event) => {
		const { request, locals, platform } = event;
		if (!isAdminGeral(locals.usuario)) return fail(403, { error: 'Somente Administrador Geral' });

		const fd = await request.formData();
		const id = Number(fd.get('id'));
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Operação inválida' });

		const nome = texto(fd, 'nome', 120);
		if (!nome) return fail(400, { error: 'O nome da operação é obrigatório.' });

		const tipos = normalizarTiposEquipe(marcado(fd, 'usa_operacional'), marcado(fd, 'usa_seint'));
		if (!tipos) {
			return fail(400, { error: 'Selecione ao menos um tipo de equipe.' });
		}

		const db = getDB(platform);
		const antes = await buscarOperacao(db, id);
		if (!antes) return fail(404, { error: 'Operação não encontrada' });

		try {
			await atualizarOperacao(db, id, {
				nome,
				sigla: texto(fd, 'sigla', 30),
				descricao: texto(fd, 'descricao', 500),
				data_inicio: dataOuNulo(fd, 'data_inicio'),
				data_fim: dataOuNulo(fd, 'data_fim'),
				...tipos
			});
		} catch (e) {
			if (ehViolacaoUnique(e)) {
				return fail(409, { error: `Já existe uma operação chamada "${nome}".` });
			}
			logger.error('[gise/operacoes] editar', { error: String(e) });
			return fail(500, { error: 'Erro ao salvar a operação.' });
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'editar_operacao',
				usuario: locals.usuario,
				entidade: 'operacao',
				entidade_id: id,
				detalhes: `Operação "${nome}" alterada`,
				dados_antes: {
					nome: antes.nome,
					usa_equipe_operacional: antes.usa_equipe_operacional,
					usa_equipe_seint: antes.usa_equipe_seint
				},
				dados_depois: { nome, ...tipos },
				...contexto
			},
			{ env }
		);

		return { success: true };
	},

	/**
	 * Ativa/desativa. É o substituto da exclusão: a operação some das listas de
	 * escolha e continua resolvendo nome e id em todo o histórico.
	 */
	alternarAtivo: async (event) => {
		const { request, locals, platform } = event;
		if (!isAdminGeral(locals.usuario)) return fail(403, { error: 'Somente Administrador Geral' });

		const fd = await request.formData();
		const id = Number(fd.get('id'));
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Operação inválida' });

		const db = getDB(platform);
		const operacao = await buscarOperacao(db, id);
		if (!operacao) return fail(404, { error: 'Operação não encontrada' });

		const novoAtivo = !operacao.ativo;
		await definirAtivoOperacao(db, id, novoAtivo);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: novoAtivo ? 'ativar_operacao' : 'desativar_operacao',
				usuario: locals.usuario,
				entidade: 'operacao',
				entidade_id: id,
				detalhes: `Operação "${operacao.nome}" ${novoAtivo ? 'reativada' : 'desativada'}`,
				...contexto
			},
			{ env }
		);

		return { success: true, ativo: novoAtivo };
	}
};
