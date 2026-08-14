/**
 * Registro (enrollment) da credencial WebAuthn.
 *
 * O que o servidor guarda é a CHAVE PÚBLICA em SPKI, entregue pelo navegador
 * via `response.getPublicKey()`. É uma decisão de escopo com consequência
 * jurídica, então fica escrita:
 *
 * O caminho canônico seria decodificar o `attestationObject` (CBOR) para
 * extrair a chave COSE e, com ela, verificar a ATESTAÇÃO contra as raízes de
 * Apple e Google — o que provaria que a chave nasceu num enclave genuíno.
 * Usamos `attestation: 'none'` e a chave que o cliente entrega. Isso é
 * suficiente para o que a assinatura afirma (posse da chave + verificação do
 * titular a cada uso), e insuficiente para afirmar HARDWARE. O manifesto tem
 * de refletir essa fronteira: "autenticador de plataforma" aqui é declaração
 * do cliente, não fato verificado — exatamente como o user-agent na política
 * de dispositivo.
 *
 * Confiar no cliente NO REGISTRO é aceitável porque o adversário desse passo é
 * o próprio titular, autenticado, registrando a própria chave. Quem forjasse
 * uma chave de software estaria enfraquecendo a prova que protege a si mesmo.
 * O que NÃO pode ser aceito do cliente é a asserção — ver `assercao.ts`.
 *
 * Só **ES256** (COSE alg `-7`, ECDSA P-256). É o que os autenticadores de
 * plataforma de iOS e Android emitem, e o fluxo já está restrito a celular
 * pela política de dispositivo. A recusa acontece AQUI, no registro, e não na
 * hora de assinar: descobrir o algoritmo incompatível com a escala pronta e o
 * policial em campo seria o pior momento possível.
 */
import { lerAuthenticatorData } from './authenticator-data';
import { bytesToBase64Url } from '$lib/crypto/bin';
import { logger } from '../../logger';

/** COSE algorithm identifier de ES256 (ECDSA w/ SHA-256, curva P-256). */
export const ALG_ES256 = -7;

export interface EntradaRegistro {
	/** `clientDataJSON` cru da cerimônia de criação. */
	clientDataJSON: Uint8Array;
	/** `getAuthenticatorData()` da resposta de criação. */
	authenticatorData: Uint8Array;
	/** `getPublicKey()` — SPKI. */
	publicKeySpki: Uint8Array;
	/** `getPublicKeyAlgorithm()` — identificador COSE. */
	algoritmo: number;
	/** Desafio que o servidor emitiu para esta cerimônia. */
	desafioEsperado: Uint8Array;
	origemEsperada: string;
}

type MotivoRecusa =
	| 'client-data-invalido'
	| 'tipo-divergente'
	| 'desafio-divergente'
	| 'origem-divergente'
	| 'algoritmo-nao-suportado'
	| 'usuario-nao-verificado'
	| 'chave-invalida';

interface CredencialRegistrada {
	publicKeySpki: Uint8Array;
	contador: number;
	aaguid: string | null;
	backupElegivel: boolean;
	backupAtivo: boolean;
}

export type ResultadoRegistro =
	{ ok: true; credencial: CredencialRegistrada } | { ok: false; motivo: MotivoRecusa };

/** Mensagem para quem está cadastrando — precisa dizer o que fazer. */
export function mensagemRecusaRegistro(motivo: MotivoRecusa): string {
	if (motivo === 'algoritmo-nao-suportado') {
		return (
			'Este aparelho gerou uma chave em formato que o sistema não aceita. ' +
			'Use o desbloqueio biométrico do próprio celular (Face ID, Touch ID ou ' +
			'biometria do Android), não uma chave de segurança externa.'
		);
	}
	if (motivo === 'usuario-nao-verificado') {
		return (
			'O cadastro exige confirmação por biometria ou PIN do aparelho. ' +
			'Verifique se o bloqueio de tela está configurado e tente novamente.'
		);
	}
	return 'Não foi possível registrar a chave de assinatura. Tente novamente pelo seu celular.';
}

/**
 * Confere a cerimônia de criação e devolve o que deve ser persistido.
 *
 * Nunca lança: qualquer erro vira `{ ok: false }` com o motivo.
 */
export async function verificarRegistro(entrada: EntradaRegistro): Promise<ResultadoRegistro> {
	let clientData: { type?: string; challenge?: string; origin?: string };
	try {
		clientData = JSON.parse(new TextDecoder().decode(entrada.clientDataJSON));
	} catch {
		return recusar('client-data-invalido');
	}

	if (clientData.type !== 'webauthn.create') return recusar('tipo-divergente');

	if (clientData.challenge !== bytesToBase64Url(entrada.desafioEsperado)) {
		return recusar('desafio-divergente');
	}
	if (clientData.origin !== entrada.origemEsperada) return recusar('origem-divergente');

	if (entrada.algoritmo !== ALG_ES256) {
		logger.warn('[webauthn] registro recusado por algoritmo', { algoritmo: entrada.algoritmo });
		return recusar('algoritmo-nao-suportado');
	}

	let dados;
	try {
		dados = lerAuthenticatorData(entrada.authenticatorData);
	} catch {
		return recusar('client-data-invalido');
	}

	// Registrar sem UV produziria uma credencial que a assinatura recusaria
	// depois (`assercao.ts` exige UV) — um cadastro que nasce inutilizável.
	if (!dados.usuarioVerificado) return recusar('usuario-nao-verificado');

	// A chave só serve se a Web Crypto conseguir importá-la como P-256. Testar
	// no cadastro evita gravar uma credencial que falharia na primeira
	// assinatura, quando o custo do erro é máximo.
	try {
		await crypto.subtle.importKey(
			'spki',
			entrada.publicKeySpki as BufferSource,
			{ name: 'ECDSA', namedCurve: 'P-256' },
			false,
			['verify']
		);
	} catch {
		return recusar('chave-invalida');
	}

	return {
		ok: true,
		credencial: {
			publicKeySpki: entrada.publicKeySpki,
			contador: dados.contador,
			aaguid: dados.aaguid,
			backupElegivel: dados.backupElegivel,
			backupAtivo: dados.backupAtivo
		}
	};
}

function recusar(motivo: MotivoRecusa): ResultadoRegistro {
	logger.warn('[webauthn] registro recusado', { motivo });
	return { ok: false, motivo };
}
