/**
 * Fluxo de verificação do e-mail pessoal em duas etapas (código OTP):
 *  1. solicitar — envia um código de 6 dígitos ao novo endereço;
 *  2. confirmar — valida o código e efetiva o cadastro/troca no servidor.
 *
 * Usado no primeiro acesso (alterar-senha) e na troca pelo "Meu perfil" —
 * antes cada tela duplicava a máquina de estados e divergia em detalhes
 * (uma fazia trim() do e-mail, a outra não).
 */
import { apiFetch } from '$lib/api-fetch';

interface SolicitarResponse {
	desafioId?: string;
	emailMascarado?: string;
}

interface ConfirmarResponse {
	ok?: boolean;
}

export function useVerificacaoEmailPessoal(opts?: {
	/** Senha de acesso — exigida pelo servidor quando é TROCA de e-mail. */
	getSenha?: () => string;
	/** Chamado ao confirmar o código; recebe o e-mail normalizado (trim + lowercase). */
	onVerificado?: (email: string) => void;
}) {
	let email = $state('');
	let codigo = $state('');
	let etapa = $state<'dados' | 'codigo' | 'verificado'>('dados');
	let emailMascarado = $state('');
	let enviando = $state(false);
	let erro = $state('');
	let desafioId = '';

	async function enviarCodigo(): Promise<void> {
		erro = '';
		enviando = true;
		try {
			const senha = opts?.getSenha?.() ?? '';
			const json = await apiFetch<SolicitarResponse>(
				'/api/auth/solicitar-verificacao-email-pessoal',
				{
					method: 'POST',
					body: JSON.stringify({ email: email.trim(), ...(senha ? { senha } : {}) })
				}
			);
			if (!json.desafioId) throw new Error('Erro ao enviar o código. Tente novamente.');
			desafioId = json.desafioId;
			emailMascarado = json.emailMascarado ?? '';
			etapa = 'codigo';
		} catch (e: unknown) {
			erro = e instanceof Error ? e.message : 'Erro ao enviar o código. Tente novamente.';
		} finally {
			enviando = false;
		}
	}

	async function confirmarCodigo(): Promise<void> {
		erro = '';
		enviando = true;
		try {
			const json = await apiFetch<ConfirmarResponse>(
				'/api/auth/confirmar-verificacao-email-pessoal',
				{
					method: 'POST',
					body: JSON.stringify({ desafioId, codigo: codigo.trim(), email: email.trim() })
				}
			);
			if (!json.ok) throw new Error('Código inválido. Tente novamente.');
			etapa = 'verificado';
			opts?.onVerificado?.(email.trim().toLowerCase());
		} catch (e: unknown) {
			erro = e instanceof Error ? e.message : 'Código inválido. Tente novamente.';
		} finally {
			enviando = false;
		}
	}

	/** Volta para a etapa do e-mail descartando o código digitado ("usar outro e-mail"). */
	function voltarParaDados() {
		etapa = 'dados';
		codigo = '';
		erro = '';
	}

	function reset() {
		email = '';
		codigo = '';
		etapa = 'dados';
		emailMascarado = '';
		enviando = false;
		erro = '';
		desafioId = '';
	}

	return {
		get email() {
			return email;
		},
		set email(v: string) {
			email = v;
		},
		get codigo() {
			return codigo;
		},
		set codigo(v: string) {
			codigo = v;
		},
		get etapa() {
			return etapa;
		},
		get emailMascarado() {
			return emailMascarado;
		},
		get enviando() {
			return enviando;
		},
		get erro() {
			return erro;
		},
		enviarCodigo,
		confirmarCodigo,
		voltarParaDados,
		reset
	};
}
