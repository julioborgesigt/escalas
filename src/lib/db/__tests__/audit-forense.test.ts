import { describe, it, expect } from 'vitest';
import { CATALOGO_ACOES, metaDaAcao, canonicalAudit, calcularHashRegistro } from '../audit';

const CHAIN_KEY = 'cd'.repeat(32); // 64 hex chars = 32 bytes

function linhaBase(over: Partial<Parameters<typeof canonicalAudit>[0]> = {}) {
	return {
		seq: 1,
		created_at: '2026-06-22 12:00:00',
		actor_tipo: 'admin',
		usuario_id: 7,
		usuario_nome: 'Fulano',
		usuario_papel: null,
		acao: 'excluir_escala',
		categoria: 'escala',
		severidade: 'aviso',
		resultado: 'sucesso',
		entidade: 'escala',
		entidade_id: 42,
		alvo_tipo: null,
		alvo_id: null,
		alvo_nome: null,
		detalhes: 'Escala excluída: ID 42',
		metadados: null,
		dados_antes: null,
		dados_depois: null,
		ip: '203.0.113.0',
		ip_cifrado: null,
		user_agent: 'Mozilla/5.0',
		request_id: 'abc123',
		rota: '/painel',
		metodo: 'POST',
		hash_anterior: 'GENESIS',
		...over
	};
}

describe('catálogo de ações', () => {
	it('todas as entradas têm categoria e severidade válidas', () => {
		const cats = new Set([
			'autenticacao',
			'escala',
			'gise',
			'policial',
			'unidade',
			'configuracao',
			'documento',
			'lgpd',
			'sistema'
		]);
		const sevs = new Set(['info', 'aviso', 'critico']);
		for (const [acao, meta] of Object.entries(CATALOGO_ACOES)) {
			expect(meta.label, acao).toBeTruthy();
			expect(cats.has(meta.categoria), `${acao}.categoria`).toBe(true);
			expect(sevs.has(meta.severidade), `${acao}.severidade`).toBe(true);
		}
	});

	it('ações sensíveis são classificadas como críticas', () => {
		expect(CATALOGO_ACOES.mudar_papel.severidade).toBe('critico');
		expect(CATALOGO_ACOES.reabrir_gise.severidade).toBe('critico');
		expect(CATALOGO_ACOES.login_bootstrap.severidade).toBe('critico');
		expect(CATALOGO_ACOES.excluir_policial.severidade).toBe('critico');
	});

	it('metaDaAcao tem fallback para ação fora do catálogo', () => {
		expect(metaDaAcao('login')).toEqual(CATALOGO_ACOES.login);
		expect(metaDaAcao('acao_desconhecida_xyz')).toEqual({
			label: 'acao_desconhecida_xyz',
			categoria: 'sistema',
			severidade: 'info'
		});
	});
});

describe('canonicalAudit — serialização determinística', () => {
	it('é estável para a mesma entrada', () => {
		expect(canonicalAudit(linhaBase())).toBe(canonicalAudit(linhaBase()));
	});

	it('muda quando qualquer campo relevante muda', () => {
		const base = canonicalAudit(linhaBase());
		expect(canonicalAudit(linhaBase({ detalhes: 'outro' }))).not.toBe(base);
		expect(canonicalAudit(linhaBase({ entidade_id: 43 }))).not.toBe(base);
		expect(canonicalAudit(linhaBase({ resultado: 'falha' }))).not.toBe(base);
	});
});

describe('calcularHashRegistro — cadeia de hash', () => {
	it('usa SHA-256 (tag s:) sem chave e HMAC (tag h:) com chave', async () => {
		const c = canonicalAudit(linhaBase());
		const semChave = await calcularHashRegistro('GENESIS', c);
		const comChave = await calcularHashRegistro('GENESIS', c, CHAIN_KEY);
		expect(semChave.startsWith('s:')).toBe(true);
		expect(comChave.startsWith('h:')).toBe(true);
		expect(semChave).not.toBe(comChave);
	});

	it('encadeia: hash muda com o hash_anterior', async () => {
		const c = canonicalAudit(linhaBase());
		const h1 = await calcularHashRegistro('GENESIS', c);
		const h2 = await calcularHashRegistro('s:deadbeef', c);
		expect(h1).not.toBe(h2);
	});

	it('resiliência: chave HMAC inválida cai para SHA-256 (não lança)', async () => {
		const c = canonicalAudit(linhaBase());
		// Chave fora do tamanho (não é 32 bytes hex) — não pode derrubar a auditoria.
		const h = await calcularHashRegistro('GENESIS', c, 'chave-invalida');
		expect(h.startsWith('s:')).toBe(true);
	});

	it('é reproduzível (verificação posterior recalcula o mesmo hash)', async () => {
		const c = canonicalAudit(linhaBase({ seq: 5, hash_anterior: 's:abc' }));
		const a = await calcularHashRegistro('s:abc', c, CHAIN_KEY);
		const b = await calcularHashRegistro('s:abc', c, CHAIN_KEY);
		expect(a).toBe(b);
	});

	it('detecta adulteração: alterar a linha invalida o hash', async () => {
		const original = canonicalAudit(linhaBase());
		const adulterado = canonicalAudit(linhaBase({ usuario_id: 999 }));
		const hOriginal = await calcularHashRegistro('GENESIS', original, CHAIN_KEY);
		const hAdulterado = await calcularHashRegistro('GENESIS', adulterado, CHAIN_KEY);
		expect(hOriginal).not.toBe(hAdulterado);
	});
});
