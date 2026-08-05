/**
 * O que a trilha de `/escalas/[id]` passa a dizer — FLW-ESC-007.
 *
 * `actions-auditadas.test.ts` prova que as catorze actions registram. Aqui
 * ficam as duas propriedades que o achado pede do registro em si: que ele
 * identifique o ATOR e o ALVO, e que diga QUANTAS linhas a mutação atingiu.
 *
 * O número de itens não é enfeite. A mesma action serve para uma linha e para
 * trinta — `removerSelecionados` esvazia meio mês com um clique —, e um evento
 * que só diz "removeu policial da escala" não distingue a correção de um
 * horário do desmonte do plantão inteiro. É a diferença entre uma trilha que
 * responde perguntas e uma que só prova que alguém mexeu.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import { registrarMudancaEscala, nomeDoPolicial } from '../desfecho';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const ESCALA = 63001;
const POLICIAL = 63101;

const USUARIO = {
	id: 63999,
	nome: 'Admin da Delegacia',
	tipo: 'admin' as const,
	papel: null,
	primeiro_acesso: false
} as NonNullable<App.Locals['usuario']>;

function eventoFalso(): RequestEvent {
	return {
		request: { method: 'POST', headers: new Headers({ 'user-agent': 'vitest' }) },
		url: new URL(`http://localhost/escalas/${ESCALA}`),
		getClientAddress: () => '198.51.100.9',
		locals: { requestId: 'req-escala' },
		platform: { env: {} }
	} as unknown as RequestEvent;
}

interface LinhaAudit {
	acao: string;
	usuario_id: number | null;
	usuario_nome: string | null;
	entidade: string;
	entidade_id: number | null;
	alvo_tipo: string | null;
	alvo_id: number | null;
	alvo_nome: string | null;
	detalhes: string | null;
	metadados: string | null;
	dados_antes: string | null;
	rota: string | null;
	ip_address: string | null;
}

const trilha = () =>
	sqlite.prepare('SELECT * FROM audit_log ORDER BY seq').all() as unknown as LinhaAudit[];

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha)
		VALUES (${POLICIAL}, 'M63101', 'Fulano de Tal', 'OIP', 'DELEGACIA X', 'h');

		INSERT INTO escalas (id, titulo, tipo, lotacao, cidade, data_inicio, data_fim)
		VALUES (${ESCALA}, 'ESCALA DE PLANTÃO', 'plantao', 'DELEGACIA X', 'CIDADE X',
		        '2026-09-01', '2026-09-30');
	`);
});

describe('o evento identifica quem e quem', () => {
	it('ator, escala e alvo chegam na trilha', async () => {
		await registrarMudancaEscala(eventoFalso(), {
			db,
			escalaId: ESCALA,
			usuario: USUARIO,
			acao: 'remover_policial_escala',
			alvo: { tipo: 'policial', id: POLICIAL, nome: 'Fulano de Tal' },
			detalhes: 'Retirado do plantão de 2026-09-13',
			itens: 1
		});

		const [linha] = trilha();
		expect(linha.usuario_id, 'sem ator não há a quem atribuir').toBe(USUARIO.id);
		expect(linha.usuario_nome).toBe(USUARIO.nome);
		expect(linha.entidade).toBe('escala');
		expect(linha.entidade_id, 'a escala é a entidade — é por ela que se filtra').toBe(ESCALA);
		expect(linha.alvo_tipo).toBe('policial');
		expect(linha.alvo_id).toBe(POLICIAL);
		expect(linha.alvo_nome).toBe('Fulano de Tal');
		expect(linha.rota).toBe(`/escalas/${ESCALA}`);
	});

	it('uma mutação, exatamente um evento', async () => {
		await registrarMudancaEscala(eventoFalso(), {
			db,
			escalaId: ESCALA,
			usuario: USUARIO,
			acao: 'editar_escala',
			alvo: { tipo: 'escala', id: ESCALA },
			detalhes: 'dias alterados',
			itens: 4
		});
		expect(trilha()).toHaveLength(1);
	});
});

describe('quantas linhas mudaram', () => {
	it('o número de itens vai gravado, sempre', async () => {
		await registrarMudancaEscala(eventoFalso(), {
			db,
			escalaId: ESCALA,
			usuario: USUARIO,
			acao: 'remover_policial_escala',
			alvo: { tipo: 'escala', id: ESCALA },
			detalhes: 'Escala esvaziada',
			itens: 31
		});
		expect(JSON.parse(trilha()[0].metadados ?? '{}').itens).toBe(31);
	});

	it('os metadados da action convivem com ele', async () => {
		await registrarMudancaEscala(eventoFalso(), {
			db,
			escalaId: ESCALA,
			usuario: USUARIO,
			acao: 'adicionar_policial_escala',
			alvo: { tipo: 'policial', id: POLICIAL },
			detalhes: 'Escalado em 3 dias',
			itens: 3,
			metadados: { equipe: 'ALFA', recusadas_por_conflito: [{ data: '2026-09-05' }] }
		});

		const meta = JSON.parse(trilha()[0].metadados ?? '{}');
		expect(meta.itens).toBe(3);
		expect(meta.equipe).toBe('ALFA');
		// O que a tela avisou e o reload apagou: a trilha é onde volta a existir.
		expect(meta.recusadas_por_conflito).toHaveLength(1);
	});

	it('o estado anterior é preservado quando a action o informa', async () => {
		await registrarMudancaEscala(eventoFalso(), {
			db,
			escalaId: ESCALA,
			usuario: USUARIO,
			acao: 'editar_escala',
			alvo: { tipo: 'policial', id: POLICIAL },
			detalhes: 'plantão remanejado',
			itens: 1,
			dados_antes: { data_plantao: '2026-09-13', hora_entrada: '08:00' },
			dados_depois: { data_plantao: '2026-09-14', hora_entrada: '19:00' }
		});

		expect(JSON.parse(trilha()[0].dados_antes ?? '{}').data_plantao).toBe('2026-09-13');
	});
});

describe('nomeDoPolicial', () => {
	it('devolve o nome de quem existe', async () => {
		await expect(nomeDoPolicial(db, POLICIAL)).resolves.toBe('Fulano de Tal');
	});

	it('devolve null sem lançar para id inexistente', async () => {
		// Chamado no meio de uma action que já mutou: lançar aqui perderia o
		// evento de uma mudança que aconteceu.
		await expect(nomeDoPolicial(db, 999999)).resolves.toBeNull();
	});
});
