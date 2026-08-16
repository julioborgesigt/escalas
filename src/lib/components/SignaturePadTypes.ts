export type SignaturePadLivenessResultado = {
	tipo: string;
	cumprido: boolean;
	tentativas: number;
	iniciadoEm: string | null;
	concluidoEm: string | null;
	duracaoMs: number;
};

export type SignaturePadStep = 'signature' | 'camera' | 'password' | 'email_code';

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
