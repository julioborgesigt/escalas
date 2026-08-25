import { describe, it, expect } from 'vitest';
import { textosEtapaAssinatura } from '../SignaturePadTypes';

/**
 * PainelAssinaturaDigital (GISE) e routes/escalas/+page.svelte tinham a
 * mesma cadeia de ternários para título/descrição de cada etapa do diálogo
 * de assinatura em tela, divergindo só no texto final (nome do documento).
 */
describe('textosEtapaAssinatura', () => {
	it('etapa camera', () => {
		expect(textosEtapaAssinatura('camera', 'fallback')).toEqual({
			titulo: 'Prova de Vida',
			descricao: 'Cumpra o desafio de presença na tela para provar que você está ativo.'
		});
	});

	it('etapa password', () => {
		expect(textosEtapaAssinatura('password', 'fallback')).toEqual({
			titulo: 'Confirme sua senha',
			descricao: 'A sessão sozinha não basta. Digite a senha de acesso para assinar.'
		});
	});

	it('etapa email_code', () => {
		expect(textosEtapaAssinatura('email_code', 'fallback')).toEqual({
			titulo: 'Confirmação de Identidade',
			descricao: 'Por razões de segurança, insira o código enviado para o seu e-mail funcional.'
		});
	});

	it('etapa credenciais', () => {
		expect(textosEtapaAssinatura('credenciais', 'fallback')).toEqual({
			titulo: 'Fator de autenticação',
			descricao: 'Confirme sua senha e o código enviado por e-mail para concluir a assinatura.'
		});
	});

	it('etapa signature usa a descrição específica do chamador', () => {
		expect(textosEtapaAssinatura('signature', 'Assine a escala X')).toEqual({
			titulo: 'Assinatura Digital em Tela',
			descricao: 'Assine a escala X'
		});
	});
});
