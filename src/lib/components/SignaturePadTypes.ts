export type SignaturePadLivenessResultado = {
	tipo: string;
	cumprido: boolean;
	tentativas: number;
	iniciadoEm: string | null;
	concluidoEm: string | null;
	duracaoMs: number;
};

export type SignaturePadStep = 'signature' | 'camera' | 'password' | 'email_code' | 'credenciais';

export type SignaturePadConfirmPayload = {
	rubrica: string;
	lat?: number;
	lng?: number;
	selfie: string | null;
	codigoEmail?: string;
	desafioId?: string;
	liveness: SignaturePadLivenessResultado | null;
	/** Janela de reautenticação por senha — o servidor recusa se faltar. */
	reauthId?: string;
};

/**
 * Título e descrição do diálogo de assinatura em tela para cada etapa —
 * usado pelo `PainelAssinaturaDigital` (GISE) e pelo diálogo próprio da
 * escala ordinária em `routes/escalas/+page.svelte`. `descricaoRubrica` é o
 * único ponto de variação real entre os dois: o texto da etapa final, que
 * nomeia o tipo de documento sendo assinado.
 */
export function textosEtapaAssinatura(
	step: SignaturePadStep,
	descricaoRubrica: string
): { titulo: string; descricao: string } {
	switch (step) {
		case 'camera':
			return {
				titulo: 'Prova de Vida',
				descricao: 'Cumpra o desafio de presença na tela para provar que você está ativo.'
			};
		case 'password':
			return {
				titulo: 'Confirme sua senha',
				descricao: 'A sessão sozinha não basta. Digite a senha de acesso para assinar.'
			};
		case 'email_code':
			return {
				titulo: 'Confirmação de Identidade',
				descricao: 'Por razões de segurança, insira o código enviado para o seu e-mail funcional.'
			};
		case 'credenciais':
			return {
				titulo: 'Fator de autenticação',
				descricao: 'Confirme sua senha e o código enviado por e-mail para concluir a assinatura.'
			};
		default:
			return { titulo: 'Assinatura Digital em Tela', descricao: descricaoRubrica };
	}
}
