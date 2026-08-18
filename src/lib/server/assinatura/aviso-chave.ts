/**
 * Aviso no e-mail funcional após cadastro, substituição ou revogação da chave.
 *
 * Não é trava: o ato (cerimônia WebAuthn / DELETE) já aconteceu. Falha de
 * envio ou ausência de caixa funcional só entra em log — o mesmo contrato do
 * aviso de troca de e-mail pessoal. Sem isso, sessão aberta num celular alheio
 * cadastraria chave e o titular só descobriria na hora de assinar.
 */
import { logger } from '../logger';
import { enviarAvisoChaveAssinatura, type EventoAvisoChaveAssinatura } from '../email';
import { mensagemDeErro } from '$lib/utils/erro';

/**
 * Best-effort. Sem e-mail ou sem identificador, não envia. Nunca relança.
 */
export async function avisarChaveNoEmailFuncional(
	platform: App.Platform | undefined,
	opts: {
		email: string | null | undefined;
		nome: string;
		evento: EventoAvisoChaveAssinatura;
		credentialId: string | null | undefined;
	}
): Promise<void> {
	if (!opts.email) {
		logger.warn('[aviso-chave] sem e-mail funcional — aviso não enviado', {
			evento: opts.evento
		});
		return;
	}
	if (!opts.credentialId) {
		logger.warn('[aviso-chave] sem identificador — aviso não enviado', {
			evento: opts.evento
		});
		return;
	}

	try {
		await enviarAvisoChaveAssinatura(
			opts.email,
			opts.nome,
			opts.evento,
			opts.credentialId,
			platform
		);
	} catch (err) {
		logger.warn('[aviso-chave] Falha ao enviar aviso ao e-mail funcional', {
			evento: opts.evento,
			error: mensagemDeErro(err)
		});
	}
}
