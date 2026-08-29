/**
 * O portão de quem ASSINA o relatório extraordinário —
 * `carregarRelatorioExtraParaAssinatura`.
 *
 * `verificarPermissaoGise`, a ACL de LEITURA deste domínio, tem doze casos ao
 * lado (em `permissao.test.ts`). O portão de ASSINATURA não tinha nenhum, e uma
 * varredura de mutação mediu o custo: seis mutantes sobreviveram em
 * `gise/permissao.ts`, quatro deles aqui dentro. O pior invertia
 *
 *     if (gise.supervisor_id !== u.id) → if (gise.supervisor_id === u.id)
 *
 * fazendo exatamente quem NÃO é o supervisor poder assinar, e recusando o
 * supervisor designado. A suíte inteira seguia verde.
 *
 * Isso importa mais do que a forma sugere. Este é o portão que o projeto
 * apertou DE PROPÓSITO: as cinco rotas de assinatura GISE divergiam, quatro
 * aceitavam `u.tipo === 'admin'` por POST direto, e a decisão registrada foi
 * remover o parâmetro `admitirAdmin` — porque a interface nunca ofereceu esse
 * caminho a um Admin Geral. A regra foi estreitada por escrito; nada a mantinha
 * estreita.
 *
 * Cada caso abaixo faz UM guarda recusar e deixa os outros satisfeitos, senão
 * a recusa não prova qual deles a produziu.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Database } from '$lib/db';

/** Estado que os mocks leem — cada teste ajusta só o que quer derrubar. */
const cenario = {
	gise: null as { id: number; supervisor_id: number | null } | null,
	seccionalAutorizada: true,
	ehSupervisaoExtra: false,
	saidaCompleta: true,
	assinaturaExistente: null as unknown
};

vi.mock('$lib/db', () => ({
	buscarGiseDetalhado: async () => cenario.gise,
	verificarSaidaCompletaSeccional: async () => cenario.saidaCompleta,
	buscarAssinaturaRelatorioGise: async () => cenario.assinaturaExistente,
	buscarGiseEscala: async () => cenario.gise,
	buscarGiseDocumento: async () => null
}));

vi.mock('../supervisao-extra', () => ({
	giseAutorizaSeccionalRelatorioExtra: async () => cenario.seccionalAutorizada,
	secIdEhSupervisaoExtra: async () => cenario.ehSupervisaoExtra
}));

const { carregarRelatorioExtraParaAssinatura } = await import('../permissao');

const SUPERVISOR_ID = 10;
const db = {} as Database;
const params = { id: '100', seccionalId: '7' };

function supervisor(
	overrides: Partial<NonNullable<App.Locals['usuario']>> = {}
): NonNullable<App.Locals['usuario']> {
	return {
		id: SUPERVISOR_ID,
		tipo: 'policial',
		nome: 'Supervisor Designado',
		primeiro_acesso: false,
		papel: null,
		cargo: 'DPC',
		...overrides
	} as NonNullable<App.Locals['usuario']>;
}

/** Lê status + mensagem da `Response` de recusa. */
async function recusa(r: { recusa?: Response }): Promise<{ status: number; error: string }> {
	if (!r.recusa) throw new Error('esperava recusa, veio autorização');
	const body = (await r.recusa.clone().json()) as { error: string };
	return { status: r.recusa.status, error: body.error };
}

beforeEach(() => {
	cenario.gise = { id: 100, supervisor_id: SUPERVISOR_ID };
	cenario.seccionalAutorizada = true;
	cenario.ehSupervisaoExtra = false;
	cenario.saidaCompleta = true;
	cenario.assinaturaExistente = null;
});

describe('carregarRelatorioExtraParaAssinatura — quem passa', () => {
	/**
	 * A linha de base. Sem ela, um portão que recusasse todo mundo passaria em
	 * todos os testes negativos abaixo.
	 */
	it('o supervisor designado passa, com tudo em ordem', async () => {
		const r = await carregarRelatorioExtraParaAssinatura(db, params, supervisor());
		// `if` e não `expect(...).toBeUndefined()`: a asserção é de runtime e não
		// estreita a união de retorno, então o acesso a `giseId` abaixo não
		// compilaria. O `throw` é o type guard.
		if (r.recusa) throw new Error('esperava autorização, veio recusa');
		expect(r.giseId).toBe(100);
		expect(r.secId).toBe(7);
	});
});

describe('carregarRelatorioExtraParaAssinatura — cada guarda recusa sozinho', () => {
	/**
	 * A decisão registrada no projeto: Admin Geral NÃO assina relatório
	 * extraordinário, porque a tela nunca ofereceu esse caminho. Esconder o
	 * botão não é autorização — o POST direto morre aqui.
	 */
	it('Admin Geral é recusado, por mais graduado que seja', async () => {
		const r = await carregarRelatorioExtraParaAssinatura(
			db,
			params,
			supervisor({ tipo: 'admin', isSuperAdmin: true })
		);
		const { status, error } = await recusa(r);
		expect(status).toBe(403);
		expect(error).toMatch(/supervisor designado/);
	});

	/**
	 * O guarda que a mutação derrubava. O usuário é policial, a GISE existe,
	 * seccional e saída estão em ordem — só o vínculo com a supervisão falha.
	 */
	it('policial que NÃO é o supervisor designado é recusado', async () => {
		const r = await carregarRelatorioExtraParaAssinatura(
			db,
			params,
			supervisor({ id: SUPERVISOR_ID + 1 })
		);
		const { status, error } = await recusa(r);
		expect(status).toBe(403);
		expect(error).toMatch(/supervisor designado/);
	});

	/** GISE sem supervisor não promove ninguém por coincidência de id nulo. */
	it('GISE sem supervisor designado não deixa ninguém assinar', async () => {
		cenario.gise = { id: 100, supervisor_id: null };
		const r = await carregarRelatorioExtraParaAssinatura(db, params, supervisor());
		expect((await recusa(r)).status).toBe(403);
	});

	it('id não numérico é recusado antes de qualquer consulta', async () => {
		for (const p of [
			{ id: 'abc', seccionalId: '7' },
			{ id: '100', seccionalId: 'xyz' }
		]) {
			const { status, error } = await recusa(
				await carregarRelatorioExtraParaAssinatura(db, p, supervisor())
			);
			expect(status).toBe(400);
			expect(error).toMatch(/ID inválido/);
		}
	});

	it('GISE inexistente devolve 404', async () => {
		cenario.gise = null;
		const { status } = await recusa(
			await carregarRelatorioExtraParaAssinatura(db, params, supervisor())
		);
		expect(status).toBe(404);
	});

	/** Seccional que não compõe esta GISE — o supervisor certo, o alvo errado. */
	it('seccional fora da GISE é recusada', async () => {
		cenario.seccionalAutorizada = false;
		const { status, error } = await recusa(
			await carregarRelatorioExtraParaAssinatura(db, params, supervisor())
		);
		expect(status).toBe(400);
		expect(error).toMatch(/Seccional inválida/);
	});

	/**
	 * O relatório atesta o serviço prestado; assiná-lo antes de todos saírem
	 * atestaria participação que ainda não terminou.
	 */
	it('saída incompleta impede a assinatura', async () => {
		cenario.saidaCompleta = false;
		const { status, error } = await recusa(
			await carregarRelatorioExtraParaAssinatura(db, params, supervisor())
		);
		expect(status).toBe(400);
		expect(error).toMatch(/confirmar a saída/);
	});

	it('relatório já assinado exige revogação antes (409)', async () => {
		cenario.assinaturaExistente = { id: 1 };
		const { status, error } = await recusa(
			await carregarRelatorioExtraParaAssinatura(db, params, supervisor())
		);
		expect(status).toBe(409);
		expect(error).toMatch(/Revogue/);
	});
});
