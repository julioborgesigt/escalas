import { toaster } from '$lib/toast';
import { apiFetchResponse } from '$lib/api-fetch';
import { baixarBlob, nomeArquivoContentDisposition } from '$lib/utils/download';
import { fmtDate } from '$lib/gise/formatters';
import { renumerarPerguntas } from '$lib/gise/renumerar-perguntas';
import { ehProporcao } from '$lib/gise/indicadores';
import { formasDaMarca, type FormaGrafico } from '$lib/produtividade';
import { loading } from '$lib/loading.svelte';
import { page } from '$app/state';
import { goto } from '$app/navigation';
import { untrack } from 'svelte';
import { invalidateShared } from '$lib/cross-tab-invalidate';
import type { ActionResult } from '@sveltejs/kit';
import { postPageAction } from '$lib/post-form-action';
import type {
	GiseModeloPerguntaConfig,
	ResGiseEscalaSelecionavel,
	ResGisePageData
} from '$lib/types';
import type { GisePresenca } from '$lib/server/schema';
import type { SignaturePadConfirmPayload } from '$lib/components/SignaturePadTypes';

function messageFromUnknown(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function erroDaAction(result: ActionResult, fallback: string): string {
	if (result.type === 'failure') {
		const data = result.data as { error?: string } | undefined;
		if (data?.error) return data.error;
	}
	if (result.type === 'error' && result.error) {
		return typeof result.error === 'string' ? result.error : fallback;
	}
	return fallback;
}

export function useResGise(getData: () => ResGisePageData) {
	// --- Derived do Objeto de Dados (Reactive Root) ---
	const data = $derived(getData());

	// --- Estados de Interface ---
	let configTipo = $state<'operacional' | 'seint'>('operacional');
	let perguntasConfig = $state<GiseModeloPerguntaConfig[]>([]);
	// --- Estados de Escala / Resposta ---
	let escalaSelecionada = $state<ResGiseEscalaSelecionavel | null>(null);
	let capturandoRubrica = $state(false);

	// --- Filtros ---
	// Espelham a URL (fonte única). São as duas abas da sidebar que trocam o
	// `?status`: sem ele é "ativas", com `finalizadas` é o histórico. Derivados
	// (não `$state`) porque quem manda é a URL — a aba "Presença GISE" navega
	// para `/res-gise` SEM `status`, e um `$state` sincronizado só quando o
	// parâmetro existe ficaria preso em "finalizadas" ao voltar do histórico.
	const statusFilterUrl = $derived(
		page.url.searchParams.get('status') === 'finalizadas' ? 'finalizadas' : 'ativas'
	);
	const mesFilterUrl = $derived(page.url.searchParams.get('mes') || '');
	const dataFilterUrl = $derived(page.url.searchParams.get('data') || '');

	let idProdutividadeBaixando = $state<number | null>(null);
	let idExtraBaixando = $state<number | null>(null);
	// Qual comprovante de presença está baixando ('entrada' | 'saida' | null).
	let termoBaixando = $state<'entrada' | 'saida' | null>(null);

	// Após invalidate externo (outra aba / poll), realinha a seleção ao load fresco.
	// Só depende de `minhasEscalas` — ler `escalaSelecionada` no effect causaria loop.
	$effect(() => {
		const lista = data.minhasEscalas;
		const sel = untrack(() => escalaSelecionada);
		if (!sel || !lista) return;
		const atualizada = lista.find((e) => e.id === sel.id && e.equipe_id === sel.equipe_id);
		if (atualizada) escalaSelecionada = atualizada;
	});

	// --- Efeitos de Sincronização ---
	$effect(() => {
		const source = configTipo === 'seint' ? data.modeloSeint : data.modeloOperacional;
		perguntasConfig = structuredClone(source);
	});

	/**
	 * A operação em edição sai do SERVIDOR, não de um `$state` local: quem resolve
	 * `?operacaoId=` (e o fallback quando ele é inválido) é o `load`, e duplicar
	 * essa decisão aqui deixaria o editor mostrando uma operação e salvando em
	 * outra.
	 */
	const operacaoSelecionada = $derived(
		data.operacoes.find((o) => o.id === data.operacaoSelecionadaId) ?? null
	);

	/**
	 * Tipos de equipe que ESTA operação usa. Uma operação só de inteligência não
	 * mostra a aba "Operacional" — e a action recusa o POST correspondente, então
	 * o que a tela esconde o servidor também nega.
	 */
	const tiposDisponiveis = $derived.by((): Array<'operacional' | 'seint'> => {
		const op = operacaoSelecionada;
		if (!op) return ['operacional', 'seint'];
		const t: Array<'operacional' | 'seint'> = [];
		if (op.usa_equipe_operacional) t.push('operacional');
		if (op.usa_equipe_seint) t.push('seint');
		return t.length > 0 ? t : ['operacional'];
	});

	// Trocar de operação pode deixar o tipo corrente indisponível (estava em
	// "Operacional" e a nova operação é só SEINT). Cai no primeiro disponível em
	// vez de manter uma aba que a operação não tem.
	$effect(() => {
		const disponiveis = tiposDisponiveis;
		if (!disponiveis.includes(untrack(() => configTipo))) configTipo = disponiveis[0];
	});

	/** Troca a operação em edição pela URL — o `load` recarrega os modelos dela. */
	function trocarOperacao(id: number) {
		navigateWithFilters({ operacaoId: String(id) });
	}

	/**
	 * Liga/desliga UMA FORMA do gráfico da pergunta no painel de produtividade.
	 *
	 * Três formas independentes (colunas, ranking, detalhamento), e a pergunta
	 * pode ter quantas quiser: drogas e armas mostram ranking E detalhamento, que
	 * é como o painel sempre as desenhou.
	 *
	 * Remove a chave inteira quando a última forma é desligada, em vez de deixar
	 * `{}` pendurado: a ausência já é a resposta ("não aparece"), e um objeto vazio
	 * no JSON convidaria a próxima leitura a inventar um terceiro estado. Mesma
	 * escolha de `alternarIndicador`, logo abaixo.
	 *
	 * `formasDaMarca` normaliza a leitura porque o modelo pode trazer a marca
	 * ANTIGA — o booleano anterior à migração 0054, ainda possível numa
	 * sub-pergunta, que a migração não alcançou.
	 *
	 * Independente do indicador de propósito — são duas seções diferentes do
	 * painel. Uma pergunta pode ser gráfico sem meta (volume que se acompanha sem
	 * prometer número) e meta sem gráfico (a de cobertura, que já tem a própria
	 * leitura).
	 */
	function alternarFormaGrafico(p: GiseModeloPerguntaConfig, forma: FormaGrafico) {
		const formas = formasDaMarca(p.grafico);
		formas[forma] = !formas[forma];

		if (!formas.colunas && !formas.ranking && !formas.detalhe) delete p.grafico;
		else p.grafico = formas;

		perguntasConfig = [...perguntasConfig];
	}

	/**
	 * Liga/desliga o indicador de meta de uma pergunta.
	 *
	 * Ao ligar, semeia o caso que o tipo da pergunta já anuncia: cobertura de 100%
	 * numa pergunta de proporção, redução de 20% nas demais (o caso mais comum do
	 * pedido). Ao desligar, remove a chave inteira em vez de deixar
	 * `indicador: undefined` — o `config` vira JSON, e `undefined` sumiria de
	 * qualquer jeito na serialização, mas um objeto meio-apagado confundiria quem
	 * lesse o blob.
	 */
	function alternarIndicador(p: GiseModeloPerguntaConfig) {
		if (p.indicador) {
			delete p.indicador;
		} else if (ehProporcao(p.tipo)) {
			p.indicador = { metaTipo: 'proporcao', metaValor: 100 };
		} else {
			p.indicador = { objetivo: 'diminuir', metaTipo: 'percentual', metaValor: 20 };
		}
		perguntasConfig = [...perguntasConfig];
	}

	/**
	 * Troca o TIPO da meta, reconstruindo o objeto inteiro.
	 *
	 * Reconstrói, e não muta o campo: `proporcao` não tem `objetivo` nem
	 * `rotuloBase`, e um `bind:value` deixaria os dois pendurados no JSON gravado
	 * — campo morto que a próxima leitura interpreta como intenção. É a união
	 * discriminada de `IndicadorConfig` cobrando o que ela promete.
	 */
	function definirMetaTipoIndicador(p: GiseModeloPerguntaConfig, metaTipo: string) {
		const anterior = p.indicador;
		if (!anterior) return;
		const unidadeMedida = anterior.unidadeMedida;

		if (metaTipo === 'proporcao') {
			p.indicador = { metaTipo: 'proporcao', metaValor: 100, unidadeMedida };
		} else {
			p.indicador = {
				objetivo: anterior.metaTipo === 'proporcao' ? 'aumentar' : anterior.objetivo,
				metaTipo: metaTipo === 'absoluto' ? 'absoluto' : 'percentual',
				metaValor: anterior.metaValor,
				unidadeMedida,
				rotuloBase: anterior.metaTipo === 'proporcao' ? '' : anterior.rotuloBase
			};
		}
		perguntasConfig = [...perguntasConfig];
	}

	// --- Derived ---
	const configJson = $derived(JSON.stringify(perguntasConfig));

	/**
	 * O editor tem alteração que ainda não foi gravada?
	 *
	 * Compara o que está na tela com o modelo que o `load` trouxe. Depois de
	 * salvar, `invalidateShared` recarrega o `load` e os dois voltam a bater
	 * sozinhos — não há flag a limpar à mão.
	 *
	 * Existe porque o editor avisa que "nada é gravado até clicar em Salvar" e
	 * nada na tela tornava isso concreto: a barra de status tinha dois estados,
	 * "Salvando..." (que dura o tempo da requisição) e "Pronto para salvar", que
	 * era o `else` — dizia a mesma coisa tendo-se mexido em algo ou não.
	 *
	 * Comparação por JSON, com um falso positivo conhecido: ligar e desligar a
	 * mesma caixinha pode reordenar as chaves do objeto (`delete` + reatribuição
	 * põem a chave no fim), e o texto muda sem o conteúdo mudar. Erra para o lado
	 * de "salve" — que é o lado certo para errar num aviso — e um comparador
	 * profundo custaria mais do que vale.
	 */
	const alteracoesNaoSalvas = $derived(
		configJson !==
			JSON.stringify(configTipo === 'seint' ? data.modeloSeint : data.modeloOperacional)
	);

	// --- Funções de Navegação e Filtro ---
	function navigateWithFilters(params: Record<string, string | null>) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const navUrl = new URL(page.url);
		Object.entries(params).forEach(([key, value]) => {
			if (value) navUrl.searchParams.set(key, value);
			else navUrl.searchParams.delete(key);
		});
		goto(navUrl.pathname + navUrl.search, { keepFocus: true, noScroll: true });
	}

	// Mês e data são mutuamente exclusivos. Só navega — `mesFilterUrl`/
	// `dataFilterUrl` são derivados da URL e se reajustam sozinhos depois do
	// `goto`. O `?status` corrente é preservado por `navigateWithFilters`, então
	// filtrar por data não tira o usuário do histórico.
	function changeDateFilter(type: 'mes' | 'data', value: string) {
		if (type === 'mes') navigateWithFilters({ mes: value, data: null });
		else navigateWithFilters({ data: value, mes: null });
	}

	// Limpa só os filtros de data — mantém a aba (o `status` da URL). Antes zerava
	// `status` também, o que jogava o usuário do Histórico de volta para Ativas.
	function limparFiltros() {
		navigateWithFilters({ mes: null, data: null });
	}

	// --- Funções do Configurador ---
	function adicionarPergunta() {
		const id = Date.now();
		// Herda a etapa da última pergunta: a nova entra no FIM do formulário, que
		// é dentro da última etapa. Sem isso, cada pergunta nova abriria sozinha um
		// grupo "sem etapa" no fim — e o admin teria de redigitar o nome sempre.
		const etapa = perguntasConfig.at(-1)?.etapa;
		perguntasConfig = [
			...perguntasConfig,
			{
				id,
				texto: '',
				tipo: 'texto',
				obrigatoria: false,
				key: `extra_${id}`,
				...(etapa ? { etapa } : {}),
				filhos: []
			}
		];
	}

	function adicionarSubPergunta(pai: GiseModeloPerguntaConfig) {
		const id = Date.now();
		pai.filhos = [
			...(pai.filhos || []),
			{ id, texto: '', tipo: 'texto', obrigatoria: false, key: `extra_${id}`, filhos: [] }
		];
		perguntasConfig = [...perguntasConfig];
	}

	/**
	 * Move a pergunta de NÍVEL 0 de uma posição para outra e renumera os rótulos.
	 *
	 * A renumeração é o ponto: o badge do card sai de `indexOf` e se acerta
	 * sozinho, mas o número que o policial lê está DENTRO do texto ("4. Houve…")
	 * e nos sub-rótulos ("4.1 QUANTIDADE:"). Sem `renumerarPerguntas`, arrastar a
	 * 4 para o fim deixaria um "4." na posição 8.
	 */
	function moverPergunta(de: number, para: number) {
		const total = perguntasConfig.length;
		if (de === para || de < 0 || para < 0 || de >= total || para >= total) return;
		const lista = [...perguntasConfig];
		const [movida] = lista.splice(de, 1);
		lista.splice(para, 0, movida);
		perguntasConfig = renumerarPerguntas(lista);
	}

	function removerPergunta(id: number, lista = perguntasConfig) {
		const idx = lista.findIndex((p) => p.id === id);
		if (idx > -1) {
			lista.splice(idx, 1);
			// Renumera também aqui: remover a 4 e deixar 5,6,7… seria a mesma
			// inconsistência que o arraste corrige. Remoção de FILHO não mexe em
			// nada (a função só toca no primeiro segmento, que não mudou).
			perguntasConfig = renumerarPerguntas([...perguntasConfig]);
			return true;
		}
		for (const p of lista) {
			if (p.filhos && removerPergunta(id, p.filhos)) return true;
		}
		return false;
	}

	function handleSalvarModelo() {
		loading.show(`Salvando Modelo ${configTipo}...`);
		return async ({ result }: { result: ActionResult }) => {
			loading.hide();
			if (result.type === 'success') {
				toaster.success({ title: `Modelo ${configTipo} salvo com sucesso` });
				await invalidateShared('app:res-gise', 'app:papel-gise');
				reaplicarEscalaSelecionada();
			} else if (result.type === 'failure') {
				const d = result.data as Record<string, unknown> | undefined;
				toaster.error({ title: String(d?.error || 'Erro ao salvar modelo') });
			}
		};
	}

	// --- Funções de Escala ---
	async function selecionarEscala(escala: ResGiseEscalaSelecionavel) {
		const isSame =
			escalaSelecionada?.id === escala.id && escalaSelecionada?.equipe_id === escala.equipe_id;
		if (isSame) return;

		escalaSelecionada = escala;

		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const params = new URLSearchParams(page.url.searchParams);
		params.set('giseId', String(escala.id));
		if (escala.equipe_id) params.set('equipeId', String(escala.equipe_id));
		else params.delete('equipeId');

		await goto(`?${params}`, { keepFocus: true, noScroll: true });
	}

	/**
	 * Após qualquer invalidate de `app:res-gise`, `escalaSelecionada` ainda aponta
	 * para o objeto antigo. Reaplica a partir de `data.minhasEscalas`; se sumiu da
	 * lista (saída finalizada), opcionalmente carimba o timestamp local.
	 */
	function reaplicarEscalaSelecionada(tipoPresenca?: 'entrada' | 'saida') {
		const sel = escalaSelecionada;
		if (!sel) return;
		const atualizada = data.minhasEscalas?.find(
			(e) => e.id === sel.id && e.equipe_id === sel.equipe_id
		);
		if (atualizada) {
			escalaSelecionada = atualizada;
			return;
		}
		if (!tipoPresenca) return;
		const prev = 'presenca' in sel && sel.presenca ? sel.presenca : undefined;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const ts = new Date().toISOString();
		escalaSelecionada = {
			...sel,
			presenca: {
				...prev,
				...(tipoPresenca === 'entrada' ? { entrada_timestamp: ts } : { saida_timestamp: ts })
			} as GisePresenca
		} as ResGiseEscalaSelecionavel;
	}

	/**
	 * Re-sincroniza `escalaSelecionada` após uma confirmação de presença feita
	 * FORA do fluxo de `salvarEntrada`/`salvarSaida` — caso do Token A3 no
	 * desktop, em que o PainelAssinaturaToken posta direto na API. Sem isto, o
	 * container fica preso no objeto antigo e só muda de estado após reload.
	 */
	async function sincronizarPresencaAtual(tipo: 'entrada' | 'saida') {
		if (!escalaSelecionada) return;
		await invalidateShared('app:res-gise', 'app:papel-gise');
		reaplicarEscalaSelecionada(tipo);
	}

	async function salvarEntrada(payload: SignaturePadConfirmPayload) {
		const {
			rubrica,
			lat: latitude,
			lng: longitude,
			selfie: selfieBase64,
			codigoEmail,
			desafioId
		} = payload;
		if (!escalaSelecionada) return;
		const giseAlvoId = escalaSelecionada.id;
		loading.show('Confirmando Entrada...');
		try {
			const fd = new FormData();
			fd.set('giseId', String(giseAlvoId));
			fd.set('rubrica', rubrica);
			if (latitude !== undefined) fd.set('latitude', String(latitude));
			if (longitude !== undefined) fd.set('longitude', String(longitude));
			if (selfieBase64) fd.set('selfieBase64', selfieBase64);
			if (codigoEmail) fd.set('codigoEmail', codigoEmail);
			if (desafioId) fd.set('desafioId', desafioId);

			const result = await postPageAction('salvarEntrada', fd);
			if (result.type !== 'success') {
				throw new Error(erroDaAction(result, 'Erro ao salvar entrada'));
			}

			toaster.success({ title: 'Entrada confirmada com sucesso' });
			capturandoRubrica = false;
			await invalidateShared('app:res-gise', 'app:papel-gise');
			reaplicarEscalaSelecionada('entrada');
		} catch (e: unknown) {
			toaster.error({ title: 'Erro', description: messageFromUnknown(e) });
		} finally {
			loading.hide();
		}
	}

	// --- Getters / Utils ---
	const isHorarioLiberado = (escala: ResGiseEscalaSelecionavel, isAdminGeral: boolean) => {
		if (isAdminGeral) return true;
		if (!escala?.horarioPrevisto?.inicio) return true;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const agora = new Date();
		const [h, min] = escala.horarioPrevisto.inicio.split(':');
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const dataInicioPrevista = new Date(
			escala.data_inicio + 'T' + h.padStart(2, '0') + ':' + (min || '00') + ':00'
		);
		return agora >= dataInicioPrevista;
	};

	const isSaidaLiberada = (escala: ResGiseEscalaSelecionavel, isAdminGeral: boolean) => {
		if (isAdminGeral) return true;
		if (!escala?.horarioPrevisto?.fim) return true;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const agora = new Date();
		const [h, min] = escala.horarioPrevisto.fim.split(':');
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const dataFimPrevista = new Date(
			escala.data_inicio + 'T' + h.padStart(2, '0') + ':' + (min || '00') + ':00'
		);
		return agora >= dataFimPrevista;
	};

	async function salvarSaida(payload: SignaturePadConfirmPayload) {
		const {
			rubrica,
			lat: latitude,
			lng: longitude,
			selfie: selfieBase64,
			codigoEmail,
			desafioId
		} = payload;
		if (!escalaSelecionada) return;
		const giseAlvoIdSaida = escalaSelecionada.id;
		loading.show('Confirmando Saída...');
		try {
			const fd = new FormData();
			fd.set('giseId', String(giseAlvoIdSaida));
			fd.set('rubrica', rubrica);
			if (latitude !== undefined) fd.set('latitude', String(latitude));
			if (longitude !== undefined) fd.set('longitude', String(longitude));
			if (selfieBase64) fd.set('selfieBase64', selfieBase64);
			if (codigoEmail) fd.set('codigoEmail', codigoEmail);
			if (desafioId) fd.set('desafioId', desafioId);

			const result = await postPageAction('salvarSaida', fd);
			if (result.type !== 'success') {
				throw new Error(erroDaAction(result, 'Erro ao salvar saída'));
			}

			toaster.success({ title: 'Saída confirmada com sucesso' });
			capturandoRubrica = false;
			await invalidateShared('app:res-gise', 'app:papel-gise');
			// Saída costuma tirar a escala de `minhasEscalas`; o helper carimba
			// o timestamp local quando a linha some da lista.
			reaplicarEscalaSelecionada('saida');
		} catch (e: unknown) {
			toaster.error({ title: 'Erro', description: messageFromUnknown(e) });
		} finally {
			loading.hide();
		}
	}

	async function baixarRelatorio(escala: ResGiseEscalaSelecionavel) {
		idProdutividadeBaixando = escala.id;
		loading.show('Baixando Relatório de Produtividade...');
		try {
			const url = `/api/gise/${escala.id}/download?format=produtividade&seccionalId=${escala.seccional_id}&equipeType=${escala.equipe_tipo}`;
			const res = await apiFetchResponse(url);
			baixarBlob(
				await res.blob(),
				`relatorio_produtividade_${escala.seccional_nome}_${escala.data_inicio}.pdf`
			);
		} catch (e: unknown) {
			toaster.error({ title: 'Erro no Download', description: messageFromUnknown(e) });
		} finally {
			loading.hide();
			idProdutividadeBaixando = null;
		}
	}

	async function baixarRelatorioExtra(escala: ResGiseEscalaSelecionavel) {
		idExtraBaixando = escala.id;
		loading.show('Baixando Relatório Extraordinário...');
		try {
			const secId =
				escala.seccional_id === 0 && data.supervisaoExtraUnidadeId != null
					? data.supervisaoExtraUnidadeId
					: escala.seccional_id;
			const url = `/api/gise/${escala.id}/download?format=extraordinario&seccionalId=${secId}`;
			const res = await apiFetchResponse(url);
			baixarBlob(
				await res.blob(),
				`relatorio_extraordinario_${escala.seccional_nome}_${escala.data_inicio}.pdf`
			);
		} catch (e: unknown) {
			toaster.error({ title: 'Erro no Download', description: messageFromUnknown(e) });
		} finally {
			loading.hide();
			idExtraBaixando = null;
		}
	}

	/**
	 * Baixa o comprovante (Termo de Presença) da confirmação de entrada/saída do
	 * próprio policial. O servidor decide a fonte: PDF assinado no R2 (Token A3) ou
	 * geração sob demanda com selo institucional (confirmação em tela).
	 */
	async function baixarTermoPresenca(tipo: 'entrada' | 'saida') {
		const sel = escalaSelecionada;
		if (!sel) return;
		termoBaixando = tipo;
		loading.show('Baixando comprovante de presença...');
		try {
			const res = await apiFetchResponse(`/api/gise/${sel.id}/presenca/termo?tipo=${tipo}`);
			const nome = nomeArquivoContentDisposition(
				res.headers.get('Content-Disposition'),
				`comprovante_presenca_${tipo}_gise_${sel.id}.pdf`
			);
			baixarBlob(await res.blob(), nome);
		} catch (e: unknown) {
			toaster.error({ title: 'Erro no Download', description: messageFromUnknown(e) });
		} finally {
			loading.hide();
			termoBaixando = null;
		}
	}

	return {
		// Getters
		get configTipo() {
			return configTipo;
		},
		set configTipo(v) {
			configTipo = v;
		},
		get perguntasConfig() {
			return perguntasConfig;
		},
		set perguntasConfig(v) {
			perguntasConfig = v;
		},
		get escalaSelecionada() {
			return escalaSelecionada;
		},
		set escalaSelecionada(v) {
			escalaSelecionada = v;
		},
		/** Carimbo do 1º envio da resposta de produtividade (ou null) — vem do load. */
		get respostaEnviadaEm() {
			return data.respostaEnviadaEm ?? null;
		},
		/** Carimbo da última retificação da resposta de produtividade (ou null). */
		get respostaAtualizadaEm() {
			return data.respostaAtualizadaEm ?? null;
		},
		get capturandoRubrica() {
			return capturandoRubrica;
		},
		set capturandoRubrica(v) {
			capturandoRubrica = v;
		},
		get baixandoProdutividade() {
			return idProdutividadeBaixando;
		},
		get baixandoExtra() {
			return idExtraBaixando;
		},
		get baixandoTermo() {
			return termoBaixando;
		},

		// Derived
		get configJson() {
			return configJson;
		},
		/** Há edição na tela que ainda não foi gravada? Move o rodapé do editor. */
		get alteracoesNaoSalvas() {
			return alteracoesNaoSalvas;
		},
		/** Operações ativas, para o seletor do editor. */
		get operacoes() {
			return data.operacoes;
		},
		get operacaoSelecionada() {
			return operacaoSelecionada;
		},
		get operacaoSelecionadaId() {
			return data.operacaoSelecionadaId;
		},
		get tiposDisponiveis() {
			return tiposDisponiveis;
		},
		get statusFilterUrl() {
			return statusFilterUrl;
		},
		get mesFilterUrl() {
			return mesFilterUrl;
		},
		get dataFilterUrl() {
			return dataFilterUrl;
		},

		// Actions
		changeDateFilter,
		limparFiltros,
		adicionarPergunta,
		adicionarSubPergunta,
		moverPergunta,
		removerPergunta,
		trocarOperacao,
		alternarFormaGrafico,
		alternarIndicador,
		definirMetaTipoIndicador,
		handleSalvarModelo,
		selecionarEscala,
		salvarEntrada,
		salvarSaida,
		sincronizarPresencaAtual,
		baixarRelatorio,
		baixarRelatorioExtra,
		baixarTermoPresenca,
		fmtDate,
		isHorarioLiberado,
		isSaidaLiberada
	};
}
