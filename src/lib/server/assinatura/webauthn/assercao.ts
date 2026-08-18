/**
 * Verificação da asserção WebAuthn — a prova de que a chave privada guardada
 * no enclave do aparelho operou sobre ESTE documento.
 *
 * É o mesmo desafio-resposta de `auth/cert-login.ts`, e vale repetir a lição
 * que aquele módulo documenta: assinatura válida NÃO basta. Uma asserção
 * legítima capturada de outro fluxo continua sendo uma asserção legítima. O
 * que a torna prova DESTE ato são os vínculos conferidos abaixo — desafio,
 * origem e titular —, e é por isso que a ordem das checagens está fixada aqui
 * em vez de espalhada pelo endpoint.
 *
 * O `challenge` é o **hash do PDF preparado** (gravado em `assinatura_intencoes`
 * por `criarIntencaoAssinatura`). Isso é o que transforma "esta pessoa se
 * autenticou" em "esta pessoa afirmou este documento": trocar o PDF entre o
 * preparar e o finalizar muda o hash e a asserção deixa de conferir.
 *
 * ## O que esta verificação NÃO prova
 *
 *   - **Não é PAdES/CAdES.** A assinatura cobre
 *     `authenticatorData || SHA-256(clientDataJSON)`, não os bytes do PDF. O
 *     documento não valida no Adobe por causa dela; o nível segue AVANÇADA
 *     (Lei 14.063/2020 art. 4º II). O caminho qualificado é o Token A3.
 *   - **Não prova hardware.** Sem atestação (usamos `attestation: 'none'`),
 *     "autenticador de plataforma" é declaração do cliente. Prova-se posse da
 *     chave e verificação do usuário, não a natureza do cofre que a guarda.
 *   - **Não prova o aparelho** quando a credencial é sincronizada — ver
 *     `descreverVinculoCredencial` em `authenticator-data.ts`.
 *
 * Só ES256 (ECDSA P-256, COSE alg -7). É o que os autenticadores de plataforma
 * de iOS e Android emitem, e o fluxo já está restrito a celular pela política
 * de dispositivo. Rejeitar o resto no REGISTRO (`registro.ts`) é melhor que
 * descobrir na hora de assinar, com a escala pronta e o policial em campo.
 */
import { ecdsaAsn1ToP1363 } from '../crypto-verify';
import { bytesToBinString, bytesToBase64Url } from '$lib/crypto/bin';
import { lerAuthenticatorData, type AuthenticatorData } from './authenticator-data';
import { logger } from '../../logger';
import { mensagemDeErro } from '$lib/utils/erro';

/** Coordenada da P-256: 32 bytes para r e 32 para s. */
const COORD_LEN_P256 = 32;

export interface EntradaAssercao {
	/** `clientDataJSON` cru, como bytes (não a string decodificada). */
	clientDataJSON: Uint8Array;
	authenticatorData: Uint8Array;
	/** Assinatura em ASN.1 DER, como o autenticador devolve. */
	assinatura: Uint8Array;
	/** Chave pública registrada, em SPKI (o que `getPublicKey()` devolveu). */
	publicKeySpki: Uint8Array;
	/** Bytes do desafio esperado — o hash do PDF preparado. */
	desafioEsperado: Uint8Array;
	/** Origem canônica do app (`resolverAppOrigin`), ex.: `https://escalas.pc.ce.gov.br`. */
	origemEsperada: string;
	/** Contador gravado no registro anterior; a asserção não pode regredir. */
	contadorArmazenado: number;
}

type MotivoRecusa =
	| 'client-data-invalido'
	| 'tipo-divergente'
	| 'desafio-divergente'
	| 'origem-divergente'
	| 'rp-id-divergente'
	| 'usuario-nao-verificado'
	| 'contador-regredido'
	| 'assinatura-invalida';

export type ResultadoAssercao =
	{ ok: true; dados: AuthenticatorData } | { ok: false; motivo: MotivoRecusa };

/** Mensagem para o assinante. Genérica de propósito: o detalhe vai para o log. */
export function mensagemRecusaAssercao(): string {
	return (
		'Não foi possível confirmar a assinatura pelo seu celular. ' +
		'Refaça a operação; se persistir, registre novamente sua chave de assinatura no Perfil.'
	);
}

/**
 * Confere a asserção contra o desafio, a origem e a credencial registrada.
 *
 * Nunca lança: qualquer erro vira `{ ok: false }` com o motivo — a mesma
 * disciplina de falha fechada de `crypto-verify`.
 */
export async function verificarAssercao(entrada: EntradaAssercao): Promise<ResultadoAssercao> {
	let clientData: { type?: string; challenge?: string; origin?: string };
	try {
		clientData = JSON.parse(new TextDecoder().decode(entrada.clientDataJSON));
	} catch {
		return recusar('client-data-invalido');
	}

	// 1. Tipo. `webauthn.create` é registro; aceitá-lo aqui permitiria usar uma
	//    cerimônia de cadastro como se fosse de assinatura.
	if (clientData.type !== 'webauthn.get') return recusar('tipo-divergente');

	// 2. Desafio: o hash do PDF que o servidor preparou. Sem isto a asserção
	//    prova autenticação, não afirmação DESTE documento.
	if (clientData.challenge !== bytesToBase64Url(entrada.desafioEsperado)) {
		return recusar('desafio-divergente');
	}

	// 3. Origem — impede que uma asserção obtida em outro domínio (phishing,
	//    ambiente de preview) valha na produção.
	if (clientData.origin !== entrada.origemEsperada) return recusar('origem-divergente');

	let dados: AuthenticatorData;
	try {
		dados = lerAuthenticatorData(entrada.authenticatorData);
	} catch {
		return recusar('client-data-invalido');
	}

	// 4. RP ID: o autenticador assina o hash do domínio para o qual a credencial
	//    foi criada. Confere contra a origem canônica — é a checagem que o
	//    navegador já fez, refeita no servidor porque o cliente não é confiável.
	const rpIdEsperado = new URL(entrada.origemEsperada).hostname;
	const rpIdHashEsperado = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpIdEsperado))
	);
	if (!bytesIguais(dados.rpIdHash, rpIdHashEsperado)) return recusar('rp-id-divergente');

	// 5. Verificação do usuário. Sem UV a asserção prova posse de um aparelho
	//    desbloqueado, não a biometria do titular — e é a biometria que sustenta
	//    o "controle exclusivo" do art. 4º II "b".
	if (!dados.usuarioVerificado) return recusar('usuario-nao-verificado');

	// 6. Contador. Autenticador que não implementa manda 0 sempre; nesse caso
	//    não há o que comparar. Quando implementa, regressão indica clone.
	if (dados.contador !== 0 && dados.contador <= entrada.contadorArmazenado) {
		return recusar('contador-regredido');
	}

	// 7. A assinatura, por último: as checagens acima são baratas e recusam a
	//    maioria dos casos ruins antes de importar chave e verificar curva.
	const assinado = concatenar(
		entrada.authenticatorData,
		new Uint8Array(await crypto.subtle.digest('SHA-256', entrada.clientDataJSON as BufferSource))
	);

	try {
		const chave = await crypto.subtle.importKey(
			'spki',
			entrada.publicKeySpki as BufferSource,
			{ name: 'ECDSA', namedCurve: 'P-256' },
			false,
			['verify']
		);
		// O autenticador devolve DER; a Web Crypto exige r||s.
		const sig = ecdsaAsn1ToP1363(bytesToBinString(entrada.assinatura), COORD_LEN_P256);
		const valida = await crypto.subtle.verify(
			{ name: 'ECDSA', hash: 'SHA-256' },
			chave,
			sig as BufferSource,
			assinado as BufferSource
		);
		if (!valida) return recusar('assinatura-invalida');
	} catch (err) {
		logger.warn('[webauthn] falha ao verificar a asserção', {
			error: mensagemDeErro(err)
		});
		return recusar('assinatura-invalida');
	}

	return { ok: true, dados };
}

function recusar(motivo: MotivoRecusa): ResultadoAssercao {
	logger.warn('[webauthn] asserção recusada', { motivo });
	return { ok: false, motivo };
}

function bytesIguais(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

function concatenar(a: Uint8Array, b: Uint8Array): Uint8Array {
	const out = new Uint8Array(a.length + b.length);
	out.set(a, 0);
	out.set(b, a.length);
	return out;
}
