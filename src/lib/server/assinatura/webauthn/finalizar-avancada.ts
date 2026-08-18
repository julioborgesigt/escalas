/**
 * O passo de prova das quatro rotas `finalizar-assinatura-avancada` (escala,
 * GISE, presença e relatório por seccional): consumir a intenção, conferir que
 * a credencial é do TITULAR e verificar a asserção WebAuthn sobre o hash do PDF.
 *
 * Antes desta extração o bloco rodava copiado nas quatro, semanticamente
 * idêntico — a única diferença entre as cópias era a tag de log. É a
 * duplicação de maior consequência do projeto: aqui não se decide o que o
 * usuário PODE fazer, e sim se a assinatura é dele. Uma cópia que perdesse um
 * dos passos não devolveria erro nenhum — devolveria um documento assinado que
 * não deveria existir.
 *
 * A ORDEM é o contrato, e não é livre:
 *
 *   1. **intenção primeiro.** `consumirIntencaoAssinatura` queima o token e
 *      amarra ESTES bytes a ESTE ator e a ESTE alvo. Rodar a verificação
 *      criptográfica antes deixaria um oráculo: dá para testar asserções contra
 *      um PDF sem gastar a intenção.
 *   2. **titular depois.** Uma asserção VÁLIDA feita com a chave de outra
 *      pessoa, sobre o mesmo PDF (que é público), é criptograficamente
 *      perfeita. O que a recusa é o vínculo credencial↔dono — sem este passo, a
 *      assinatura de A vale como assinatura de B.
 *   3. **desafio = hash do PDF preparado.** O mesmo valor que a intenção
 *      guardou e que o passo 1 acabou de conferir contra estes bytes. Se o
 *      desafio viesse do cliente, assinar um PDF e enviar outro seria trivial.
 *   4. **origem e contador** ficam com `verificarAssercao` (anti-clonagem do
 *      autenticador e anti-phishing de origem).
 *
 * Devolve `{ ok: true }` com o contexto gravado pelo `preparar`, a credencial e
 * o `authenticatorData` — o chamador ainda precisa chamar `registrarUsoCredencial`,
 * de propósito: isso só acontece depois de o R2 estar confirmado, para não
 * avançar o contador de uma assinatura que vai falhar em seguida.
 */
import type { Database } from '$lib/db';
import { buscarCredencialPorId, passkeyMetaDeAssercao } from '$lib/db';
import { apiError, ErrorCode, badRequest, serverError } from '$lib/server/api';
import {
	consumirIntencaoAssinatura,
	mensagemRecusaIntencao,
	type AlvoAssinatura,
	type AtorAssinatura,
	type ContextoPreparo
} from '../intencao';
import { calcularHashBuffer, envComoRegistro } from '../document-utils';
import { verificarAssercao, mensagemRecusaAssercao } from './assercao';
import type { AuthenticatorData } from './authenticator-data';
import { credencialDoUsuario } from '$lib/server/auth/credencial';
import { resolverAppOrigin } from '$lib/server/app-origin';
import { base64ToBytes, base64UrlToBytes } from '$lib/crypto/bin';
import { hexToBytes } from '$lib/crypto/hex';

/** A asserção como ela chega do cliente — os quatro campos em base64url. */
export interface AssercaoRecebida {
	credentialId: string;
	clientDataJSON: string;
	authenticatorData: string;
	assinatura: string;
}

/**
 * O corpo validado das quatro rotas — é literalmente
 * `finalizarPasskeyEscalaSchema`, que elas já compartilham.
 */
export interface CorpoFinalizacao {
	intencao: string;
	preparedPdf: string;
	assercao: AssercaoRecebida;
}

type CredencialConferida = NonNullable<Awaited<ReturnType<typeof buscarCredencialPorId>>>;

export type ResultadoFinalizacao =
	| {
			ok: true;
			/** `verificacao_hash` do SERVIDOR — nomeia o objeto no R2 e o código de `/validar`. */
			verificacaoHash: string;
			/** Selfie, GPS e rubrica gravados pelo `preparar`. Nunca vêm do corpo. */
			contexto: Required<ContextoPreparo>;
			credencial: CredencialConferida;
			/** Os bytes do PDF preparado, já decodificados — o chamador sela sobre eles. */
			pdfBytes: Uint8Array;
			/**
			 * O `authenticatorData` verificado. Além do `contador` (que vai para
			 * `registrarUsoCredencial`), carrega o `backupAtivo` que o manifesto usa
			 * e alimenta `descreverVinculoCredencial` na auditoria.
			 */
			dados: AuthenticatorData;
	  }
	| { ok: false; recusa: Response };

/**
 * Executa os quatro passos de prova. Toda recusa já vem como `Response` pronta,
 * com o status que `e2e/autorizacao-negativa` distingue (400 ≠ 403 ≠ 500).
 *
 * @param logTag prefixo do `serverError` quando o hash do PDF é inválido —
 *   único ponto em que as quatro cópias diferiam.
 */
export async function conferirFinalizacaoPasskey(opts: {
	db: Database;
	/** `locals.usuario` já estreitado por `requireAuth`. O ATOR sai daqui. */
	usuario: NonNullable<App.Locals['usuario']>;
	alvo: AlvoAssinatura;
	corpo: CorpoFinalizacao;
	url: URL;
	platform: App.Platform | undefined;
	logTag: string;
}): Promise<ResultadoFinalizacao> {
	const { db, usuario, alvo, corpo, url, platform, logTag } = opts;
	const { intencao, assercao } = corpo;
	const pdfBytes = base64ToBytes(corpo.preparedPdf);

	// O ator é derivado, não recebido: as quatro rotas passavam
	// `{ id: u.id, tipo: u.tipo }` à mão, e um parâmetro a mais é um parâmetro a
	// mais para alguém preencher com o usuário errado.
	const ator: AtorAssinatura = { id: usuario.id, tipo: usuario.tipo };

	// 1. Intenção — queima o token e amarra bytes ↔ ator ↔ alvo.
	const consumo = await consumirIntencaoAssinatura(db, intencao, alvo, ator, pdfBytes);
	if (!consumo.ok) return { ok: false, recusa: badRequest(mensagemRecusaIntencao()) };

	// 2. A credencial precisa ser a do PRÓPRIO titular. Sem esta checagem, uma
	// asserção válida feita por outra pessoa (com a chave dela, sobre o mesmo
	// PDF público) seria aceita como assinatura desta.
	const credencial = await buscarCredencialPorId(db, assercao.credentialId);
	const dono = credencialDoUsuario(usuario);
	if (
		!credencial ||
		credencial.revogadaEm ||
		credencial.dono.tipo !== dono.tipo ||
		credencial.dono.id !== dono.id
	) {
		return {
			ok: false,
			recusa: apiError(
				'Chave de assinatura não reconhecida ou revogada. Registre-a novamente em Meu Perfil.',
				403,
				ErrorCode.FORBIDDEN
			)
		};
	}

	// 3. O desafio é o hash do PDF preparado — o mesmo valor que a intenção
	// guardou e que o passo 1 acabou de conferir contra estes bytes.
	const desafio = hexToBytes(await calcularHashBuffer(pdfBytes));
	if (!desafio) {
		return {
			ok: false,
			recusa: serverError(`[${logTag}] hash do PDF inválido`, new Error('HASH'))
		};
	}

	// 4. Assinatura, origem e contador.
	const verificacao = await verificarAssercao({
		clientDataJSON: base64UrlToBytes(assercao.clientDataJSON),
		authenticatorData: base64UrlToBytes(assercao.authenticatorData),
		assinatura: base64UrlToBytes(assercao.assinatura),
		publicKeySpki: credencial.publicKeySpki,
		desafioEsperado: desafio,
		origemEsperada: resolverAppOrigin(url, platform),
		contadorArmazenado: credencial.contador
	});
	if (!verificacao.ok) {
		return { ok: false, recusa: apiError(mensagemRecusaAssercao(), 403, ErrorCode.FORBIDDEN) };
	}

	return {
		ok: true,
		verificacaoHash: consumo.verificacaoHash,
		contexto: consumo.contexto,
		credencial,
		dados: verificacao.dados,
		pdfBytes
	};
}

/**
 * O ENVELOPE DE EVIDÊNCIA que acompanha o documento assinado: o que o
 * `preparar` guardou (selfie, GPS) mais o que a requisição do `finalizar`
 * observou (IP, user-agent) e o vínculo da credencial.
 *
 * Existe porque os sete campos saem TODOS de `prova` — nenhum vem do corpo — e
 * remontá-los à mão em cada rota é a chance de alguém ler `latitude` do
 * `request.json()` "porque estava ali". Selfie e GPS de assinatura são prova
 * de ato jurídico: a fonte tem de ser a intenção consumida, não o cliente.
 *
 * `env` sai do `platform` porque `persistirGiseAssinada` e
 * `persistirEscalaAssinada` precisam dele para o selo institucional.
 *
 * `passkeyMeta` é a **contraparte forense**: a asserção acabou de conferir ao
 * vivo, e sem gravá-la o manifesto afirmaria biometria que
 * `reconferirAssercaoDocumento` não teria como reconferir.
 *
 * `userAgent` vazio vira `undefined`, não `''`. As cópias divergiam nesse
 * ponto — escala usava `ua || undefined`, GISE usava `ua` — e a versão
 * cuidadosa é a certa: cabeçalho ausente é ausência de evidência, e gravar
 * string vazia numa coluna de prova afirma que se observou algo.
 */
export function evidenciasDaProva(
	prova: Extract<ResultadoFinalizacao, { ok: true }>,
	req: {
		ip?: string | null;
		userAgent?: string;
		platform: App.Platform | undefined;
		assercao: AssercaoRecebida;
	}
) {
	return {
		selfieKey: prova.contexto.selfieKey,
		ip: req.ip ?? undefined,
		userAgent: req.userAgent || undefined,
		latitude: prova.contexto.latitude,
		longitude: prova.contexto.longitude,
		env: envComoRegistro(req.platform),
		passkeyMeta: passkeyMetaDeAssercao(req.assercao, prova.dados.backupAtivo)
	};
}
