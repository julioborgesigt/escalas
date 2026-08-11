/**
 * Como o painel de produtividade AGRUPA, ORDENA e RECORTA as unidades.
 *
 * As três respostas — por qual chave agrupar, quais linhas existem mesmo sem
 * resposta, e quais sobram depois do Top-N — eram dadas em três lugares que não
 * se conhecem: `calculateRanking` (cards de ranking), `updateCharts` (gráfico de
 * cada pergunta) e a rotulagem do `RankingCard`. Cada um escrevia "por
 * seccional" do seu jeito, e acrescentar "por delegacia" em três cópias é
 * exatamente a forma de bug que o `CLAUDE.md` cataloga.
 *
 * ## Delegacia × seccional não é um filtro, é um EIXO
 *
 * A mesma resposta pertence às duas: a linha traz `seccional_id` e `unidade_id`
 * (este resolvido em `listarTodasRespostasGise` como
 * `COALESCE(slot, unidade_operacional, seccional)`). Trocar de modo não recorta
 * dado nenhum — só muda por qual das duas chaves ele é somado. É por isso que o
 * total do painel não muda ao alternar, só a quebra.
 *
 * ## "Melhor" não é "maior"
 *
 * A ordem é SEMÂNTICA: quem chama informa o valor pelo qual "melhor" se mede.
 * Num volume (prisões, drogas) melhor é maior; num indicador de meta com
 * objetivo `diminuir` — o acervo de inquéritos da CRAJUBAR — a unidade com o
 * MENOR número é a melhor, e é o % de atingimento que ordena. Se esta função
 * ordenasse pelo número cru, "melhores primeiro" poria a pior delegacia no topo
 * justamente no indicador principal da operação.
 */

/** Por qual eixo o painel compara: cada delegacia, ou a seccional consolidada. */
export type ModoVisualizacao = 'delegacias' | 'seccionais';

/** Sentido do ranking. Semântico, não numérico — ver o cabeçalho. */
export type Ordem = 'melhores' | 'piores';

/** Quantas unidades entram. `'todas'` é o padrão e o comportamento histórico. */
export type Quantidade = 5 | 10 | 'todas';

/** Uma unidade no eixo do painel: o que vira linha de ranking ou barra de gráfico. */
export interface GrupoUnidade {
	id: number;
	nome: string;
	/** O nome encurtado para caber no eixo. O completo continua no tooltip. */
	curto: string;
}

/**
 * O nome que cabe num rótulo de eixo, por modo.
 *
 * Em seccional o que distingue é o ordinal, então "1ª Seccional do Interior Sul"
 * vira "1ª Seccional" — é a regra que o painel já usava. Em delegacia é o
 * contrário: o que distingue é o MUNICÍPIO, e cortar depois do "de/do" deixaria
 * todas chamadas "Delegacia". Aqui o prefixo é que sai, e sobra "CRATO".
 *
 * Nome que não casa com nenhum dos dois padrões volta inteiro — encurtar no
 * escuro é como se perde a única parte que identifica a unidade.
 *
 * Não exportada: sai pronta em `GrupoUnidade.curto`, e um segundo call site
 * chamando-a por fora poderia encurtar com um modo diferente do que montou o
 * grupo.
 */
function rotuloCurto(nome: string, modo: ModoVisualizacao): string {
	if (modo === 'seccionais') return nome.split(/ d[oa] /i)[0];
	const semPrefixo = nome.replace(/^delegacia\s+(d[eoa]s?\s+)?/i, '').trim();
	return semPrefixo || nome;
}

/** O mínimo de uma linha de resposta para ser agrupada. */
type LinhaAgrupavel = {
	seccional_id?: number | null;
	unidade_id?: number | null;
};

/**
 * De qual campo da linha sai a chave do grupo, neste modo.
 *
 * Função, e não um `if` em cada consumidor: é a única tradução entre "o modo que
 * o usuário escolheu" e "o campo do blob", e ela precisa ser a mesma nos
 * rankings, nos gráficos e na exportação.
 */
export function chaveDoGrupo(modo: ModoVisualizacao): (linha: LinhaAgrupavel) => number | null {
	return modo === 'seccionais'
		? (linha) => linha.seccional_id ?? null
		: (linha) => linha.unidade_id ?? null;
}

/**
 * O universo de linhas do painel — quem aparece, inclusive quem não produziu.
 *
 * `seccionais`: todas as seccionais cadastradas. É o comportamento histórico, e
 * mostrar a que não produziu com total 0 é deliberado — "não produziu" é
 * informação, não ausência de dado.
 *
 * `delegacias`: as unidades participantes que NÃO são seccional, unidas às que
 * de fato aparecem como `unidade_id` nas respostas. A união resolve os dois
 * lados do mesmo problema:
 *
 * - uma equipe escalada direto na seccional, sem slot de delegacia, resolve
 *   `unidade_id` para a própria seccional. Ela entra como linha própria, porque
 *   foi ela quem produziu — sem isso a soma das linhas ficaria menor que o total
 *   do painel, sem nada explicando a diferença;
 * - uma seccional que é só "pai" (todas as equipes dela têm slot) NÃO entra,
 *   senão o ranking de delegacias teria uma linha zerada que não é delegacia
 *   nenhuma.
 */
export function gruposDaVisualizacao(
	modo: ModoVisualizacao,
	fontes: {
		seccionais: ReadonlyArray<{ id: number; nome: string }>;
		unidadesDaOperacao: ReadonlyArray<{ id: number; nome: string; tipo: string }>;
		linhas: ReadonlyArray<LinhaAgrupavel>;
	}
): GrupoUnidade[] {
	if (modo === 'seccionais') {
		return fontes.seccionais.map((s) => ({
			id: s.id,
			nome: s.nome,
			curto: rotuloCurto(s.nome, modo)
		}));
	}

	const porId = new Map<number, GrupoUnidade>();
	for (const u of fontes.unidadesDaOperacao) {
		if (u.tipo !== 'seccional') {
			porId.set(u.id, { id: u.id, nome: u.nome, curto: rotuloCurto(u.nome, modo) });
		}
	}

	// As que produziram e ainda não estão no mapa — o caso da equipe sem slot.
	// O nome sai de `unidadesDaOperacao`, que traz também as seccionais; sem ele
	// a linha apareceria sem rótulo, e um ranking sem nome não se lê.
	const nomes = new Map(fontes.unidadesDaOperacao.map((u) => [u.id, u.nome]));
	for (const linha of fontes.linhas) {
		const id = linha.unidade_id;
		if (id == null || porId.has(id)) continue;
		const nome = nomes.get(id);
		if (nome) porId.set(id, { id, nome, curto: rotuloCurto(nome, modo) });
	}

	return [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/**
 * Ordena pelo valor informado e corta no Top-N.
 *
 * `valor` devolvendo `null` significa "não avaliável" (unidade sem linha de
 * base, período sem ocorrência). Essas linhas vão sempre para o FIM, nos dois
 * sentidos: elas não são as piores, são as que não se sabe — e colocá-las no topo
 * de "piores primeiro" afirmaria algo que o dado não diz.
 *
 * Ordenação estável em empate (`Array.prototype.sort` é estável desde ES2019),
 * então unidades com o mesmo total mantêm a ordem alfabética que `gruposDaVisualizacao`
 * já deu — e a lista não dança a cada redesenho.
 */
export function ordenarERecortar<T>(
	itens: ReadonlyArray<T>,
	opcoes: {
		ordem: Ordem;
		quantidade: Quantidade;
		/** O número pelo qual "melhor" se mede. `null` = não avaliável. */
		valor: (item: T) => number | null;
	}
): T[] {
	const sinal = opcoes.ordem === 'melhores' ? -1 : 1;

	const ordenado = [...itens].sort((a, b) => {
		const va = opcoes.valor(a);
		const vb = opcoes.valor(b);
		if (va == null && vb == null) return 0;
		if (va == null) return 1;
		if (vb == null) return -1;
		return (va - vb) * sinal;
	});

	return opcoes.quantidade === 'todas' ? ordenado : ordenado.slice(0, opcoes.quantidade);
}

/**
 * Como o recorte se descreve em texto — cabeçalho de PNG exportado e rótulo de
 * tela.
 *
 * Mora aqui porque o PNG exportado sai do painel e circula sozinho: sem dizer
 * que é um Top 5, o gráfico afirma ser a operação inteira.
 */
export function descreverRecorte(
	modo: ModoVisualizacao,
	quantidade: Quantidade,
	ordem: Ordem
): string {
	const eixo = modo === 'seccionais' ? 'seccionais' : 'delegacias';
	if (quantidade === 'todas') return `Todas as ${eixo}`;
	const sentido = ordem === 'melhores' ? 'melhores' : 'piores';
	return `Top ${quantidade} ${eixo} — ${sentido} primeiro`;
}
