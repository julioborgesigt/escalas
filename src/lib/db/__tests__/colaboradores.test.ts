/**
 * Cadastro de colaboradores (migração 0082) e o que a terceira identidade NÃO
 * pode fazer antes de existir login para ela: uma sessão de tipo
 * `colaborador` tem de ser recusada pela validação — nunca virar "policial de
 * mesmo id".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import { bancoMigrado, drizzleSobre } from './sqlite-migrado';
import {
	criarColaborador,
	listarColaboradores,
	buscarColaborador,
	buscarColaboradorAtivoPorEmail,
	definirColaboradorAtivo,
	normalizarEmailColaborador
} from '../colaboradores';
import { validarSessao, validarSessaoComAceite } from '$lib/auth';
import { ehViolacaoUnique, mensagemComCausas } from '$lib/server/db-errors';

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

const SUPER = { id: 1, nome: 'Super Admin' };

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
});

describe('criarColaborador', () => {
	it('grava com e-mail normalizado, CPF preparado e sem devolver os campos sensíveis', async () => {
		const c = await criarColaborador(
			db,
			{
				nome: '  Ana Servidora ',
				email: ' Ana.Servidora@PC.CE.GOV.BR ',
				senhaHash: 'pbkdf2v3:hash',
				cpf: '529.982.247-25',
				vinculo: 'Empresa X',
				criadoPor: SUPER
			},
			undefined
		);
		expect(c).toMatchObject({
			nome: 'Ana Servidora',
			email: 'ana.servidora@pc.ce.gov.br',
			vinculo: 'Empresa X',
			primeiro_acesso: 1,
			ativo: 1,
			criado_por_id: 1,
			criado_por_nome: 'Super Admin'
		});
		expect(c).not.toHaveProperty('senha');
		expect(c).not.toHaveProperty('cpf');
		expect(c).not.toHaveProperty('cpf_index');

		// Sem chave configurada o CPF vai normalizado em texto (fail-open
		// documentado em `prepararCpfParaDB`); com chave, cifrado — o caminho é o
		// mesmo de `policiais`.
		const linha = sqlite.prepare('SELECT senha, cpf FROM colaboradores WHERE id = ?').get(c.id) as {
			senha: string;
			cpf: string;
		};
		expect(linha.senha).toBe('pbkdf2v3:hash');
		expect(linha.cpf).toBe('52998224725');
	});

	it('e-mail duplicado estoura o índice único nomeando a coluna', async () => {
		const dados = { nome: 'A', email: 'a@x.br', senhaHash: 'h', criadoPor: SUPER };
		await criarColaborador(db, dados, undefined);
		// O drizzle embrulha o erro do driver; é `mensagemComCausas` que a rota lê
		// para decidir o 409 — o teste mede o mesmo caminho.
		const erro = await criarColaborador(
			db,
			{ ...dados, nome: 'B', email: 'A@X.BR' },
			undefined
		).then(
			() => null,
			(e: unknown) => e
		);
		expect(ehViolacaoUnique(erro)).toBe(true);
		expect(mensagemComCausas(erro)).toMatch(/colaboradores\.email/);
	});
});

describe('busca e listagem', () => {
	it('por e-mail ignora caixa e espaços, e só devolve ativo', async () => {
		const c = await criarColaborador(
			db,
			{ nome: 'A', email: 'a@x.br', senhaHash: 'h', criadoPor: SUPER },
			undefined
		);
		expect((await buscarColaboradorAtivoPorEmail(db, '  A@X.br '))?.id).toBe(c.id);
		await definirColaboradorAtivo(db, c.id, false);
		expect(await buscarColaboradorAtivoPorEmail(db, 'a@x.br')).toBeNull();
		// A gestão continua vendo a conta desativada.
		expect((await buscarColaborador(db, c.id))?.ativo).toBe(0);
		expect(await listarColaboradores(db)).toHaveLength(1);
	});

	it('normalizarEmailColaborador é a mesma regra do cadastro e do login', () => {
		expect(normalizarEmailColaborador(' Ana@X.Br ')).toBe('ana@x.br');
	});
});

describe('desativar', () => {
	it('apaga as sessões DA CONTA, e só as de tipo colaborador', async () => {
		const c = await criarColaborador(
			db,
			{ nome: 'A', email: 'a@x.br', senhaHash: 'h', criadoPor: SUPER },
			undefined
		);
		sqlite.exec(`
			INSERT INTO sessoes (token, tipo, usuario_id, expires_at) VALUES
			  ('t1', 'colaborador', ${c.id}, '2099-01-01T00:00:00.000Z'),
			  ('t2', 'policial', ${c.id}, '2099-01-01T00:00:00.000Z'),
			  ('t3', 'colaborador', ${c.id + 1}, '2099-01-01T00:00:00.000Z');
		`);
		expect(await definirColaboradorAtivo(db, c.id, false)).toBe(true);
		const restantes = (
			sqlite.prepare('SELECT token FROM sessoes ORDER BY token').all() as { token: string }[]
		).map((s) => s.token);
		expect(restantes).toEqual(['t2', 't3']);
		expect(await definirColaboradorAtivo(db, 999, false)).toBe(false);
	});
});

describe('sessão de colaborador antes de existir login', () => {
	it('é recusada pela validação, mesmo havendo policial com o mesmo id', async () => {
		sqlite.exec(`
			INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, ativo)
			VALUES (42, 'M42', 'Policial 42', 'OIP', 'X', 'h', 1);
			INSERT INTO sessoes (token, tipo, usuario_id, expires_at)
			VALUES ('sha256:tok-col', 'colaborador', 42, '2099-01-01T00:00:00.000Z'),
			       ('sha256:tok-pol', 'policial', 42, '2099-01-01T00:00:00.000Z');
		`);
		// O token em claro que produz o hash acima não importa aqui: o fallback
		// legado aceita a linha cujo `token` é igual ao valor recebido.
		sqlite.exec(`UPDATE sessoes SET token = 'tok-col' WHERE token = 'sha256:tok-col'`);
		sqlite.exec(`UPDATE sessoes SET token = 'tok-pol' WHERE token = 'sha256:tok-pol'`);

		expect(await validarSessao(db, 'tok-col')).toBeNull();
		expect((await validarSessao(db, 'tok-pol'))?.nome).toBe('Policial 42');

		const termo = { versao: '2.0', hash: 'abc' };
		expect((await validarSessaoComAceite(db, 'tok-col', undefined, termo)).usuario).toBeNull();
		expect((await validarSessaoComAceite(db, 'tok-pol', undefined, termo)).usuario?.nome).toBe(
			'Policial 42'
		);
	});
});
