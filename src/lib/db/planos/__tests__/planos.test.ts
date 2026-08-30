/**
 * Camada de dados do plano operacional contra SQLite REAL, com todas as
 * migrações aplicadas — não contra um fake do query builder.
 *
 * É o que importa aqui: o que se testa É o SQL. A numeração por ano acontece
 * dentro do INSERT; a exclusividade do servidor e a unicidade do chefe são
 * índices; o CASCADE é do banco. Um fake do drizzle testaria a FORMA da
 * consulta — exatamente o que pode mudar sem o contrato mudar.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import type { DatabaseSync } from 'node:sqlite';
import {
	criarPlano,
	buscarPlano,
	buscarPlanoPorNumero,
	listarPlanos,
	atualizarPlano,
	excluirPlano
} from '../crud';
import {
	criarEquipes,
	listarEquipes,
	atualizarEquipe,
	excluirEquipe,
	renumerarEquipes,
	nomePadraoEquipe,
	janelaDaEquipe,
	briefingDaEquipe
} from '../equipes';
import {
	adicionarMembro,
	removerMembro,
	definirChefe,
	limparChefe,
	listarMembrosDoPlano,
	agruparPorEquipe,
	ressincronizarSnapshots
} from '../membros';
import {
	criarCustoParametros,
	buscarCustoParametrosVigente,
	listarCustoParametros,
	valoresDe
} from '../custo-parametros';
import { sugerirPlus } from '$lib/planos/custo';
import type { Database } from '../../core';

let sqlite: DatabaseSync;
let db: Database;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

/** Um policial de teste; devolve o id. */
function novoPolicial(nome: string, cargo = 'OIP', classe = 'C'): number {
	sqlite
		.prepare(
			`INSERT INTO policiais (nome, matricula, cargo, lotacao, classe, senha, telefone)
			 VALUES (?, ?, ?, '4a Seccional', ?, 'x', '85 99999-0000')`
		)
		.run(nome, `M${nome.replace(/\W/g, '')}`, cargo, classe);
	return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get()!.id);
}

/** Um plano mínimo; devolve o id. */
async function novoPlano(over: Partial<Parameters<typeof criarPlano>[1]> = {}) {
	return criarPlano(db, {
		nome: 'CUMPRIMENTO DE MANDADOS',
		data_inicio: '2026-09-29',
		hora_inicio: '05:00',
		hora_fim: '11:00',
		...over
	});
}

describe('numeração do plano', () => {
	it('começa em 1 e incrementa dentro do ano', async () => {
		expect((await novoPlano()).numero).toBe(1);
		expect((await novoPlano({ nome: 'B' })).numero).toBe(2);
		expect((await novoPlano({ nome: 'C' })).numero).toBe(3);
	});

	it('reinicia a cada ano, e o ano vem da DATA DA OPERAÇÃO', async () => {
		await novoPlano();
		await novoPlano({ nome: 'B' });
		// Plano montado agora para uma operação de janeiro é 01/2027, não 03/2026:
		// é a data da operação que o documento carrega na capa.
		const jan = await novoPlano({ nome: 'JANEIRO', data_inicio: '2027-01-05' });
		expect(jan).toMatchObject({ numero: 1, ano: 2027 });
	});

	it('o par (ano, numero) é único no banco', async () => {
		const { ano, numero } = await novoPlano();
		expect(() =>
			sqlite
				.prepare(
					`INSERT INTO planos_operacionais (numero, ano, nome, data_inicio) VALUES (?, ?, 'DUPLICADO', '2026-09-29')`
				)
				.run(numero, ano)
		).toThrow(/UNIQUE/i);
	});

	it('buscarPlanoPorNumero acha o plano como o documento o identifica', async () => {
		const { id } = await novoPlano();
		const achado = await buscarPlanoPorNumero(db, 2026, 1);
		expect(achado?.id).toBe(id);
		expect(await buscarPlanoPorNumero(db, 2026, 99)).toBeNull();
	});

	it('a lacuna deixada por uma exclusão NÃO é reaproveitada', async () => {
		// O número já circulou impresso; reusá-lo criaria dois documentos "02/2026".
		await novoPlano();
		const b = await novoPlano({ nome: 'B' });
		await excluirPlano(db, b.id);
		expect((await novoPlano({ nome: 'C' })).numero).toBe(2);
	});
});

describe('CRUD do plano', () => {
	it('grava e lê os campos do documento', async () => {
		const { id } = await novoPlano({
			nup: '2026.01.00123',
			finalidade: 'Cumprimento de mandados judiciais...',
			acoes: '- Cumprimento de Mandados;\n- Lavratura de APF;',
			diretor_nome: 'CRISTIANO DE MORAIS PEREIRA',
			diretor_cargo: 'Diretor Titular do Departamento de Polícia do Interior Sul',
			feriado: true
		});
		const p = await buscarPlano(db, id);
		expect(p).toMatchObject({
			nup: '2026.01.00123',
			diretor_nome: 'CRISTIANO DE MORAIS PEREIRA',
			feriado: true,
			departamento: 'DPI SUL',
			status: 'rascunho'
		});
	});

	it('atualizarPlano toca só as chaves presentes', async () => {
		const { id } = await novoPlano({ nome: 'ORIGINAL', nup: '123' });
		await atualizarPlano(db, id, { nome: 'RENOMEADO' });
		const p = await buscarPlano(db, id);
		expect(p?.nome).toBe('RENOMEADO');
		expect(p?.nup).toBe('123'); // não foi tocado
	});

	it('passar null APAGA um campo anulável', async () => {
		const { id } = await novoPlano({ nup: '123' });
		await atualizarPlano(db, id, { nup: null });
		expect((await buscarPlano(db, id))?.nup).toBeNull();
	});

	it('atualizar e excluir id inexistente devolvem false, não sucesso falso', async () => {
		expect(await atualizarPlano(db, 999, { nome: 'X' })).toBe(false);
		expect(await excluirPlano(db, 999)).toBe(false);
	});

	it('listarPlanos ordena pela data da operação e conta as equipes', async () => {
		const a = await novoPlano({ nome: 'ANTIGO', data_inicio: '2026-01-10' });
		const b = await novoPlano({ nome: 'RECENTE', data_inicio: '2026-12-20' });
		await criarEquipes(db, a.id, { quantidade: 3 });
		const lista = await listarPlanos(db);
		expect(lista.map((p) => p.nome)).toEqual(['RECENTE', 'ANTIGO']);
		expect(lista.find((p) => p.id === a.id)?.equipes).toBe(3);
		expect(lista.find((p) => p.id === b.id)?.equipes).toBe(0);
	});
});

describe('equipes', () => {
	it('nascem numeradas em sequência, com a SEINT nomeada pelo que é', async () => {
		const { id } = await novoPlano();
		await criarEquipes(db, id, { quantidade: 3, comSeint: true });
		const eqs = await listarEquipes(db, id);
		expect(eqs.map((e) => e.nome)).toEqual(['Equipe 01', 'Equipe 02', 'Equipe 03', 'Equipe SEINT']);
		expect(eqs.map((e) => e.tipo)).toEqual(['operacional', 'operacional', 'operacional', 'seint']);
	});

	it('nomePadraoEquipe zera à esquerda para ordenar como texto', () => {
		expect(nomePadraoEquipe(1)).toBe('Equipe 01');
		expect(nomePadraoEquipe(10)).toBe('Equipe 10');
	});

	it('acrescentar equipe continua de onde a última parou', async () => {
		const { id } = await novoPlano();
		await criarEquipes(db, id, { quantidade: 2 });
		await criarEquipes(db, id, { quantidade: 1 });
		expect((await listarEquipes(db, id)).map((e) => e.ordem)).toEqual([1, 2, 3]);
	});

	it('renumerar fecha a lacuna da exclusão SEM renomear', async () => {
		const { id } = await novoPlano();
		await criarEquipes(db, id, { quantidade: 3 });
		const eqs = await listarEquipes(db, id);
		await excluirEquipe(db, eqs[1].id);
		await renumerarEquipes(db, id);
		const depois = await listarEquipes(db, id);
		expect(depois.map((e) => e.ordem)).toEqual([1, 2]);
		// O nome NÃO acompanha: "Equipe 03" já pode ter saído num rascunho baixado.
		expect(depois.map((e) => e.nome)).toEqual(['Equipe 01', 'Equipe 03']);
	});

	it('excluir a equipe leva os membros junto (CASCADE)', async () => {
		const { id } = await novoPlano();
		const [eq1] = await criarEquipes(db, id, { quantidade: 1 });
		await adicionarMembro(db, eq1, novoPolicial('FULANO'));
		expect(await listarMembrosDoPlano(db, id)).toHaveLength(1);
		await excluirEquipe(db, eq1);
		expect(await listarMembrosDoPlano(db, id)).toHaveLength(0);
	});

	it('excluir o plano leva equipes e membros (CASCADE)', async () => {
		const { id } = await novoPlano();
		const [eq1] = await criarEquipes(db, id, { quantidade: 1 });
		await adicionarMembro(db, eq1, novoPolicial('FULANO'));
		await excluirPlano(db, id);
		expect(await listarEquipes(db, id)).toHaveLength(0);
		expect(sqlite.prepare('SELECT COUNT(*) AS n FROM plano_equipe_membros').get()!.n).toBe(0);
	});
});

describe('cascata equipe → plano', () => {
	const plano = {
		data_inicio: '2026-09-29',
		hora_inicio: '05:00',
		data_fim: null,
		hora_fim: '11:00',
		feriado: false,
		local_briefing_padrao: 'Sede da 4ª Seccional'
	};

	it('equipe sem horário próprio herda o do plano', () => {
		expect(janelaDaEquipe({ data_inicio: null, hora_inicio: null, hora_fim: null }, plano)).toEqual(
			{
				dataInicio: '2026-09-29',
				horaInicio: '05:00',
				dataFim: '2026-09-29',
				horaFim: '11:00',
				feriado: false
			}
		);
	});

	it('equipe que desloca antes usa o horário DELA', () => {
		// É o caso que motivou a coluna: a equipe sai antes do horário do plano.
		const j = janelaDaEquipe({ data_inicio: null, hora_inicio: '03:00', hora_fim: null }, plano);
		expect(j.horaInicio).toBe('03:00');
		expect(j.horaFim).toBe('11:00'); // o resto continua herdado
	});

	it('briefing próprio vence o padrão; vazio e espaço em branco herdam', () => {
		expect(briefingDaEquipe({ local_briefing: 'Delegacia de Iguatu' }, plano)).toBe(
			'Delegacia de Iguatu'
		);
		expect(briefingDaEquipe({ local_briefing: null }, plano)).toBe('Sede da 4ª Seccional');
		expect(briefingDaEquipe({ local_briefing: '   ' }, plano)).toBe('Sede da 4ª Seccional');
	});
});

describe('membros', () => {
	it('congela cargo e classe na alocação, e mantém o resto vivo', async () => {
		const { id } = await novoPlano();
		const [eq1] = await criarEquipes(db, id, { quantidade: 1 });
		const pol = novoPolicial('FRANCISCO ALEX', 'OIP', 'C');
		await adicionarMembro(db, eq1, pol);

		// Promoção depois da alocação.
		sqlite
			.prepare('UPDATE policiais SET classe = ?, nome = ? WHERE id = ?')
			.run('A', 'F. ALEX', pol);

		const [m] = await listarMembrosDoPlano(db, id);
		expect(m.classe_snapshot).toBe('C'); // base de cálculo congelada
		expect(m.classe_atual).toBe('A'); // o cadastro seguiu em frente
		expect(m.nome).toBe('F. ALEX'); // identificação vem viva
	});

	it('o mesmo servidor não entra duas vezes no MESMO plano', async () => {
		const { id } = await novoPlano();
		const [eq1, eq2] = await criarEquipes(db, id, { quantidade: 2 });
		const pol = novoPolicial('FULANO');
		expect(await adicionarMembro(db, eq1, pol)).toMatchObject({ ok: true });
		expect(await adicionarMembro(db, eq2, pol)).toEqual({ ok: false, motivo: 'ja_no_plano' });
	});

	it('o mesmo servidor entra em planos DIFERENTES', async () => {
		const a = await novoPlano();
		const b = await novoPlano({ nome: 'OUTRA' });
		const [eqA] = await criarEquipes(db, a.id, { quantidade: 1 });
		const [eqB] = await criarEquipes(db, b.id, { quantidade: 1 });
		const pol = novoPolicial('FULANO');
		expect(await adicionarMembro(db, eqA, pol)).toMatchObject({ ok: true });
		expect(await adicionarMembro(db, eqB, pol)).toMatchObject({ ok: true });
	});

	it('recusa equipe e policial inexistentes com motivo distinto', async () => {
		const { id } = await novoPlano();
		const [eq1] = await criarEquipes(db, id, { quantidade: 1 });
		expect(await adicionarMembro(db, 9999, novoPolicial('X'))).toEqual({
			ok: false,
			motivo: 'equipe_inexistente'
		});
		expect(await adicionarMembro(db, eq1, 9999)).toEqual({
			ok: false,
			motivo: 'policial_inexistente'
		});
	});

	it('remover devolve false quando o membro não existe', async () => {
		expect(await removerMembro(db, 999)).toBe(false);
	});
});

describe('chefia', () => {
	it('designar o segundo chefe tira a chefia do primeiro', async () => {
		const { id } = await novoPlano();
		const [eq1] = await criarEquipes(db, id, { quantidade: 1 });
		const r1 = await adicionarMembro(db, eq1, novoPolicial('UM'));
		const r2 = await adicionarMembro(db, eq1, novoPolicial('DOIS'));
		if (!r1.ok || !r2.ok) throw new Error('setup');

		expect(await definirChefe(db, eq1, r1.id)).toBe(true);
		expect(await definirChefe(db, eq1, r2.id)).toBe(true);

		const membros = await listarMembrosDoPlano(db, id);
		expect(membros.filter((m) => m.chefe).map((m) => m.id)).toEqual([r2.id]);
	});

	it('membro de OUTRA equipe não vira chefe desta', async () => {
		// O id vem do formulário: sem a conferência, um POST direto marcaria como
		// chefe alguém que a equipe nem tem.
		const { id } = await novoPlano();
		const [eq1, eq2] = await criarEquipes(db, id, { quantidade: 2 });
		const r = await adicionarMembro(db, eq2, novoPolicial('DE OUTRA'));
		if (!r.ok) throw new Error('setup');
		expect(await definirChefe(db, eq1, r.id)).toBe(false);
	});

	it('cada equipe tem o seu próprio chefe', async () => {
		const { id } = await novoPlano();
		const [eq1, eq2] = await criarEquipes(db, id, { quantidade: 2 });
		const a = await adicionarMembro(db, eq1, novoPolicial('A'));
		const b = await adicionarMembro(db, eq2, novoPolicial('B'));
		if (!a.ok || !b.ok) throw new Error('setup');
		expect(await definirChefe(db, eq1, a.id)).toBe(true);
		expect(await definirChefe(db, eq2, b.id)).toBe(true);
		expect((await listarMembrosDoPlano(db, id)).filter((m) => m.chefe)).toHaveLength(2);
	});

	it('remover o chefe não deixa ponteiro pendurado', async () => {
		// É a razão de a chefia ser flag na linha do membro, e não um id na equipe.
		const { id } = await novoPlano();
		const [eq1] = await criarEquipes(db, id, { quantidade: 1 });
		const r = await adicionarMembro(db, eq1, novoPolicial('CHEFE'));
		if (!r.ok) throw new Error('setup');
		await definirChefe(db, eq1, r.id);
		await removerMembro(db, r.id);
		expect(await listarMembrosDoPlano(db, id)).toHaveLength(0);
		// E a equipe aceita um chefe novo sem colidir com o índice parcial.
		const novo = await adicionarMembro(db, eq1, novoPolicial('NOVO'));
		if (!novo.ok) throw new Error('setup');
		expect(await definirChefe(db, eq1, novo.id)).toBe(true);
	});

	it('limparChefe deixa a equipe sem chefia', async () => {
		const { id } = await novoPlano();
		const [eq1] = await criarEquipes(db, id, { quantidade: 1 });
		const r = await adicionarMembro(db, eq1, novoPolicial('A'));
		if (!r.ok) throw new Error('setup');
		await definirChefe(db, eq1, r.id);
		await limparChefe(db, eq1);
		expect((await listarMembrosDoPlano(db, id)).some((m) => m.chefe)).toBe(false);
	});

	it('o chefe vem primeiro na listagem, como o documento o apresenta', async () => {
		const { id } = await novoPlano();
		const [eq1] = await criarEquipes(db, id, { quantidade: 1 });
		await adicionarMembro(db, eq1, novoPolicial('AAA PRIMEIRO ALFABETICO'));
		const r = await adicionarMembro(db, eq1, novoPolicial('ZZZ ULTIMO ALFABETICO'));
		if (!r.ok) throw new Error('setup');
		await definirChefe(db, eq1, r.id);
		const membros = await listarMembrosDoPlano(db, id);
		expect(membros[0].nome).toBe('ZZZ ULTIMO ALFABETICO');
	});
});

describe('agruparPorEquipe', () => {
	it('separa por equipe preservando a ordem', async () => {
		const { id } = await novoPlano();
		const [eq1, eq2] = await criarEquipes(db, id, { quantidade: 2 });
		await adicionarMembro(db, eq1, novoPolicial('A'));
		await adicionarMembro(db, eq1, novoPolicial('B'));
		await adicionarMembro(db, eq2, novoPolicial('C'));
		const mapa = agruparPorEquipe(await listarMembrosDoPlano(db, id));
		expect(mapa.get(eq1)).toHaveLength(2);
		expect(mapa.get(eq2)).toHaveLength(1);
	});
});

describe('ressincronizarSnapshots', () => {
	it('reaplica o cadastro atual — a saída para quem foi alocado sem classe', async () => {
		const { id } = await novoPlano();
		const [eq1] = await criarEquipes(db, id, { quantidade: 1 });
		const pol = novoPolicial('SEM CLASSE', 'OIP', '');
		await adicionarMembro(db, eq1, pol);
		expect((await listarMembrosDoPlano(db, id))[0].classe_snapshot).toBe('');

		// Alguém corrige o cadastro; sem o botão, o plano continuaria bloqueado.
		sqlite.prepare('UPDATE policiais SET classe = ? WHERE id = ?').run('B', pol);
		expect(await ressincronizarSnapshots(db, id)).toBe(1);
		expect((await listarMembrosDoPlano(db, id))[0].classe_snapshot).toBe('B');
	});

	it('não alcança membros de OUTRO plano', async () => {
		const a = await novoPlano();
		const b = await novoPlano({ nome: 'OUTRA' });
		const [eqA] = await criarEquipes(db, a.id, { quantidade: 1 });
		const [eqB] = await criarEquipes(db, b.id, { quantidade: 1 });
		const p1 = novoPolicial('UM', 'OIP', 'C');
		const p2 = novoPolicial('DOIS', 'OIP', 'C');
		await adicionarMembro(db, eqA, p1);
		await adicionarMembro(db, eqB, p2);
		sqlite.prepare("UPDATE policiais SET classe = 'A'").run();

		await ressincronizarSnapshots(db, a.id);
		expect((await listarMembrosDoPlano(db, a.id))[0].classe_snapshot).toBe('A');
		expect((await listarMembrosDoPlano(db, b.id))[0].classe_snapshot).toBe('C');
	});
});

describe('custo_parametros', () => {
	const VALORES = {
		oip_cd_normal: 2730,
		oip_ab_normal: 3413,
		dpc_12_normal: 5000,
		dpc_3e_normal: 6000,
		oip_cd_plus: 3549,
		oip_ab_plus: 4437,
		dpc_12_plus: 6500,
		dpc_3e_plus: 7800,
		diaria_estadual: 35000,
		diaria_interestadual: 60000
	};

	it('sem gravação nenhuma, a vigente é null — estado real do sistema novo', async () => {
		expect(await buscarCustoParametrosVigente(db)).toBeNull();
	});

	it('a vigente é a de maior vigência', async () => {
		await criarCustoParametros(db, { ...VALORES, vigente_desde: '2026-01-01' });
		const nova = await criarCustoParametros(db, {
			...VALORES,
			oip_cd_normal: 9999,
			vigente_desde: '2026-06-01'
		});
		expect((await buscarCustoParametrosVigente(db))?.id).toBe(nova);
	});

	it('duas gravações no MESMO dia: o id desempata', async () => {
		// O caso da correção logo após um erro de digitação.
		await criarCustoParametros(db, { ...VALORES, vigente_desde: '2026-06-01' });
		const correcao = await criarCustoParametros(db, {
			...VALORES,
			oip_cd_normal: 2800,
			vigente_desde: '2026-06-01'
		});
		const vigente = await buscarCustoParametrosVigente(db);
		expect(vigente?.id).toBe(correcao);
		expect(vigente?.oip_cd_normal).toBe(2800);
	});

	it('gravar não sobrescreve: o histórico guarda as duas', async () => {
		await criarCustoParametros(db, { ...VALORES, vigente_desde: '2026-01-01' });
		await criarCustoParametros(db, { ...VALORES, vigente_desde: '2026-06-01' });
		const hist = await listarCustoParametros(db);
		expect(hist).toHaveLength(2);
		expect(hist[0].vigente_desde).toBe('2026-06-01'); // mais recente primeiro
	});

	it('o plano guarda a versão que aplicou, e ela não pode ser apagada por baixo dele', async () => {
		const versao = await criarCustoParametros(db, { ...VALORES, vigente_desde: '2026-01-01' });
		await novoPlano({ custo_parametro_id: versao });
		// RESTRICT: o total impresso tem de continuar reproduzível.
		expect(() => sqlite.prepare('DELETE FROM custo_parametros WHERE id = ?').run(versao)).toThrow(
			/FOREIGN KEY/i
		);
	});

	it('valoresDe entrega só os dez valores ao cálculo', async () => {
		const id = await criarCustoParametros(db, {
			...VALORES,
			vigente_desde: '2026-01-01',
			criado_por_nome: 'ADMIN'
		});
		const p = (await listarCustoParametros(db)).find((x) => x.id === id)!;
		expect(valoresDe(p)).toEqual(VALORES);
		expect(Object.keys(valoresDe(p))).not.toContain('vigente_desde');
	});

	it('sugerirPlus acrescenta 30% e arredonda para centavo inteiro', () => {
		expect(sugerirPlus(2730)).toBe(3549);
		expect(sugerirPlus(3413)).toBe(4437);
		expect(Number.isInteger(sugerirPlus(3333))).toBe(true);
	});
});
