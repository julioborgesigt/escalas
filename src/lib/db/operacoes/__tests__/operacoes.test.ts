/**
 * Camada de dados das operações contra SQLite REAL (todas as migrações
 * aplicadas) — e não contra um fake do query builder.
 *
 * É o que importa aqui: o que se testa é o índice único de
 * `operacao_linha_base` resolvendo o upsert, o `selectDistinct` que descobre as
 * unidades participantes por três caminhos diferentes, e o backfill da migração
 * 0048. Um fake testaria a FORMA da consulta, que é justamente o que pode mudar
 * sem o contrato mudar.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import type { DatabaseSync } from 'node:sqlite';
import {
	listarOperacoes,
	buscarOperacao,
	buscarOperacaoPorNome,
	buscarOperacaoDaEscala,
	criarOperacao,
	atualizarOperacao,
	definirAtivoOperacao,
	excluirOperacao,
	contarEscalasPorOperacao,
	clonarModelosFormulario,
	tiposEquipeDaOperacao,
	operacaoAceitaTipoEquipe,
	normalizarTiposEquipe,
	NOME_OPERACAO_PADRAO
} from '../crud';
import {
	listarLinhaBase,
	mapaLinhaBaseDaUnidade,
	upsertLinhaBase,
	unidadesParticipantesDaOperacao
} from '../linha-base';
import type { Database } from '../../core';

let sqlite: DatabaseSync;
let db: Database;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

/** Cria uma unidade e devolve o id — as unidades são pré-requisito de quase tudo. */
function novaUnidade(nome: string, tipo = 'delegacia', seccionalId: number | null = null): number {
	sqlite
		.prepare('INSERT INTO unidades (nome, tipo, seccional_id) VALUES (?, ?, ?)')
		.run(nome, tipo, seccionalId);
	return Number(
		(sqlite.prepare('SELECT id FROM unidades WHERE nome = ?').get(nome) as { id: number }).id
	);
}

/** Escala extra de uma operação, com uma seccional e (opcionalmente) um slot de unidade. */
function novaEscala(
	operacaoId: number | null,
	seccionalId: number,
	opts?: { unidadeOperacionalId?: number; slotUnidadeId?: number }
): number {
	sqlite
		.prepare('INSERT INTO gise_escalas (data_inicio, operacao_id) VALUES (?, ?)')
		.run('2026-08-15', operacaoId);
	const giseId = Number(
		(sqlite.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id
	);
	sqlite
		.prepare(
			'INSERT INTO gise_seccionais (gise_id, seccional_id, unidade_operacional_id) VALUES (?, ?, ?)'
		)
		.run(giseId, seccionalId, opts?.unidadeOperacionalId ?? null);
	const secId = Number(
		(sqlite.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id
	);
	if (opts?.slotUnidadeId) {
		sqlite
			.prepare('INSERT INTO gise_seccional_unidades (gise_seccional_id, unidade_id) VALUES (?, ?)')
			.run(secId, opts.slotUnidadeId);
	}
	return giseId;
}

describe('seed das migrações', () => {
	it('cria GISE e CRAJUBAR, ambas ativas', async () => {
		const nomes = (await listarOperacoes(db)).map((o) => o.nome);
		expect(nomes).toContain('GISE');
		expect(nomes).toContain('OPERAÇÃO CRAJUBAR');
	});

	it('semeia os cinco indicadores da CRAJUBAR nos dois tipos de equipe', () => {
		const linhas = sqlite
			.prepare(
				`SELECT tipo, config FROM gise_modelo_formulario
				 WHERE operacao_id = (SELECT id FROM operacoes WHERE nome = 'OPERAÇÃO CRAJUBAR')`
			)
			.all() as Array<{ tipo: string; config: string }>;

		expect(linhas.map((l) => l.tipo).sort()).toEqual(['operacional', 'seint']);
		for (const l of linhas) {
			const chaves = (JSON.parse(l.config) as Array<{ key: string; indicador?: unknown }>)
				.filter((q) => q.indicador)
				.map((q) => q.key);
			expect(chaves).toEqual([
				'crajubar_acervo_pendentes',
				'crajubar_cvli_concluidos',
				'crajubar_tempo_medio_conclusao',
				'crajubar_atendimentos_fds',
				'crajubar_orcrim_drco'
			]);
		}
	});

	it('o acervo de inquéritos nasce com a meta do plano: reduzir 20%', () => {
		const config = (
			sqlite
				.prepare(
					`SELECT config FROM gise_modelo_formulario
					 WHERE tipo = 'operacional'
					   AND operacao_id = (SELECT id FROM operacoes WHERE nome = 'OPERAÇÃO CRAJUBAR')`
				)
				.get() as { config: string }
		).config;
		const acervo = (
			JSON.parse(config) as Array<{
				key: string;
				indicador?: { objetivo: string; metaTipo: string; metaValor: number };
			}>
		).find((q) => q.key === 'crajubar_acervo_pendentes');

		expect(acervo?.indicador).toMatchObject({
			objetivo: 'diminuir',
			metaTipo: 'percentual',
			metaValor: 20
		});
	});

	it('a migração 0052 converte os atendimentos de fim de semana em COBERTURA', () => {
		// A 0050 semeou "no mínimo 1 atendimento" como proxy de "100% de cobertura
		// programada", porque não existia tipo capaz de guardar o denominador. A
		// 0052 troca as duas coisas — tipo de campo E tipo de meta — nos DOIS
		// modelos, senão a equipe SEINT continuaria medindo volume.
		const linhas = sqlite
			.prepare(
				`SELECT tipo, config FROM gise_modelo_formulario
				 WHERE operacao_id = (SELECT id FROM operacoes WHERE nome = 'OPERAÇÃO CRAJUBAR')`
			)
			.all() as Array<{ tipo: string; config: string }>;

		expect(linhas).toHaveLength(2);
		for (const l of linhas) {
			const fds = (
				JSON.parse(l.config) as Array<{
					key: string;
					tipo: string;
					subtexto_total?: string;
					subtexto_parte?: string;
					indicador?: Record<string, unknown>;
				}>
			).find((q) => q.key === 'crajubar_atendimentos_fds');

			expect(fds?.tipo).toBe('proporcao');
			expect(fds?.indicador).toEqual({
				metaTipo: 'proporcao',
				metaValor: 100,
				unidadeMedida: 'ocorrências'
			});
			// `objetivo` tem de SUMIR: cobrir 100% não é aumentar nem diminuir, e o
			// campo pendurado no JSON viraria intenção na próxima leitura.
			expect(fds?.indicador).not.toHaveProperty('objetivo');
			expect(fds?.subtexto_total).toBeTruthy();
			expect(fds?.subtexto_parte).toBeTruthy();
		}
	});

	it('a 0052 não mexe nos outros quatro indicadores', () => {
		const config = (
			sqlite
				.prepare(
					`SELECT config FROM gise_modelo_formulario
					 WHERE tipo = 'operacional'
					   AND operacao_id = (SELECT id FROM operacoes WHERE nome = 'OPERAÇÃO CRAJUBAR')`
				)
				.get() as { config: string }
		).config;
		const perguntas = JSON.parse(config) as Array<{ key: string; tipo: string }>;

		// `json_replace` num índice errado trocaria a pergunta vizinha em silêncio:
		// esta asserção é o que prova que o índice veio do `json_each` certo.
		for (const key of [
			'crajubar_acervo_pendentes',
			'crajubar_cvli_concluidos',
			'crajubar_tempo_medio_conclusao',
			'crajubar_orcrim_drco'
		]) {
			expect(perguntas.find((q) => q.key === key)?.tipo).toBe('numero');
		}
	});
});

describe('helpers de tipo de equipe', () => {
	it('lista os tipos habilitados', () => {
		expect(tiposEquipeDaOperacao({ usa_equipe_operacional: true, usa_equipe_seint: true })).toEqual(
			['operacional', 'seint']
		);
		expect(
			tiposEquipeDaOperacao({ usa_equipe_operacional: false, usa_equipe_seint: true })
		).toEqual(['seint']);
	});

	it('recusa tipo desabilitado e tipo desconhecido', () => {
		const edge = { usa_equipe_operacional: false, usa_equipe_seint: true };
		expect(operacaoAceitaTipoEquipe(edge, 'seint')).toBe(true);
		expect(operacaoAceitaTipoEquipe(edge, 'operacional')).toBe(false);
		expect(operacaoAceitaTipoEquipe(edge, 'inventado')).toBe(false);
	});

	it('normalizar recusa operação sem nenhum tipo, em vez de escolher um', () => {
		// Adivinhar um padrão criaria uma operação diferente da que o admin pediu.
		expect(normalizarTiposEquipe(false, false)).toBeNull();
		expect(normalizarTiposEquipe(false, true)).toEqual({
			usa_equipe_operacional: false,
			usa_equipe_seint: true
		});
	});
});

describe('CRUD de operações', () => {
	it('cria, busca por id e por nome', async () => {
		const id = await criarOperacao(db, {
			nome: 'OPERAÇÃO EDGE',
			sigla: 'EDGE',
			usaEquipeOperacional: false,
			usaEquipeSeint: true
		});
		const porId = await buscarOperacao(db, id);
		expect(porId?.nome).toBe('OPERAÇÃO EDGE');
		expect(porId?.usa_equipe_operacional).toBe(false);
		expect(porId?.usa_equipe_seint).toBe(true);
		expect((await buscarOperacaoPorNome(db, 'OPERAÇÃO EDGE'))?.id).toBe(id);
	});

	it('recusa nome duplicado — a coluna é UNIQUE', async () => {
		await expect(
			criarOperacao(db, { nome: 'GISE', usaEquipeOperacional: true, usaEquipeSeint: true })
		).rejects.toThrow();
	});

	it('devolve null para id e nome inexistentes', async () => {
		expect(await buscarOperacao(db, 9999)).toBeNull();
		expect(await buscarOperacaoPorNome(db, 'NÃO EXISTE')).toBeNull();
	});

	it('desativar tira da lista de ativas mas não some do cadastro', async () => {
		const id = await criarOperacao(db, {
			nome: 'ANTIGA',
			usaEquipeOperacional: true,
			usaEquipeSeint: true
		});
		await definirAtivoOperacao(db, id, false);

		expect((await listarOperacoes(db, { somenteAtivas: true })).map((o) => o.nome)).not.toContain(
			'ANTIGA'
		);
		expect((await listarOperacoes(db)).map((o) => o.nome)).toContain('ANTIGA');
	});

	it('atualizar escreve só os campos recebidos', async () => {
		const id = await criarOperacao(db, {
			nome: 'X',
			sigla: 'X',
			usaEquipeOperacional: true,
			usaEquipeSeint: true
		});
		await atualizarOperacao(db, id, { sigla: 'XYZ' });
		const op = await buscarOperacao(db, id);
		expect(op?.sigla).toBe('XYZ');
		expect(op?.nome).toBe('X');
	});
});

describe('excluirOperacao', () => {
	/** Quantos formulários a operação tem gravados — o que o DELETE tem de levar junto. */
	function modelosDe(operacaoId: number): number {
		return Number(
			(
				sqlite
					.prepare('SELECT count(*) AS c FROM gise_modelo_formulario WHERE operacao_id = ?')
					.get(operacaoId) as { c: number }
			).c
		);
	}

	/** Operação nova já com os dois formulários clonados da CRAJUBAR. */
	async function operacaoComFormulario(nome: string): Promise<number> {
		const cra = await buscarOperacaoPorNome(db, 'OPERAÇÃO CRAJUBAR');
		const id = await criarOperacao(db, {
			nome,
			usaEquipeOperacional: true,
			usaEquipeSeint: true
		});
		await clonarModelosFormulario(db, cra!.id, id, ['operacional', 'seint']);
		return id;
	}

	it('apaga a operação E os formulários dela', async () => {
		const id = await operacaoComFormulario('OPERAÇÃO TESTE');
		expect(modelosDe(id)).toBe(2);

		expect(await excluirOperacao(db, id)).toBe(true);

		expect(await buscarOperacao(db, id)).toBeNull();
		// Sem esta limpeza as linhas ficariam órfãs, ocupando o índice único
		// `(operacao_id, tipo)` com um id que não existe mais.
		expect(modelosDe(id)).toBe(0);
	});

	it('a linha de base cai junto, por cascade', async () => {
		const id = await operacaoComFormulario('OPERAÇÃO COM BASE');
		const unidade = novaUnidade('DELEGACIA DA OPERAÇÃO TESTE');
		await upsertLinhaBase(db, {
			operacaoId: id,
			unidadeId: unidade,
			indicadorKey: 'crajubar_acervo_pendentes',
			valor: 900
		});

		expect(await excluirOperacao(db, id)).toBe(true);

		const restantes = sqlite
			.prepare('SELECT count(*) AS c FROM operacao_linha_base WHERE operacao_id = ?')
			.get(id) as { c: number };
		expect(Number(restantes.c)).toBe(0);
		// A unidade não some: a FK dela é `restrict`, e a delegacia existe fora da
		// operação.
		expect(await buscarOperacao(db, id)).toBeNull();
		expect(
			Number(
				(
					sqlite.prepare('SELECT count(*) AS c FROM unidades WHERE id = ?').get(unidade) as {
						c: number;
					}
				).c
			)
		).toBe(1);
	});

	it('recusa quando há escala, e não apaga NADA', async () => {
		const id = await operacaoComFormulario('OPERAÇÃO COM ESCALA');
		const sec = novaUnidade('SECCIONAL DA EXCLUSÃO', 'seccional');
		novaEscala(id, sec);

		expect(await excluirOperacao(db, id)).toBe(false);

		// A recusa é total: nem a operação nem o formulário podem ter sido tocados,
		// senão uma exclusão barrada deixaria a operação sem formulário.
		expect((await buscarOperacao(db, id))?.nome).toBe('OPERAÇÃO COM ESCALA');
		expect(modelosDe(id)).toBe(2);
	});

	it('a contagem é feita AQUI — chamador que erra não passa', async () => {
		// A tela mostra o botão a partir de um número que pode ter envelhecido: se a
		// recusa dependesse do chamador, uma escala criada no meio seria ignorada.
		const gise = await buscarOperacaoPorNome(db, 'GISE');
		const sec = novaUnidade('SECCIONAL DO GISE', 'seccional');
		novaEscala(gise!.id, sec);

		expect(await excluirOperacao(db, gise!.id)).toBe(false);
		expect(await buscarOperacao(db, gise!.id)).not.toBeNull();
	});

	it('não encosta na operação vizinha', async () => {
		const alvo = await operacaoComFormulario('OPERAÇÃO A EXCLUIR');
		const vizinha = await operacaoComFormulario('OPERAÇÃO VIZINHA');
		const unidade = novaUnidade('DELEGACIA DA VIZINHA');
		await upsertLinhaBase(db, {
			operacaoId: vizinha,
			unidadeId: unidade,
			indicadorKey: 'crajubar_acervo_pendentes',
			valor: 42
		});

		expect(await excluirOperacao(db, alvo)).toBe(true);

		expect((await buscarOperacao(db, vizinha))?.nome).toBe('OPERAÇÃO VIZINHA');
		expect(modelosDe(vizinha)).toBe(2);
		expect(
			(await mapaLinhaBaseDaUnidade(db, vizinha, unidade)).get('crajubar_acervo_pendentes')
		).toBe(42);
	});
});

describe('escala × operação', () => {
	it('resolve a operação da escala', async () => {
		const gise = await buscarOperacaoPorNome(db, 'GISE');
		const sec = novaUnidade('1ª SECCIONAL', 'seccional');
		const giseId = novaEscala(gise!.id, sec);

		expect((await buscarOperacaoDaEscala(db, giseId))?.nome).toBe('GISE');
	});

	it('escala com operacao_id nulo cai no GISE — a operação que existia antes', async () => {
		// Cobre a linha inserida por uma versão antiga do código durante o deploy.
		const sec = novaUnidade('2ª SECCIONAL', 'seccional');
		const giseId = novaEscala(null, sec);

		expect((await buscarOperacaoDaEscala(db, giseId))?.nome).toBe(NOME_OPERACAO_PADRAO);
	});

	it('devolve null para escala inexistente', async () => {
		expect(await buscarOperacaoDaEscala(db, 4242)).toBeNull();
	});

	it('conta escalas por operação', async () => {
		const gise = await buscarOperacaoPorNome(db, 'GISE');
		const cra = await buscarOperacaoPorNome(db, 'OPERAÇÃO CRAJUBAR');
		const sec = novaUnidade('3ª SECCIONAL', 'seccional');
		novaEscala(gise!.id, sec);
		novaEscala(cra!.id, sec);
		novaEscala(cra!.id, sec);

		const contagem = await contarEscalasPorOperacao(db);
		expect(contagem.get(gise!.id)).toBe(1);
		expect(contagem.get(cra!.id)).toBe(2);
	});
});

describe('clonarModelosFormulario', () => {
	it('copia o config da origem nos tipos pedidos', async () => {
		const cra = await buscarOperacaoPorNome(db, 'OPERAÇÃO CRAJUBAR');
		const destino = await criarOperacao(db, {
			nome: 'CRAJUBAR II',
			usaEquipeOperacional: true,
			usaEquipeSeint: true
		});

		const clonados = await clonarModelosFormulario(db, cra!.id, destino, ['operacional', 'seint']);
		expect(clonados.sort()).toEqual(['operacional', 'seint']);

		const origem = sqlite
			.prepare(
				`SELECT config FROM gise_modelo_formulario WHERE operacao_id = ? AND tipo = 'operacional'`
			)
			.get(cra!.id) as { config: string };
		const copia = sqlite
			.prepare(
				`SELECT config FROM gise_modelo_formulario WHERE operacao_id = ? AND tipo = 'operacional'`
			)
			.get(destino) as { config: string };
		expect(copia.config).toBe(origem.config);
	});

	it('clona apenas os tipos que o destino habilita', async () => {
		const cra = await buscarOperacaoPorNome(db, 'OPERAÇÃO CRAJUBAR');
		const destino = await criarOperacao(db, {
			nome: 'SÓ INTELIGÊNCIA',
			usaEquipeOperacional: false,
			usaEquipeSeint: true
		});

		// Uma EDGE só de inteligência não deve herdar o formulário operacional.
		expect(await clonarModelosFormulario(db, cra!.id, destino, ['seint'])).toEqual(['seint']);
		const tipos = sqlite
			.prepare('SELECT tipo FROM gise_modelo_formulario WHERE operacao_id = ?')
			.all(destino) as Array<{ tipo: string }>;
		expect(tipos.map((t) => t.tipo)).toEqual(['seint']);
	});

	it('pula o tipo sem linha na origem, em vez de criar um formulário vazio', async () => {
		// Sem linha, a leitura cai no modelo padrão do código — ponto de partida
		// melhor que um formulário em branco.
		const gise = await buscarOperacaoPorNome(db, 'GISE');
		const destino = await criarOperacao(db, {
			nome: 'DERIVADA DO GISE',
			usaEquipeOperacional: true,
			usaEquipeSeint: true
		});

		expect(await clonarModelosFormulario(db, gise!.id, destino, ['operacional', 'seint'])).toEqual(
			[]
		);
		const linhas = sqlite
			.prepare('SELECT count(*) AS c FROM gise_modelo_formulario WHERE operacao_id = ?')
			.get(destino) as { c: number };
		expect(Number(linhas.c)).toBe(0);
	});

	it('lista de tipos vazia não escreve nada', async () => {
		const cra = await buscarOperacaoPorNome(db, 'OPERAÇÃO CRAJUBAR');
		const destino = await criarOperacao(db, {
			nome: 'VAZIA',
			usaEquipeOperacional: true,
			usaEquipeSeint: true
		});
		expect(await clonarModelosFormulario(db, cra!.id, destino, [])).toEqual([]);
	});
});

describe('linha de base', () => {
	it('grava e relê o valor', async () => {
		const cra = await buscarOperacaoPorNome(db, 'OPERAÇÃO CRAJUBAR');
		const crato = novaUnidade('DELEGACIA DO CRATO');

		await upsertLinhaBase(db, {
			operacaoId: cra!.id,
			unidadeId: crato,
			indicadorKey: 'crajubar_acervo_pendentes',
			valor: 1240,
			informadoPorNome: 'Fulano'
		});

		const mapa = await mapaLinhaBaseDaUnidade(db, cra!.id, crato);
		expect(mapa.get('crajubar_acervo_pendentes')).toBe(1240);
	});

	it('regravar ATUALIZA em vez de duplicar, e preserva o created_at', async () => {
		const cra = await buscarOperacaoPorNome(db, 'OPERAÇÃO CRAJUBAR');
		const barbalha = novaUnidade('DELEGACIA DE BARBALHA');
		const chave = { operacaoId: cra!.id, unidadeId: barbalha, indicadorKey: 'k' };

		await upsertLinhaBase(db, { ...chave, valor: 100, origem: 'formulario' });
		const antes = sqlite
			.prepare('SELECT created_at FROM operacao_linha_base WHERE unidade_id = ?')
			.get(barbalha) as { created_at: string };

		await upsertLinhaBase(db, { ...chave, valor: 250, origem: 'aba' });

		const linhas = await listarLinhaBase(db, cra!.id, [barbalha]);
		expect(linhas).toHaveLength(1);
		expect(linhas[0].valor).toBe(250);
		expect(linhas[0].origem).toBe('aba');
		// O carimbo de quando a base foi definida pela PRIMEIRA vez não anda.
		expect(linhas[0].created_at).toBe(antes.created_at);
	});

	it('aceita decimal — tempo médio de conclusão é medido em dias com fração', async () => {
		const cra = await buscarOperacaoPorNome(db, 'OPERAÇÃO CRAJUBAR');
		const u = novaUnidade('NHPP JUAZEIRO');
		await upsertLinhaBase(db, {
			operacaoId: cra!.id,
			unidadeId: u,
			indicadorKey: 'crajubar_tempo_medio_conclusao',
			valor: 187.5
		});
		expect(
			(await mapaLinhaBaseDaUnidade(db, cra!.id, u)).get('crajubar_tempo_medio_conclusao')
		).toBe(187.5);
	});

	it('unidades diferentes têm bases independentes para o mesmo indicador', async () => {
		const cra = await buscarOperacaoPorNome(db, 'OPERAÇÃO CRAJUBAR');
		const a = novaUnidade('UNIDADE A');
		const b = novaUnidade('UNIDADE B');
		await upsertLinhaBase(db, { operacaoId: cra!.id, unidadeId: a, indicadorKey: 'k', valor: 10 });
		await upsertLinhaBase(db, { operacaoId: cra!.id, unidadeId: b, indicadorKey: 'k', valor: 20 });

		expect((await mapaLinhaBaseDaUnidade(db, cra!.id, a)).get('k')).toBe(10);
		expect((await mapaLinhaBaseDaUnidade(db, cra!.id, b)).get('k')).toBe(20);
	});

	it('escopo vazio devolve [] sem consultar', async () => {
		const cra = await buscarOperacaoPorNome(db, 'OPERAÇÃO CRAJUBAR');
		expect(await listarLinhaBase(db, cra!.id, [])).toEqual([]);
	});
});

describe('unidadesParticipantesDaOperacao', () => {
	it('encontra a seccional, a unidade operacional E a unidade de SLOT', async () => {
		// (3) é o caminho por onde Crato e Barbalha entram na CRAJUBAR; ignorá-lo
		// deixaria de fora justamente as delegacias que o plano nomeia.
		const cra = await buscarOperacaoPorNome(db, 'OPERAÇÃO CRAJUBAR');
		const seccional = novaUnidade('2ª SECCIONAL DO CARIRI', 'seccional');
		const operacional = novaUnidade('NÚCLEO OPERACIONAL', 'delegacia', seccional);
		const slot = novaUnidade('DELEGACIA DO CRATO', 'delegacia', seccional);

		novaEscala(cra!.id, seccional, {
			unidadeOperacionalId: operacional,
			slotUnidadeId: slot
		});

		const nomes = (await unidadesParticipantesDaOperacao(db, cra!.id)).map((u) => u.nome);
		expect(nomes).toEqual(['2ª SECCIONAL DO CARIRI', 'DELEGACIA DO CRATO', 'NÚCLEO OPERACIONAL']);
	});

	it('não devolve unidade de OUTRA operação', async () => {
		const gise = await buscarOperacaoPorNome(db, 'GISE');
		const cra = await buscarOperacaoPorNome(db, 'OPERAÇÃO CRAJUBAR');
		const soDoGise = novaUnidade('SECCIONAL SÓ DO GISE', 'seccional');
		novaEscala(gise!.id, soDoGise);

		expect(await unidadesParticipantesDaOperacao(db, cra!.id)).toEqual([]);
		expect((await unidadesParticipantesDaOperacao(db, gise!.id)).map((u) => u.nome)).toEqual([
			'SECCIONAL SÓ DO GISE'
		]);
	});

	it('não repete a unidade que participa de várias escalas', async () => {
		const cra = await buscarOperacaoPorNome(db, 'OPERAÇÃO CRAJUBAR');
		const sec = novaUnidade('SECCIONAL REPETIDA', 'seccional');
		novaEscala(cra!.id, sec);
		novaEscala(cra!.id, sec);

		expect(await unidadesParticipantesDaOperacao(db, cra!.id)).toHaveLength(1);
	});
});
