/**
 * Cerimônias WebAuthn no navegador — registro da passkey e asserção de
 * assinatura.
 *
 * Fica em `$lib` (e não em `_components/` de uma rota) porque tem dois
 * consumidores: o cadastro no `/perfil` e o fluxo de assinatura da escala.
 * Segue a forma de `$lib/assinatura-token.ts`, que centraliza o
 * preparar→assinar→finalizar do Token A3 pelo mesmo motivo — a orquestração
 * duplicada foi onde correções de robustez entravam num lugar e não no outro.
 *
 * Toda conversão binária passa por base64url, que é o alfabeto do WebAuthn.
 * Comparar contra base64 comum falha quando calha de aparecer `+` ou `/` — e
 * falha de forma intermitente, que é o pior modo de falhar.
 */
import { apiFetch } from '$lib/api-fetch';
import { bytesToBase64Url, base64UrlToBytes } from '$lib/crypto/bin';
import { hexToBytes } from '$lib/crypto/hex';

/** Campos da asserção, prontos para o corpo do finalizar. */
export interface AssercaoPasskey {
	credentialId: string;
	clientDataJSON: string;
	authenticatorData: string;
	assinatura: string;
}

interface OpcoesRegistro {
	desafioId: string;
	desafio: string;
	rpId: string;
	usuario: { id: string; nome: string };
	algoritmos: number[];
	credencialAtual: { criadoEm: string; apelido: string | null; vinculo: string } | null;
	exigeReposicao: boolean;
}

export interface CodigosReposicao {
	desafioInstitucional: string;
	codigoInstitucional: string;
	desafioPessoal: string;
	codigoPessoal: string;
}

/**
 * O navegador suporta passkey de plataforma?
 *
 * Duas perguntas diferentes: `PublicKeyCredential` existir diz que a API está
 * lá; `isUserVerifyingPlatformAuthenticatorAvailable` diz que HÁ biometria ou
 * PIN configurado neste aparelho. É a segunda que importa — sem bloqueio de
 * tela o cadastro falha, e o policial merece saber disso ANTES de tentar, não
 * com a escala pronta na mão.
 */
export async function passkeyDisponivel(): Promise<boolean> {
	if (typeof PublicKeyCredential === 'undefined') return false;
	try {
		return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
	} catch {
		return false;
	}
}

/**
 * Dispara os dois códigos da reposição (institucional e pessoal). Só quando
 * já há chave ativa — o GET de registro diz `exigeReposicao`.
 */
export async function solicitarCodigosReposicao(): Promise<{
	desafioInstitucional: string;
	desafioPessoal: string;
	emailInstitucionalMascarado: string;
	emailPessoalMascarado: string;
}> {
	return apiFetch('/api/webauthn/solicitar-codigo-reposicao', { method: 'POST' });
}

/**
 * Registra a passkey deste aparelho, substituindo a credencial anterior.
 *
 * Na reposição, `reposicao` carrega os dois códigos. O servidor recusa se já
 * houver chave ativa e os códigos não vierem — a UI não pode "esquecer".
 *
 * @returns a descrição do vínculo ("deste aparelho" x "sincronizada"), que a
 * tela mostra ao titular — é a mesma frase que vai ao manifesto do PDF.
 */
export async function registrarPasskey(
	apelido?: string | null,
	reposicao?: CodigosReposicao
): Promise<{ vinculo: string }> {
	const opcoes = await apiFetch<OpcoesRegistro>('/api/webauthn/registro');

	const credencial = (await navigator.credentials.create({
		publicKey: {
			challenge: base64UrlToBytes(opcoes.desafio) as BufferSource,
			rp: { id: opcoes.rpId, name: 'Escalas — Polícia Civil do Ceará' },
			user: {
				id: new TextEncoder().encode(opcoes.usuario.id) as BufferSource,
				name: opcoes.usuario.nome,
				displayName: opcoes.usuario.nome
			},
			pubKeyCredParams: opcoes.algoritmos.map((alg) => ({ type: 'public-key', alg })),
			authenticatorSelection: {
				// Autenticador do próprio aparelho, não chave externa.
				authenticatorAttachment: 'platform',
				residentKey: 'preferred',
				// Biometria/PIN obrigatórios: é a verificação do titular que
				// sustenta o "controle exclusivo" do art. 4º II "b". Sem isto a
				// credencial nasceria e o servidor a recusaria no cadastro.
				userVerification: 'required'
			},
			// Sem atestação — decisão registrada em `webauthn/registro.ts`. Pedir
			// atestação aqui e não verificá-la no servidor seria pior que não
			// pedir: daria a aparência de uma garantia que ninguém confere.
			attestation: 'none',
			timeout: 120_000
		}
	})) as PublicKeyCredential | null;

	if (!credencial) throw new Error('Cadastro cancelado no aparelho.');
	const resposta = credencial.response as AuthenticatorAttestationResponse;

	const spki = resposta.getPublicKey();
	if (!spki) {
		throw new Error(
			'Este navegador não expõe a chave pública da credencial. ' +
				'Atualize o navegador do celular e tente novamente.'
		);
	}

	return apiFetch<{ success: true; vinculo: string }>('/api/webauthn/registro', {
		method: 'POST',
		body: JSON.stringify({
			desafioId: opcoes.desafioId,
			credentialId: credencial.id,
			clientDataJSON: bytesToBase64Url(new Uint8Array(resposta.clientDataJSON)),
			authenticatorData: bytesToBase64Url(new Uint8Array(resposta.getAuthenticatorData())),
			publicKey: bytesToBase64Url(new Uint8Array(spki)),
			algoritmo: resposta.getPublicKeyAlgorithm(),
			apelido: apelido ?? null,
			...(reposicao ?? {})
		})
	});
}

/** Revoga a própria passkey (troca de aparelho). */
export async function revogarPasskey(): Promise<void> {
	await apiFetch('/api/webauthn/registro', { method: 'DELETE' });
}

/**
 * Cerimônia de ASSINATURA: o desafio é o hash do PDF preparado.
 *
 * É isto que transforma "esta pessoa se autenticou" em "esta pessoa afirmou
 * este documento" — trocar o PDF entre o preparar e o finalizar muda o hash, e
 * a asserção deixa de conferir no servidor.
 *
 * @param documentHashHex hash SHA-256 do PDF, como o `preparar` devolveu.
 * @param credentialId credencial ativa do titular (`allowCredentials`).
 */
export async function assinarComPasskey(
	documentHashHex: string,
	credentialId: string
): Promise<AssercaoPasskey> {
	// O hash vem do servidor, mas um `null` aqui viraria `challenge: null` e a
	// cerimônia falharia com erro de plataforma, ilegível para quem está em campo.
	const desafio = hexToBytes(documentHashHex);
	if (!desafio) throw new Error('Preparação da assinatura devolveu um hash inválido.');

	const credencial = (await navigator.credentials.get({
		publicKey: {
			challenge: desafio as BufferSource,
			allowCredentials: [
				{ type: 'public-key', id: base64UrlToBytes(credentialId) as BufferSource }
			],
			userVerification: 'required',
			timeout: 120_000
		}
	})) as PublicKeyCredential | null;

	if (!credencial) throw new Error('Assinatura cancelada no aparelho.');
	const resposta = credencial.response as AuthenticatorAssertionResponse;

	return {
		credentialId: credencial.id,
		clientDataJSON: bytesToBase64Url(new Uint8Array(resposta.clientDataJSON)),
		authenticatorData: bytesToBase64Url(new Uint8Array(resposta.authenticatorData)),
		assinatura: bytesToBase64Url(new Uint8Array(resposta.signature))
	};
}
