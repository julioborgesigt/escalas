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
	janelaDaEquipe,
	destinoDaEquipe,
	opcoesDoPlano,
	valorPadrao,
	buscarPolicial
} from '$lib/db';
import { unidades } from '$lib/server/schema';
import { eq } from 'drizzle-orm';
import { carregarPlanoParaEdicao } from '$lib/server/planos/permissao';
import { montarCustoDoPlano, versaoDeValores } from '$lib/server/planos/custo-do-plano';
import { podeEmitir } from '$lib/planos/custo';
import { classificarJanela } from '$lib/planos/horas-extras';
import { actionsPlano } from './_actions/actions-plano';
import { actionsEquipe } from './_actions/actions-equipe';
import { actionsMembros } from './_actions/actions-membros';
import { actionsOpcoes } from './_actions/actions-opcoes';

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

	// A MESMA montagem que o PDF usa — ver `custo-do-plano.ts`. É o que impede o
	// documento de imprimir um total diferente do que o admin conferiu aqui.
	const { equipes, porEquipe, parametros, custo } = await montarCustoDoPlano(db, plano);

	// Os rótulos de quem JÁ está escolhido, para os `SearchableSelect` abrirem
	// mostrando a seleção em vez de um campo vazio. Sem eles, um plano com
	// coordenador designado parece não ter nenhum — e salvar por cima apagaria a
	// designação sem que ninguém tivesse pedido isso.
	const opcoes = await opcoesDoPlano(db, plano.id);
	const briefingPadrao = valorPadrao(opcoes.briefing);
	const origemPadrao = valorPadrao(opcoes.origem);
	const destinoPadrao = valorPadrao(opcoes.destino);

	const [coordenador, demandante] = await Promise.all([
		plano.coordenador_id ? buscarPolicial(db, plano.coordenador_id) : Promise.resolve(null),
		plano.demandante_unidade_id
			? db
					.select({ nome: unidades.nome })
					.from(unidades)
					.where(eq(unidades.id, plano.demandante_unidade_id))
					.get()
			: Promise.resolve(undefined)
	]);

	return {
		coordenadorNome: coordenador?.nome ?? '',
		demandanteNome: demandante?.nome ?? '',
		/**
		 * As listas que alimentam os seletores das equipes, e o valor da padrão de
		 * cada tipo — que é o que a equipe nova recebe pré-preenchido.
		 */
		opcoes,
		briefingPadrao,
		origemPadrao,
		destinoPadrao,
		plano,
		/**
		 * Cada equipe com o que a tela precisa: os membros, a janela EFETIVA (já
		 * resolvida pela cascata equipe → plano), o destino efetivo e a sugestão
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
				destinoEfetivo: destinoDaEquipe(e, destinoPadrao),
				sugestaoHoras: classificarJanela(janela),
				custo: custo.equipes.find((c) => c.equipe.id === e.id)?.total ?? 0
			};
		}),
		custo,
		podeEmitir: podeEmitir(custo),
		/** A versão aplicada, para a tela dizer de onde vêm os números. */
		versaoValores: versaoDeValores(parametros)
	};
};

export const actions: Actions = {
	...actionsPlano,
	...actionsEquipe,
	...actionsMembros,
	...actionsOpcoes
};
