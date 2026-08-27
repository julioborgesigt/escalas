/**
 * A fila de pedidos de RH (movimentar / afastar / desvincular) — e a tranca que
 * impede o mesmo pedido de virar DOIS atos.
 *
 * Aqui a corrida pesa mais que na fila cadastral: aprovar uma movimentação
 * escreve na linha do tempo funcional, então dois cliques simultâneos gravariam
 * duas transferências para a mesma unidade, com duas portarias iguais. Por isso
 * `fecharSolicitacaoAcao` fecha ANTES de o chamador executar: quem perde a
 * corrida recebe `null` e não executa nada.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bancoMigrado, drizzleSobre } from '$lib/db/__tests__/sqlite-migrado';
import {
	buscarSolicitacaoAcao,
	criarSolicitacaoAcao,
	fecharSolicitacaoAcao,
	listarSolicitacoesAcaoPendentes
} from '../acao-solicitacoes';
import type { Database } from '$lib/db';

const POL = 45201;
const ADMIN_SECC = 45202;

let db: Database;
let sqlite: ReturnType<typeof bancoMigrado>;

beforeEach(() => {
	sqlite = bancoMigrado();
	db = drizzleSobre(sqlite);
	sqlite.exec(`
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha)
		VALUES (${POL}, 'M45201', 'Servidor Alvo', 'OIP', 'DEL A', 'h');
		INSERT INTO policiais (id, matricula, nome, cargo, lotacao, senha, papel, papel_unidade_id)
		VALUES (${ADMIN_SECC}, 'M45202', 'Admin Seccional', 'DPC', 'SEC 1', 'h', 'admin_seccional', 1);
	`);
});

/** Pedido de movimentação com portaria anexa, como a ficha o registra. */
async function pedirMovimentacao(justificativa = 'Portaria 45/2026, a pedido da seccional.') {
	return criarSolicitacaoAcao(db, {
		policial_id: POL,
		tipo: 'movimentacao',
		unidade_origem: 'DEL A',
		unidade_destino: 'DEL B',
		data_evento: '2026-09-01',
		nup: '00000.000123/2026-01',
		documento_r2_key: `policial-historico/${POL}/portaria.pdf`,
		documento_nome: 'portaria.pdf',
		justificativa,
		solicitante_id: ADMIN_SECC,
		solicitante_nome: 'Admin Seccional'
	});
}

describe('criarSolicitacaoAcao', () => {
	it('guarda o pedido inteiro, incluindo o anexo e quem pediu', async () => {
		const id = await pedirMovimentacao();
		const pedido = await buscarSolicitacaoAcao(db, id);

		expect(pedido?.status).toBe('pendente');
		expect(pedido?.unidade_origem).toBe('DEL A');
		expect(pedido?.unidade_destino).toBe('DEL B');
		expect(pedido?.nup).toBe('00000.000123/2026-01');
		// O anexo é o que permite ao Admin Geral LER a portaria antes de decidir.
		expect(pedido?.documento_r2_key).toContain('portaria.pdf');
		expect(pedido?.solicitante_id).toBe(ADMIN_SECC);
		expect(pedido?.justificativa).toBe('Portaria 45/2026, a pedido da seccional.');
	});

	it('a fila do Admin Geral traz o servidor alvo identificado', async () => {
		await pedirMovimentacao();
		const pendentes = await listarSolicitacoesAcaoPendentes(db);

		expect(pendentes).toHaveLength(1);
		expect(pendentes[0].policial_nome).toBe('Servidor Alvo');
		expect(pendentes[0].policial_matricula).toBe('M45201');
		expect(pendentes[0].policial_lotacao).toBe('DEL A');
	});
});

describe('fecharSolicitacaoAcao', () => {
	it('fecha uma vez e devolve o pedido para o chamador executar', async () => {
		const id = await pedirMovimentacao();
		const fechado = await fecharSolicitacaoAcao(db, id, true, 99);

		expect(fechado?.status).toBe('aprovada');
		expect(fechado?.unidade_destino).toBe('DEL B');
		expect((await buscarSolicitacaoAcao(db, id))?.decidido_por).toBe(99);
	});

	it('a segunda decisão devolve null — o ato não acontece duas vezes', async () => {
		const id = await pedirMovimentacao();
		await fecharSolicitacaoAcao(db, id, true, 99);
		expect(await fecharSolicitacaoAcao(db, id, true, 98)).toBeNull();
	});

	it('rejeitar fecha o pedido e devolve a chave do anexo, para a limpeza do R2', async () => {
		const id = await pedirMovimentacao();
		const fechado = await fecharSolicitacaoAcao(db, id, false, 99);

		expect(fechado?.status).toBe('rejeitada');
		// A rota usa esta chave para apagar o PDF: recusado, nenhuma outra linha
		// voltaria a referenciá-lo.
		expect(fechado?.documento_r2_key).toContain('portaria.pdf');
		expect(await listarSolicitacoesAcaoPendentes(db)).toHaveLength(0);
	});

	it('rejeitar e depois aprovar não reabre o pedido', async () => {
		const id = await pedirMovimentacao();
		await fecharSolicitacaoAcao(db, id, false, 99);
		expect(await fecharSolicitacaoAcao(db, id, true, 99)).toBeNull();
		expect((await buscarSolicitacaoAcao(db, id))?.status).toBe('rejeitada');
	});
});
