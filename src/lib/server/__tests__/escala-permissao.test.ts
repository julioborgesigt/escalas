import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Database } from '$lib/db';
import type { UsuarioLogado } from '$lib/auth';

// Mock dos módulos ANTES de importar o SUT — Vitest interpreta hoisting.
vi.mock('$lib/db', () => ({
	temSolicitacaoParaDpcAdmin: vi.fn()
}));
vi.mock('$lib/server/policial-permissao', () => ({
	lotacoesAdministradas: vi.fn()
}));

// Import depois do mock para garantir bind correto.
import { verificarPermissaoEscala } from '../escala-permissao';
import { temSolicitacaoParaDpcAdmin } from '$lib/db';
import { lotacoesAdministradas } from '$lib/server/policial-permissao';

const fakeDb = {} as Database;

function user(overrides: Partial<UsuarioLogado>): NonNullable<App.Locals['usuario']> {
	return {
		id: 1,
		tipo: 'policial',
		nome: 'Fulano',
		primeiro_acesso: false,
		matricula: '00001',
		lotacao: 'DELEGACIA A',
		papel: null,
		papel_unidade_id: null,
		cargo: 'OIP',
		cpf: null,
		email: null,
		...overrides
	} as NonNullable<App.Locals['usuario']>;
}

describe('verificarPermissaoEscala', () => {
	beforeEach(() => {
		vi.mocked(temSolicitacaoParaDpcAdmin).mockReset();
		vi.mocked(lotacoesAdministradas).mockReset();
		// Default: escopo vazio (sem unidades). Testes que exercitam o ramo DPC
		// sobrescrevem com o conjunto relevante.
		vi.mocked(lotacoesAdministradas).mockResolvedValue(new Set());
		vi.mocked(temSolicitacaoParaDpcAdmin).mockResolvedValue(false);
	});

	it('admin geral SEMPRE pode (mesmo de outra lotação)', async () => {
		const u = user({ tipo: 'admin', lotacao: undefined, papel: undefined });
		const r = await verificarPermissaoEscala(fakeDb, 1, 'DELEGACIA X', u);
		expect(r).toEqual({ permitido: true });
		expect(temSolicitacaoParaDpcAdmin).not.toHaveBeenCalled();
	});

	it('policial da mesma lotação pode', async () => {
		const u = user({ lotacao: 'DELEGACIA A' });
		const r = await verificarPermissaoEscala(fakeDb, 1, 'DELEGACIA A', u);
		expect(r).toEqual({ permitido: true });
	});

	it('policial de outra lotação sem papel admin NÃO pode', async () => {
		const u = user({ lotacao: 'DELEGACIA A' });
		const r = await verificarPermissaoEscala(fakeDb, 1, 'DELEGACIA B', u);
		expect(r.permitido).toBe(false);
		expect(r.motivo).toMatch(/Sem permiss/i);
	});

	it('admin seccional VÊ escala de unidade sob seu escopo (sem solicitação, qualquer cargo/tipo)', async () => {
		// Cenário reportado: a seccional administra a unidade dona da escala (FDS ou
		// mensal). O acesso de LEITURA é direto pelo escopo — não exige solicitação
		// nem cargo DPC. Antes desta regra o load expulsava a seccional para /escalas.
		vi.mocked(lotacoesAdministradas).mockResolvedValueOnce(
			new Set(['SECCIONAL A', 'DELEGACIA X', 'DELEGACIA Y'])
		);
		const u = user({
			lotacao: 'SECCIONAL A',
			papel: 'admin_seccional',
			papel_unidade_id: 10,
			cargo: 'OIP' // vale mesmo sem ser DPC — é somente leitura
		});
		const r = await verificarPermissaoEscala(fakeDb, 7, 'DELEGACIA X', u);
		expect(r).toEqual({ permitido: true });
		// Escopo já cobre a lotação → não recorre à solicitação de assinatura.
		expect(temSolicitacaoParaDpcAdmin).not.toHaveBeenCalled();
	});

	it('admin seccional NÃO vê escala de unidade fora do seu escopo (sem solicitação)', async () => {
		// Unidade de OUTRA seccional: fora do escopo e sem solicitação → negado.
		vi.mocked(lotacoesAdministradas).mockResolvedValueOnce(new Set(['SECCIONAL A', 'DELEGACIA X']));
		const u = user({
			lotacao: 'SECCIONAL A',
			papel: 'admin_seccional',
			papel_unidade_id: 10,
			cargo: 'OIP'
		});
		const r = await verificarPermissaoEscala(fakeDb, 8, 'DELEGACIA Z', u);
		expect(r.permitido).toBe(false);
	});

	it('admin seccional DPC de outra lotação pode SE houver solicitação para ele', async () => {
		vi.mocked(lotacoesAdministradas).mockResolvedValueOnce(new Set(['OUTRA']));
		vi.mocked(temSolicitacaoParaDpcAdmin).mockResolvedValueOnce(true);
		const u = user({
			lotacao: 'SECCIONAL A',
			papel: 'admin_seccional',
			cargo: 'DPC'
		});
		const r = await verificarPermissaoEscala(fakeDb, 42, 'DELEGACIA X', u);
		expect(r).toEqual({ permitido: true });
		// Escopo administrativo é propagado para fechar o IDOR cross-unidade.
		expect(temSolicitacaoParaDpcAdmin).toHaveBeenCalledWith(
			fakeDb,
			42,
			u.id,
			['OUTRA'],
			'DELEGACIA X'
		);
	});

	it('admin seccional DPC SEM solicitação direcionada NÃO pode', async () => {
		vi.mocked(temSolicitacaoParaDpcAdmin).mockResolvedValueOnce(false);
		const u = user({
			lotacao: 'SECCIONAL A',
			papel: 'admin_seccional',
			cargo: 'DPC'
		});
		const r = await verificarPermissaoEscala(fakeDb, 42, 'DELEGACIA X', u);
		expect(r.permitido).toBe(false);
		expect(r.motivo).toMatch(/solicita/i);
	});

	it('admin unidade DPC funciona da mesma forma (mesmo path)', async () => {
		vi.mocked(temSolicitacaoParaDpcAdmin).mockResolvedValueOnce(true);
		const u = user({
			lotacao: 'OUTRA',
			papel: 'admin_unidade',
			cargo: 'DPC'
		});
		const r = await verificarPermissaoEscala(fakeDb, 1, 'DELEGACIA X', u);
		expect(r.permitido).toBe(true);
	});

	it('admin seccional OIP (não DPC) NÃO pode via solicitação — só DPC assina', async () => {
		const u = user({
			lotacao: 'SECCIONAL A',
			papel: 'admin_seccional',
			cargo: 'OIP'
		});
		const r = await verificarPermissaoEscala(fakeDb, 1, 'DELEGACIA X', u);
		expect(r.permitido).toBe(false);
		expect(temSolicitacaoParaDpcAdmin).not.toHaveBeenCalled();
	});

	it('policial DPC sem papel administrativo de outra lotação NÃO pode', async () => {
		const u = user({
			lotacao: 'SECCIONAL A',
			papel: null,
			cargo: 'DPC'
		});
		const r = await verificarPermissaoEscala(fakeDb, 1, 'DELEGACIA X', u);
		expect(r.permitido).toBe(false);
		expect(temSolicitacaoParaDpcAdmin).not.toHaveBeenCalled();
	});

	it('mesma lotação tem prioridade sobre rota DPC (sem consulta DB)', async () => {
		const u = user({
			lotacao: 'DELEGACIA A',
			papel: 'admin_seccional',
			cargo: 'DPC'
		});
		const r = await verificarPermissaoEscala(fakeDb, 1, 'DELEGACIA A', u);
		expect(r.permitido).toBe(true);
		expect(temSolicitacaoParaDpcAdmin).not.toHaveBeenCalled();
	});
});
