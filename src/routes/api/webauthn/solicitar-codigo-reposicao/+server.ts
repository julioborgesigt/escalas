/**
 * POST /api/webauthn/solicitar-codigo-reposicao
 *
 * Dispara os DOIS códigos da reposição da chave (institucional e pessoal).
 * Só quando já há chave ativa — o primeiro cadastro não passa por aqui.
 *
 * Autosserviço: a sessão é o titular, nunca um id de terceiro. Cadastro da
 * chave alheia não existe (Lei 14.063/2020 art. 4º II "b").
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarCredencialAtiva } from '$lib/db';
import { gerarCodigo2FA } from '$lib/auth';
import { enviarCodigo2FA } from '$lib/server/email';
import { logger } from '$lib/server/logger';
import { mascararEmail } from '$lib/server/auth/auth-flow';
import { credencialDoUsuario } from '$lib/server/auth/credencial';
import {
	contarRecoveryAttempts,
	registrarRecoveryAttempt
} from '$lib/server/auth/recovery-rate-limit';
import { requireAuth, badRequest, rateLimited, serverError } from '$lib/server/api';
import { recusaCadastroChaveDesktop } from '$lib/server/assinatura/chave-assinatura';
import {
	buscarEmailsReposicao,
	mensagemSemEmailReposicao
} from '$lib/server/assinatura/reposicao-passkey';
import { criarDesafioReposicao } from '$lib/db/passkey-reposicao';
import { mensagemDeErro } from '$lib/utils/erro';

const MAX = 5;
const JANELA_MIN = 15;

export const POST: RequestHandler = async ({ platform, locals, request, getClientAddress }) => {
	try {
		const u = requireAuth(locals);
		if (u instanceof Response) return u;

		const ua = request.headers.get('user-agent') || '';
		const recusaUa = recusaCadastroChaveDesktop(ua);
		if (recusaUa) return recusaUa;

		const db = getDB(platform);
		const dono = credencialDoUsuario(u);
		const atual = await buscarCredencialAtiva(db, dono);
		if (!atual) {
			return badRequest(
				'O primeiro cadastro da chave não exige os dois e-mails. Use Meu Perfil pelo celular.'
			);
		}

		const emails = await buscarEmailsReposicao(db, u);
		if (!emails.ok) return badRequest(mensagemSemEmailReposicao(emails.motivo));

		const ip = getClientAddress();
		try {
			const { blocked } = await contarRecoveryAttempts(
				db,
				ip,
				'passkey_reposicao',
				JANELA_MIN,
				MAX
			);
			if (blocked) {
				return rateLimited('Muitas solicitações de código. Aguarde alguns minutos.');
			}
		} catch (err) {
			logger.error('[passkey-reposicao] Falha no rate-limit (fail-open)', {
				error: mensagemDeErro(err)
			});
		}

		try {
			await registrarRecoveryAttempt(db, ip, 'passkey_reposicao');
		} catch (err) {
			logger.error('[passkey-reposicao] Falha ao registrar tentativa (fail-open)', {
				error: mensagemDeErro(err)
			});
		}

		const codigoInst = gerarCodigo2FA();
		const codigoPess = gerarCodigo2FA();
		const [desafioInstitucional, desafioPessoal] = await Promise.all([
			criarDesafioReposicao(db, dono, 'institucional', codigoInst, emails.institucional),
			criarDesafioReposicao(db, dono, 'pessoal', codigoPess, emails.pessoal)
		]);

		const jobInst = enviarCodigo2FA(emails.institucional, codigoInst, u.nome, platform).catch(
			(err) => {
				logger.error('[passkey-reposicao] Falha ao enviar e-mail institucional', {
					error: mensagemDeErro(err)
				});
			}
		);
		const jobPess = enviarCodigo2FA(emails.pessoal, codigoPess, u.nome, platform).catch((err) => {
			logger.error('[passkey-reposicao] Falha ao enviar e-mail pessoal', {
				error: mensagemDeErro(err)
			});
		});
		platform?.ctx?.waitUntil(Promise.all([jobInst, jobPess]));

		return json({
			success: true,
			desafioInstitucional,
			desafioPessoal,
			emailInstitucionalMascarado: mascararEmail(emails.institucional),
			emailPessoalMascarado: mascararEmail(emails.pessoal)
		});
	} catch (err) {
		return serverError('[passkey-reposicao] Erro crítico no handler', err);
	}
};
