/**
 * Redação de e-mail em TEXTO LIVRE — FLW-LGPD-002.
 *
 * O caso que motivou a função não é "logar um endereço": é o endereço vindo no
 * MEIO de outra coisa — corpo de erro do provedor, mensagem de exceção, stack.
 * Esses atravessam camadas e desfazem, por dentro, a máscara que o ponto de log
 * aplicou com cuidado. Os casos abaixo são todos dessa forma.
 */
import { describe, it, expect } from 'vitest';
import { redigirEmails, mascararEmail } from '../pii';

describe('redigirEmails', () => {
	it('mascara o endereço preservando o texto ao redor', () => {
		const dentro = redigirEmails('Falha ao entregar para joao.silva@exemplo.com.br (quota)');
		expect(dentro).toContain('Falha ao entregar para ');
		expect(dentro).toContain(' (quota)');
		expect(dentro).not.toContain('joao.silva');
		expect(dentro).not.toContain('exemplo.com.br');
	});

	it('mascara TODOS os endereços, não só o primeiro', () => {
		const t = redigirEmails('{"delivered":["ana@a.com","bruno@b.org","carla@c.net"]}');
		for (const local of ['ana', 'bruno', 'carla']) expect(t).not.toContain(local + '@');
		expect(t.match(/@\*\*\*/g)).toHaveLength(3);
	});

	it('o motivo do erro continua legível — some o "para quem", não o "o quê"', () => {
		// É o que justifica redigir em vez de simplesmente não logar.
		const t = redigirEmails('550 5.1.1 Recipient rejeitado: destino@orgao.gov.br não existe');
		expect(t).toContain('550 5.1.1 Recipient rejeitado');
		expect(t).toContain('não existe');
	});

	it('é idempotente: redigir de novo não corrói mais nada', () => {
		const uma = redigirEmails('erro em ana.paula@exemplo.com');
		expect(redigirEmails(uma)).toBe(uma);
	});

	it('usa a MESMA máscara de exibição', () => {
		expect(redigirEmails('x ana.paula@exemplo.com y')).toBe(
			`x ${mascararEmail('ana.paula@exemplo.com')} y`
		);
	});

	it('texto sem e-mail passa intacto; vazio e nulo não lançam', () => {
		expect(redigirEmails('HTTP 500 sem detalhes')).toBe('HTTP 500 sem detalhes');
		expect(redigirEmails('')).toBe('');
		expect(redigirEmails(undefined)).toBe('');
		expect(redigirEmails(null)).toBe('');
	});

	it('não confunde @ solto nem domínio sem TLD com endereço', () => {
		expect(redigirEmails('erro @ linha 12')).toBe('erro @ linha 12');
		expect(redigirEmails('user@localhost')).toBe('user@localhost');
	});

	it('endereço colado em pontuação de JSON também é pego', () => {
		// O corpo de erro chega como JSON; se a aspa colada quebrasse o padrão, o
		// caso REAL escaparia e o teste de frase solta daria falsa segurança.
		const t = redigirEmails('{"to":"maria@dominio.com","erro":"x"}');
		expect(t).not.toContain('maria@dominio.com');
		expect(t).toContain('"erro":"x"');
	});
});
