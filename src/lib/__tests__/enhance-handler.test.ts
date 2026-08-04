/**
 * `mostrarErroDeResultado` — o ramo de erro compartilhado pelos handlers de
 * form action do cliente.
 *
 * O que importa provar aqui é a DISTINÇÃO entre os dois modos de falha, porque
 * ela é a única razão de a função existir em vez de um `toaster.error` solto:
 * `error` (rede/exceção) não tem mensagem útil para mostrar e vira o convite a
 * tentar de novo; `failure` (recusa do servidor) traz a explicação em
 * `data.error`, e engolir isso deixaria o usuário sem saber o que corrigir.
 *
 * Antes de ser extraída, essa lógica estava copiada em 11 handlers — o teste
 * agora cobre as 11 de uma vez.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActionResult } from '@sveltejs/kit';

const create = vi.fn();
vi.mock('$lib/toast', () => ({ toaster: { create: (...args: unknown[]) => create(...args) } }));

const { mostrarErroDeResultado } = await import('../enhance-handler');

beforeEach(() => create.mockReset());

/** Título do último toast emitido. */
const ultimoTitulo = () => create.mock.calls.at(-1)?.[0]?.title;

describe('mostrarErroDeResultado', () => {
	it('falha de rede vira convite a repetir, não detalhe técnico', () => {
		mostrarErroDeResultado({ type: 'error', error: new Error('fetch failed') }, 'Erro ao salvar');
		expect(ultimoTitulo()).toBe('Erro de conexão. Tente novamente.');
		expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
	});

	it('recusa do servidor mostra a mensagem do servidor, não o fallback', () => {
		mostrarErroDeResultado(
			{ type: 'failure', status: 409, data: { error: 'Escala já assinada' } },
			'Erro ao salvar'
		);
		expect(ultimoTitulo()).toBe('Escala já assinada');
	});

	it('recusa sem mensagem cai no fallback do call site', () => {
		mostrarErroDeResultado({ type: 'failure', status: 400, data: {} }, 'Erro ao salvar');
		expect(ultimoTitulo()).toBe('Erro ao salvar');
	});

	it('recusa sem data nenhuma também cai no fallback', () => {
		mostrarErroDeResultado({ type: 'failure', status: 500 } as ActionResult, 'Erro ao remover');
		expect(ultimoTitulo()).toBe('Erro ao remover');
	});

	it('`redirect` não é falha, mas se chegar aqui não inventa mensagem própria', () => {
		// `use:enhance` trata redirect antes; o fallback é o comportamento defensivo.
		mostrarErroDeResultado({ type: 'redirect', status: 302, location: '/' }, 'Erro ao decidir');
		expect(ultimoTitulo()).toBe('Erro ao decidir');
	});
});
