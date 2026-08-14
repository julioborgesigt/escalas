/**
 * Serviço unificado de finalização de assinaturas — escalas, GISE diária e
 * relatórios extraordinários compartilham a mesma orquestração.
 *
 * Antes desta consolidação, os 6 endpoints (3 finalizar-assinatura
 * qualificada + 3 assinar-simples) duplicavam a lógica de:
 *   - validação CPF do token vs CPF do usuário logado
 *   - aplicação de flags de evidência (foto / GPS / 2FA)
 *   - chamada de `verificarECarimbarAssinatura` (CAdES-LT)
 *   - extração de dados do certificado
 *
 * A duplicação introduziu drift (vide PRs anteriores):
 *   - admin geral dispensado da checagem CPF em escalas, mas não em GISE
 *   - escala mensal ignorava `exigirFotoAssinatura` e
 *     `exigirCodigoEmailAssinatura` mesmo com as flags ligadas no admin
 *
 * Este módulo é a fonte única de verdade. Política aplicada:
 *
 *   1. **NÃO há bypass para admin geral** — todo signatário precisa ter CPF
 *      cadastrado e o CPF do token deve bater. Admins antigos sem CPF devem
 *      cadastrar antes de assinar.
 *
 *   2. **2FA por e-mail é sempre obrigatório** na modalidade avançada
 *      (vide `signature-level.ts`). O cliente que enviar `assinar-simples`
 *      sem `codigoValidação` recebe 400 — independente do endpoint chamado.
 *
 *   3. **Demais flags** (foto, GPS, restringir-smartphone) são reforços
 *      controlados pelo admin via /conf-ass; aplicam-se uniformemente aos
 *      3 fluxos (escala mensal, GISE diária, relatório extra).
 *
 *   4. **`restringirSmartphone` recusa no servidor**, não só na tela — vide
 *      `recusadaPorPoliticaDispositivo`. Só no caminho AVANÇADO: o Token A3
 *      é desktop por projeto.
 */

import { logger } from '../logger';
import { extrairDadosCertificado, embedSerproCms } from './pdf-signing';
import {
	verificarECarimbarAssinatura,
	type CadesFinalizationResult,
	type CadesFinalizationError
} from './cades-finalizer';
import { normalizarTexto } from '../../utils/formato';
import { verificarDesafio2FA } from '../../auth';
import { lerFlagsAssinatura, type FlagsAssinatura } from './cfg-ass-cache';
import { apiError, ErrorCode, contentDisposition } from '../api';
import type { Database } from '../../db/core';
import type { AssinaturaCadesMetadata } from '../../db/documentos';
import { calcularHashBuffer, ehDispositivoMovelUA, type TipoCarimoTempo } from './document-utils';

// ---------------------------------------------------------------------------
// Tipos canônicos
// ---------------------------------------------------------------------------

/**
 * Sessão autenticada do signatário. Compatível com `App.Locals['usuario']`
 * mas tipado explicitamente para evitar acoplamento.
 */
interface SignatureUser {
	id: number;
	tipo: 'admin' | 'policial';
	nome: string;
	cpf?: string | null;
	email?: string | null;
}

interface QualifiedInput {
	preparedPdf: Uint8Array;
	/** CMS PKCS#7 completo retornado pelo Assinador SERPRO. */
	serproCms?: string | null;
	/** Hex do message-digest do PDF (opcional — usado na verificação). */
	messageDigestHex?: string | null;
	/** ISO 8601 do `signingTime` registrado em prepararPdfParaAssinatura. */
	signingTimeISO?: string | null;
}

interface QualifiedFinalization {
	pdfFinal: Uint8Array;
	metadata: AssinaturaCadesMetadata;
	tipoCarimboTempo: TipoCarimoTempo;
	signerName: string;
	signerCpf: string;
	padesLt: boolean;
}

interface LivenessResult {
	tipo: 'blink' | 'smile' | 'head_turn';
	cumprido: boolean;
	tentativas: number;
	iniciadoEm: string | null;
	concluidoEm: string | null;
	duracaoMs: number;
}

interface SimpleEvidence {
	rubrica?: string | null;
	latitude?: number | null;
	longitude?: number | null;
	selfieBase64?: string | null;
	codigoValidação?: string | null;
	desafioId?: string | null;
	livenessChallenge?: LivenessResult | null;
	/** `user-agent` da requisição — insumo da política `restringirSmartphone`. */
	userAgent?: string | null;
}

/**
 * Evidências validadas e prontas para persistência. As flags ativas
 * determinam quais campos estão garantidamente preenchidos.
 */
interface ValidatedEvidence {
	rubrica: string | null;
	latitude: number | null;
	longitude: number | null;
	selfieBase64: string | null;
	/** `true` se 2FA foi validado nesta requisição (sempre exigido). */
	doisFatorOk: boolean;
	/**
	 * `true` quando a política `restringirSmartphone` estava ativa e o UA passou
	 * pelo gate. Devolvido aqui para o endpoint registrar no manifesto sem uma
	 * segunda leitura de flags (que poderia divergir da que de fato decidiu).
	 */
	politicaDispositivoMovel: boolean;
	/**
	 * `true` quando o reforço de passkey está ativo. Quem prepara usa para saber
	 * que precisa da cerimônia biométrica antes de finalizar; devolver a flag
	 * daqui evita uma segunda leitura, que poderia divergir da que decidiu.
	 */
	exigePasskey: boolean;
	/** Resultado do challenge de liveness — null quando exigirFoto=false. */
	livenessChallenge: LivenessResult | null;
}

type ServiceFailure = {
	ok: false;
	status: number;
	error: string;
	/**
	 * Categoria do erro quando não é `VALIDATION`. Os call sites fazem
	 * `apiError(evid.error, evid.status, evid.code ?? ErrorCode.VALIDATION)` —
	 * sem isto, a recusa por política de dispositivo (403) chegaria ao cliente
	 * rotulada como erro de validação de corpo.
	 */
	code?: ErrorCode;
};

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Extrai nome e CPF do certificado/CMS para validação cruzada com a sessão.
 */
function extrairDadosToken(input: QualifiedInput): { nome: string; cpf: string } | null {
	try {
		if (input.serproCms) {
			return extrairDadosCertificado(input.serproCms);
		}
		return null;
	} catch (e) {
		logger.warn('[signature-service] Falha ao extrair dados do token', {
			error: e instanceof Error ? e.message : String(e)
		});
		return null;
	}
}

/**
 * Valida que o token pertence ao usuário logado.
 *
 * Política única (sem bypass para admin):
 *   - Usuário precisa ter CPF cadastrado;
 *   - CPF do certificado deve bater com o CPF cadastrado;
 *   - Nome no certificado, se presente, deve bater (normalização sem acentos).
 *
 * O conceito anterior de "admin geral dispensado" foi removido: ele permitia
 * que um admin com acesso ao token de um terceiro assinasse "em nome de"
 * sem aviso, quebrando accountability. Admin que precise assinar deve ter
 * CPF cadastrado e usar seu próprio token.
 */
function validarPropriedadeToken(
	user: SignatureUser,
	dadosToken: { nome: string; cpf: string }
): ServiceFailure | null {
	if (!user.cpf) {
		return {
			ok: false,
			status: 400,
			error:
				'Seu cadastro não possui CPF — não é possível validar a propriedade do certificado. ' +
				'Cadastre o CPF no seu perfil antes de assinar.'
		};
	}
	if (dadosToken.cpf !== user.cpf) {
		return {
			ok: false,
			status: 400,
			error: 'O token não pertence ao usuário logado (CPF incompatível).'
		};
	}
	const nomeLogado = normalizarTexto(user.nome);
	const nomeToken = normalizarTexto(dadosToken.nome);
	if (nomeLogado && nomeToken && nomeToken !== nomeLogado) {
		return {
			ok: false,
			status: 400,
			error: 'O token não pertence ao usuário logado (Nome incompatível).'
		};
	}
	return null;
}

// ---------------------------------------------------------------------------
// API pública — fluxo QUALIFICADA (Web PKI / SERPRO)
// ---------------------------------------------------------------------------

/**
 * Embute o CMS no PDF preparado, valida propriedade do token contra o
 * usuário logado e finaliza a verificação CAdES-LT (cadeia ICP-Brasil,
 * RSA, integridade, OCSP, PAdES-LT DSS).
 *
 * Retorna o PDF final pronto para persistir no R2 + metadados para o banco.
 *
 * O caller é responsável por:
 *   - chamar `requireAuth` antes (passa `user`);
 *   - aplicar permissões de negócio (`verificarPermissaoEscala`, supervisor_id);
 *   - persistir o resultado (R2 + tabela de documentos);
 *   - registrar audit log.
 */
async function finalizarAssinaturaQualificada(
	user: SignatureUser,
	input: QualifiedInput,
	options: { platform?: App.Platform } = {}
): Promise<QualifiedFinalization | ServiceFailure> {
	// 1. Validar campo mínimo (apenas SERPRO é suportado).
	if (!input.serproCms) {
		return {
			ok: false,
			status: 400,
			error: 'Forneça o campo `serproCms` retornado pelo Assinador SERPRO.'
		};
	}

	// 2. Extrair dados do token e validar propriedade.
	const dadosToken = extrairDadosToken(input);
	if (dadosToken) {
		const erro = validarPropriedadeToken(user, dadosToken);
		if (erro) return erro;
	}

	// 3. Embutir CMS no PDF preparado.
	let signedPdf: Uint8Array;
	try {
		signedPdf = await embedSerproCms(input.preparedPdf, input.serproCms);
	} catch (e) {
		logger.error('[signature-service] Falha ao embutir CMS SERPRO', {
			error: e instanceof Error ? e.message : String(e)
		});
		return {
			ok: false,
			status: 500,
			error: 'Falha ao embutir assinatura no PDF preparado.'
		};
	}

	// 4. Verificar criptograficamente (CAdES-LT + OCSP + DSS).
	// Repassa o env para que o verifier possa rejeitar quando o trust store
	// ICP-Brasil estiver vazio e a env ICP_BRASIL_TRUST_STORE_REQUIRED=true.
	const env = options.platform?.env as unknown as Record<string, string | undefined> | undefined;
	const verif: CadesFinalizationResult | CadesFinalizationError =
		await verificarECarimbarAssinatura(signedPdf, { env });
	if (!verif.ok) {
		return {
			ok: false,
			status: verif.status,
			error: verif.error
		};
	}

	return {
		pdfFinal: verif.pdfFinal,
		metadata: verif.metadata,
		tipoCarimboTempo: verif.tipoCarimboTempo,
		signerName: verif.signerName || dadosToken?.nome || user.nome,
		signerCpf: verif.signerCpf || dadosToken?.cpf || user.cpf || '',
		padesLt: verif.padesLt
	};
}

/**
 * Variante de conveniência dos endpoints `finalizar-assinatura`: recebe o
 * payload base64 já validado pelo schema Zod, executa a finalização
 * qualificada e calcula o SHA-256 do PDF final (o `arquivo_hash` que a
 * página /validar reconfere — nunca o hash enviado pelo cliente, A4).
 *
 * Em falha devolve a `Response` de erro pronta, com o mapeamento único
 * status ≥ 500 → UPSTREAM / senão VALIDATION — antes copiado em 4 endpoints
 * (escala, GISE diária, presença e relatório extraordinário).
 */
export async function finalizarQualificadaDoPayload(
	user: SignatureUser,
	payload: {
		preparedPdf: string;
		serproCms?: string | null;
		messageDigestHex?: string | null;
		signingTimeISO?: string | null;
	},
	options: { platform?: App.Platform } = {}
): Promise<
	{ ok: false; response: Response } | ({ ok: true; arquivoHash: string } & QualifiedFinalization)
> {
	const result = await finalizarAssinaturaQualificada(
		user,
		{
			preparedPdf: new Uint8Array(Buffer.from(payload.preparedPdf, 'base64')),
			serproCms: payload.serproCms,
			messageDigestHex: payload.messageDigestHex,
			signingTimeISO: payload.signingTimeISO
		},
		options
	);
	if (!('pdfFinal' in result)) {
		const code = result.status >= 500 ? ErrorCode.UPSTREAM : ErrorCode.VALIDATION;
		return { ok: false, response: apiError(result.error, result.status, code) };
	}
	return { ok: true, arquivoHash: await calcularHashBuffer(result.pdfFinal), ...result };
}

/** Resposta binária padrão dos endpoints que devolvem o PDF assinado. */
export function respostaPdfAssinado(pdf: Uint8Array, filename: string): Response {
	return new Response(pdf as unknown as BodyInit, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': contentDisposition(filename)
		}
	});
}

// ---------------------------------------------------------------------------
// API pública — fluxo AVANÇADA (em tela)
// ---------------------------------------------------------------------------

/**
 * Mensagem única da recusa por política de dispositivo. Fica aqui porque três
 * chamadores a usam (este serviço e as duas actions de presença em
 * `res-gise/+page.server.ts`) e porque o texto é lido pelo assinante em campo:
 * precisa dizer o que fazer, não só que falhou.
 */
export const ERRO_POLITICA_DISPOSITIVO =
	'Esta assinatura só pode ser feita pelo celular. Abra o sistema no seu ' +
	'aparelho móvel e repita a operação. (No iPad, use o navegador em tela cheia.)';

/**
 * Aplica a política `restringirSmartphone` sobre o user-agent da requisição.
 *
 * Vale só para a assinatura AVANÇADA (em tela). O caminho QUALIFICADO (Token
 * A3 ICP-Brasil) roda no desktop por projeto — é o que `SecaoAssinaturas` e
 * `docs/QA_ASSINATURA_A3_DESKTOP.md` desenham: com a restrição ligada, o
 * desktop deixa de oferecer a rubrica e passa a oferecer o token. Estender
 * este gate aos endpoints `finalizar-assinatura` derrubaria o fluxo que a
 * própria restrição existe para induzir. Não é inconsistência a "consertar".
 *
 * @returns `true` quando a assinatura deve ser recusada.
 */
export function recusadaPorPoliticaDispositivo(
	flags: Pick<FlagsAssinatura, 'restringirSmartphone'>,
	userAgent: string | null | undefined
): boolean {
	return flags.restringirSmartphone && !ehDispositivoMovelUA(userAgent ?? '');
}

/**
 * Valida as evidências enviadas pelo cliente contra as flags efetivas
 * (lidas server-side via Cache API). Aplica uniformemente em todos os
 * 3 fluxos (escala/GISE/relatório), eliminando o drift histórico.
 *
 * Aceita um `platform` opcional para resolver as flags. Em testes, pode-se
 * injetar `flagsOverride` diretamente.
 */
export async function validarEvidenciasAvancada(
	db: Database,
	user: SignatureUser,
	evidence: SimpleEvidence,
	options: {
		platform?: App.Platform;
		flagsOverride?: FlagsAssinatura;
		/**
		 * Recusar quando o reforço de passkey estiver ativo — para o endpoint de
		 * UM TIRO, que não faz cerimônia biométrica.
		 *
		 * Não é padrão porque só a ESCALA tem caminho de passkey hoje: ligar para
		 * GISE, relatório e presença deixaria a corporação sem assinar. E o
		 * `preparar` da escala, que É o caminho da passkey, obviamente não passa
		 * `true` aqui.
		 */
		recusarSePasskeyExigida?: boolean;
	} = {}
): Promise<{ ok: true; validated: ValidatedEvidence } | ServiceFailure> {
	const flags = options.flagsOverride ?? (await lerFlagsAssinatura(options.platform));

	// 0. Política de dispositivo — a restrição a celular RECUSA aqui, não só na
	//    tela. Até ago/2026 `restringirSmartphone` era a única flag de assinatura
	//    decidida no cliente (as outras saíram de lá quando o cookie `cfg_ass`
	//    editável no devtools desligava selfie/GPS/2FA — vide `cfg-ass-cache.ts`);
	//    um POST direto de um desktop assinava normalmente enquanto o painel do
	//    admin anunciava garantia de dispositivo móvel. Prometer no manifesto o
	//    que não se verifica contamina, em perícia, a credibilidade das demais
	//    evidências do documento.
	if (recusadaPorPoliticaDispositivo(flags, evidence.userAgent)) {
		return {
			ok: false,
			status: 403,
			error: ERRO_POLITICA_DISPOSITIVO,
			code: ErrorCode.FORBIDDEN
		};
	}

	// 0b. Reforço de passkey: o caminho de um tiro morre aqui, ANTES do 2FA —
	//     recusar depois queimaria uma tentativa do código de quem ia ser
	//     barrado de qualquer forma. Reforço contornável por POST direto no
	//     endpoint antigo não é reforço; é a forma exata da falha que a política
	//     de dispositivo tinha enquanto vivia só na tela.
	if (options.recusarSePasskeyExigida && flags.exigirPasskeyAssinatura) {
		return {
			ok: false,
			status: 403,
			error:
				'Esta escala exige assinatura com a chave do seu celular. ' +
				'Use o fluxo de assinatura por chave (passkey).',
			code: ErrorCode.FORBIDDEN
		};
	}

	// 1. 2FA por e-mail — sempre obrigatório (requisito mínimo Lei 14.063 art. 4º II "b").
	//    A flag `exigirCodigoEmailAssinatura` é forçada para `true` pelo
	//    endpoint PUT /api/configuracoes/assinatura. Tratamos defensivamente
	//    aqui também, caso alguma migração futura vire a flag.
	if (!flags.exigirCodigoEmailAssinatura) {
		logger.warn(
			'[signature-service] exigirCodigoEmailAssinatura está desligado — assinatura cairá para nível SIMPLES',
			{ userId: user.id }
		);
	}
	if (flags.exigirCodigoEmailAssinatura) {
		if (!evidence.codigoValidação || !evidence.desafioId) {
			return {
				ok: false,
				status: 400,
				error:
					'Código de verificação por e-mail é obrigatório para esta assinatura (Lei 14.063/2020 art. 4º II).'
			};
		}
		// `markUsed: false` — o código de assinatura é reutilizável dentro da sua
		// janela de validade (10 min), permitindo assinar VÁRIOS relatórios/escalas
		// na mesma sessão (lote) com um único código. Antes, o desafio era consumido
		// na 1ª assinatura e a 2ª falhava com "código inválido".
		const result2FA = await verificarDesafio2FA(
			db,
			evidence.desafioId,
			evidence.codigoValidação,
			['assinatura'],
			'',
			{ markUsed: false }
		);
		if (result2FA === 'expirado') {
			return { ok: false, status: 400, error: 'O código de verificação expirou.' };
		}
		if (result2FA === 'esgotado') {
			return {
				ok: false,
				status: 400,
				error: 'Muitas tentativas. Solicite um novo código.'
			};
		}
		if (!result2FA) {
			return { ok: false, status: 400, error: 'Código de verificação inválido.' };
		}
		if (result2FA.usuarioId !== user.id) {
			return {
				ok: false,
				status: 403,
				error: 'Código não pertence ao usuário logado.'
			};
		}
	}

	// 2. Selfie (foto com liveness) — reforço opcional, mas se a flag estiver
	//    ligada o cliente deve enviar.
	if (flags.exigirFotoAssinatura && !evidence.selfieBase64) {
		return {
			ok: false,
			status: 400,
			error: 'Selfie é obrigatória para esta assinatura.'
		};
	}

	// 2b. Liveness ativo (challenge blink/smile). Fronteira de garantia
	//     (auditoria A2 — decisão de produto "Nível 0"): o veredito blink/smile
	//     é calculado NO CLIENTE (face-api); aqui o servidor só confere
	//     consistência estrutural e temporal (cumprido + duração plausível) e
	//     NÃO re-verifica a imagem. Isso eleva a barra contra selfie estática e
	//     apresentação à câmera, mas NÃO resiste a um cliente adulterado que
	//     forje o payload — nada client-side resiste. É um REFORÇO da assinatura
	//     AVANÇADA (Lei 14.063/2020 art. 4º II), não prova de identidade forte:
	//     o não-repúdio pleno vem da QUALIFICADA via Token A3 (ICP-Brasil), já
	//     disponível no sistema. Endurecer exigiria PAD/liveness server-side
	//     certificado (serviço externo) — fora do escopo desta decisão.
	if (flags.exigirFotoAssinatura) {
		const ch = evidence.livenessChallenge;
		if (!ch) {
			return {
				ok: false,
				status: 400,
				error:
					'Comprovação de presença ativa ausente (liveness challenge). ' +
					'Atualize a aplicação cliente.'
			};
		}
		if (!ch.cumprido) {
			return {
				ok: false,
				status: 400,
				error: `Desafio de presença não cumprido (${ch.tipo}). Tente novamente.`
			};
		}
		// Sanity check: challenge "cumprido" instantâneo é suspeito (foto pré-fabricada
		// com payload falsificado). Exigimos ao menos 500 ms entre início e conclusão.
		if (ch.duracaoMs < 500) {
			return {
				ok: false,
				status: 400,
				error: 'Desafio de presença concluído em tempo implausível.'
			};
		}
	}

	// 3. GPS — reforço opcional.
	if (
		flags.exigirGpsAssinatura &&
		(typeof evidence.latitude !== 'number' || typeof evidence.longitude !== 'number')
	) {
		return {
			ok: false,
			status: 400,
			error: 'Coordenadas GPS são obrigatórias para esta assinatura.'
		};
	}

	// 4. Rubrica — atualmente todos os endpoints exigem rubrica para assinatura
	//    em tela (é o elemento gráfico que vai no PDF). Mantemos como obrigatória.
	if (!evidence.rubrica || evidence.rubrica.trim().length === 0) {
		return {
			ok: false,
			status: 400,
			error: 'Rubrica é obrigatória para assinatura em tela.'
		};
	}

	return {
		ok: true,
		validated: {
			rubrica: evidence.rubrica,
			latitude: typeof evidence.latitude === 'number' ? evidence.latitude : null,
			longitude: typeof evidence.longitude === 'number' ? evidence.longitude : null,
			selfieBase64: evidence.selfieBase64 ?? null,
			doisFatorOk: !!flags.exigirCodigoEmailAssinatura,
			politicaDispositivoMovel: flags.restringirSmartphone,
			exigePasskey: flags.exigirPasskeyAssinatura,
			livenessChallenge: evidence.livenessChallenge ?? null
		}
	};
}
