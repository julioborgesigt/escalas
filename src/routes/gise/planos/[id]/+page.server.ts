/**
 * `load` do editor de plano operacional e o ponto de junção das suas actions.
 *
 * O `load` monta a árvore inteira (plano → equipes → membros) e já devolve o
 * CUSTO calculado. Calcular no servidor, e não na tela, é o que garante que o
 * número que o admin confere seja o mesmo que o PDF imprime: são a mesma
 * chamada a `custoDoPlano`, com os mesmos valores congelados.
 *
 * As actions estão divididas por ASSUNTO em `_actions/` — plano, equipe e
 * membros — e espalhadas aqui num objeto só, como em `/gise/[id]`. O preâmbulo
 * que todas repetem (carregar, autorizar, amarrar o id filho ao plano) mora em
 * `_actions/shared.ts`.
 *
 * `depends('planos:detalhe')` é a chave que as actions invalidam: a página se
 * recarrega sem `invalidateAll()`, que derrubaria o layout junto.
 */
import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getDB,
	listarEquipes,
	listarMembrosDoPlano,
	agruparPorEquipe,
	buscarCustoParametros,
	buscarCustoParametrosVigente,
	valoresDe,
	janelaDaEquipe,
	briefingDaEquipe
} from '$lib/db';
import { carregarPlanoParaEdicao } from '$lib/server/planos/permissao';
import { custoDoPlano, podeEmitir, type ValoresCusto } from '$lib/planos/custo';
import { classificarJanela } from '$lib/planos/horas-extras';
import { actionsPlano } from './_actions/actions-plano';
import { actionsEquipe } from './_actions/actions-equipe';
import { actionsMembros } from './_actions/actions-membros';

/** Valores zerados: só para o cálculo não estourar quando não há tabela gravada. */
const SEM_VALORES: ValoresCusto = {
	oip_cd_normal: 0,
	oip_ab_normal: 0,
	dpc_12_normal: 0,
	dpc_3e_normal: 0,
	oip_cd_plus: 0,
	oip_ab_plus: 0,
	dpc_12_plus: 0,
	dpc_3e_plus: 0,
	diaria_estadual: 0,
	diaria_interestadual: 0
};

export const load: PageServerLoad = async ({ locals, params, platform, depends }) => {
	depends('planos:detalhe');

	const db = getDB(platform);
	const id = Number(params.id);
	const acesso = await carregarPlanoParaEdicao(db, id, locals.usuario);
	if (acesso instanceof Response) {
		// O portão devolve 403 para quem não é Admin Geral e 404 para plano
		// inexistente. Aqui vira redirect no primeiro caso (a barra lateral nem
		// mostra o item, então cair na lista é o comportamento esperado) e `error`
		// no segundo, que é a página de fato inexistente.
		if (acesso.status === 404) error(404, 'Plano operacional não encontrado');
		redirect(302, '/gise');
	}
	const { plano } = acesso;

	const [equipes, membros] = await Promise.all([
		listarEquipes(db, plano.id),
		listarMembrosDoPlano(db, plano.id)
	]);
	const porEquipe = agruparPorEquipe(membros);

	/**
	 * A versão de valores que ESTE plano aplica.
	 *
	 * A congelada na criação, sempre que existir. A vigente só entra quando o
	 * plano nasceu sem tabela nenhuma — nesse caso ele adota a primeira que
	 * aparecer, o que é melhor do que ficar preso em zero para sempre. Um plano
	 * que já tem versão NUNCA migra para a vigente: é isso que faz o PDF sair
	 * igual depois de um reajuste.
	 */
	const parametros = plano.custo_parametro_id
		? await buscarCustoParametros(db, plano.custo_parametro_id)
		: await buscarCustoParametrosVigente(db);

	const valores = parametros ? valoresDe(parametros) : SEM_VALORES;

	const custo = custoDoPlano(
		equipes.map((e) => ({
			equipe: {
				id: e.id,
				nome: e.nome,
				tipo_custo: e.tipo_custo,
				horas_normais: e.horas_normais,
				horas_plus: e.horas_plus,
				diaria_tipo: e.diaria_tipo,
				diarias_meias: e.diarias_meias
			},
			membros: (porEquipe.get(e.id) ?? []).map((m) => ({
				id: m.id,
				policial_id: m.policial_id,
				nome: m.nome,
				cargo_snapshot: m.cargo_snapshot,
				classe_snapshot: m.classe_snapshot
			}))
		})),
		valores
	);

	return {
		plano,
		/**
		 * Cada equipe com o que a tela precisa: os membros, a janela EFETIVA (já
		 * resolvida pela cascata equipe → plano), o briefing efetivo e a sugestão
		 * de horas daquela janela.
		 *
		 * A sugestão é calculada aqui, e não no `.svelte`, porque depende da mesma
		 * cascata que o PDF usa — duas resoluções do horário efetivo divergiriam,
		 * e a divergência sairia como hora extra a mais ou a menos no documento.
		 */
		equipes: equipes.map((e) => {
			const janela = janelaDaEquipe(e, plano);
			return {
				...e,
				membros: porEquipe.get(e.id) ?? [],
				janela,
				briefingEfetivo: briefingDaEquipe(e, plano),
				sugestaoHoras: classificarJanela(janela),
				custo: custo.equipes.find((c) => c.equipe.id === e.id)?.total ?? 0
			};
		}),
		custo,
		podeEmitir: podeEmitir(custo),
		/** A versão aplicada, para a tela dizer de onde vêm os números. */
		versaoValores: parametros
			? { id: parametros.id, vigente_desde: parametros.vigente_desde }
			: null
	};
};

export const actions: Actions = {
	...actionsPlano,
	...actionsEquipe,
	...actionsMembros
};
