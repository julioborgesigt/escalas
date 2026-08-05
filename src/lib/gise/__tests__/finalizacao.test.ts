/**
 * Normal × antecipada — FLW-GISE-005.
 *
 * A saída antecipada FICA: há GISE cujos relatórios nunca chegam, e o Admin
 * Geral precisa encerrar sem mexer no banco. O que muda é ela deixar de ser
 * silenciosa — ganhar nome, aviso na tela e distinção na trilha.
 *
 * Este módulo é o ponto único dessa classificação, e é por isso que ele tem
 * teste próprio: as DUAS rotas de finalização e o modal dependem da mesma
 * resposta. Se cada um decidisse por conta, o gate e o aviso divergiriam no
 * primeiro estado novo da escada — que foi exatamente como o achado nasceu.
 */
import { describe, it, expect } from 'vitest';
import { modoDeFinalizacao, PENDENCIAS_DA_ANTECIPADA } from '../finalizacao';

describe('modoDeFinalizacao', () => {
	it('pronta_para_finalizar é a finalização normal', () => {
		expect(modoDeFinalizacao('pronta_para_finalizar')).toBe('normal');
	});

	it('em_andamento é antecipada — permitida, mas nomeada', () => {
		expect(modoDeFinalizacao('em_andamento')).toBe('antecipada');
	});

	it.each([
		'em_definicao_supervisor',
		'em_preenchimento',
		'aguardando_assinatura',
		'aguardando_relatorios',
		'aguardando_assinatura_relat'
	])('%s continua bloqueado', (status) => {
		expect(modoDeFinalizacao(status)).toBe('bloqueado');
	});

	it('finalizada é bloqueado — não se finaliza duas vezes', () => {
		expect(modoDeFinalizacao('finalizada')).toBe('bloqueado');
	});

	it('status desconhecido é bloqueado, não antecipado', () => {
		// Fail-closed: um estado novo na escada entra como bloqueado até alguém
		// decidir. O contrário abriria a finalização por omissão.
		expect(modoDeFinalizacao('estado_que_ainda_nao_existe')).toBe('bloqueado');
		expect(modoDeFinalizacao('')).toBe('bloqueado');
	});
});

describe('o que a antecipada deixa para trás', () => {
	it('enumera as pendências para o modal e para a auditoria', () => {
		// A lista é o conteúdo do aviso. Vazia, o modal voltaria a dizer só "não
		// poderá ser desfeita" — que é o texto que existia quando o achado foi
		// levantado.
		expect(PENDENCIAS_DA_ANTECIPADA.length).toBeGreaterThan(0);
		expect(PENDENCIAS_DA_ANTECIPADA.join(' ')).toMatch(/relatório/i);
		expect(PENDENCIAS_DA_ANTECIPADA.join(' ')).toMatch(/saída/i);
	});
});
