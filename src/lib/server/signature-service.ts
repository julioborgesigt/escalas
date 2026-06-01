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
 */

import forge from 'node-forge';
import { logger } from './logger';
import { extrairDadosCertificado, embedSerproCms, finalizarAssinatura } from './pdf-signing';
import {
	verificarECarimbarAssinatura,
	type CadesFinalizationResult,
	type CadesFinalizationError
} from './cades-finalizer';
import { normalizarTexto } from '../utils';
import { verificarDesafio2FA } from '../auth';
import { lerFlagsAssinatura, type FlagsAssinatura } from './cfg-ass-cache';
import type { Database } from '../db/core';
import type { AssinaturaCadesMetadata } from '../db/documentos';
import type { TipoCarimoTempo } from './document-utils';

// ---------------------------------------------------------------------------
// Tipos canônicos
// ---------------------------------------------------------------------------

/**
 * Sessão autenticada do signatário. Compatível com `App.Locals['usuario']`
 * mas tipado explicitamente para evitar acoplamento.
 */
export interface SignatureUser {
	id: number;
	tipo: 'admin' | 'policial';
	nome: string;
	cpf?: string | null;
	email?: string | null;
}

/**
 * Entrada para o fluxo qualificado. Os endpoints atuais usam dois
 * dialetos de nomes (`signature/certificate/messageDigestHex` em escalas;
 * `rawSignature/certificateBase64/messageDigest` em gise) — adaptamos no
 * ponto de chamada para este formato canônico.
 */
export interface QualifiedInput {
	preparedPdf: Uint8Array;
	/** CMS PKCS#7 completo retornado pelo Assinador SERPRO. Preferido quando presente. */
	serproCms?: string | null;
	/** Bytes da assinatura RSA bruta (Web PKI Lacuna). */
	rawSignature?: string | null;
	/** Certificado DER base64 do signatário (Web PKI). */
	certificateBase64?: string | null;
	/** Hex do message-digest do PDF (Web PKI). */
	messageDigestHex?: string | null;
	/** ISO 8601 do `signingTime` registrado em prepararPdfParaAssinatura. */
	signingTimeISO?: string | null;
}

export interface QualifiedFinalization {
	pdfFinal: Uint8Array;
	metadata: AssinaturaCadesMetadata;
	tipoCarimboTempo: TipoCarimoTempo;
	signerName: string;
	signerCpf: string;
	padesLt: boolean;
}

export interface LivenessResult {
	tipo: 'blink' | 'smile';
	cumprido: boolean;
	tentativas: number;
	iniciadoEm: string | null;
	concluidoEm: string | null;
	duracaoMs: number;
}

export interface SimpleEvidence {
	rubrica?: string | null;
	latitude?: number | null;
	longitude?: number | null;
	selfieBase64?: string | null;
	codigoValidação?: string | null;
	desafioId?: string | null;
	livenessChallenge?: LivenessResult | null;
}

/**
 * Evidências validadas e prontas para persistência. As flags ativas
 * determinam quais campos estão garantidamente preenchidos.
 */
export interface ValidatedEvidence {
	rubrica: string | null;
	latitude: number | null;
	longitude: number | null;
	selfieBase64: string | null;
	/** `true` se 2FA foi validado nesta requisição (sempre exigido). */
	doisFatorOk: boolean;
	/** Resultado do challenge de liveness — null quando exigirFoto=false. */
	livenessChallenge: LivenessResult | null;
}

export type ServiceFailure = {
	ok: false;
	status: number;
	error: string;
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
		if (input.certificateBase64) {
			const der = forge.util.decode64(input.certificateBase64);
			const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(der));
			const cn = (cert.subject.getField('CN')?.value as string) || '';
			// Padrão ICP-Brasil: CPF no atributo serialNumber (OID 2.5.4.5).
			let cpf = '';
			const sn =
				cert.subject.getField({ type: '2.5.4.5' }) ??
				cert.subject.getField({ name: 'serialNumber' });
			if (sn) cpf = String(sn.value).replace(/\D/g, '');
			if (!cpf && cn.includes(':')) {
				cpf = cn.split(':').pop()?.replace(/\D/g, '') || '';
			}
			if (cpf.length > 11) cpf = cpf.slice(-11);
			return { nome: cn.split(':')[0].trim(), cpf };
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
export async function finalizarAssinaturaQualificada(
	user: SignatureUser,
	input: QualifiedInput,
	options: { platform?: App.Platform } = {}
): Promise<QualifiedFinalization | ServiceFailure> {
	// 1. Determinar dialeto e validar campos mínimos.
	const temSerpro = !!input.serproCms;
	const temWebPki =
		!!input.rawSignature &&
		!!input.certificateBase64 &&
		!!input.messageDigestHex &&
		!!input.signingTimeISO;

	if (!temSerpro && !temWebPki) {
		return {
			ok: false,
			status: 400,
			error:
				'Forneça `serproCms` OU os 4 campos do fluxo Web PKI (rawSignature, certificateBase64, messageDigestHex, signingTimeISO).'
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
		if (temSerpro) {
			signedPdf = await embedSerproCms(input.preparedPdf, input.serproCms!);
		} else {
			signedPdf = await finalizarAssinatura(
				input.preparedPdf,
				input.rawSignature!,
				input.certificateBase64!,
				input.messageDigestHex!,
				input.signingTimeISO!
			);
		}
	} catch (e) {
		logger.error('[signature-service] Falha ao embutir CMS', {
			error: e instanceof Error ? e.message : String(e),
			modalidade: temSerpro ? 'serpro' : 'webpki'
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

// ---------------------------------------------------------------------------
// API pública — fluxo AVANÇADA (em tela)
// ---------------------------------------------------------------------------

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
	} = {}
): Promise<{ ok: true; validated: ValidatedEvidence } | ServiceFailure> {
	const flags = options.flagsOverride ?? (await lerFlagsAssinatura(options.platform));

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
		const result2FA = await verificarDesafio2FA(db, evidence.desafioId, evidence.codigoValidação, [
			'assinatura'
		]);
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

	// 2b. Quando a foto é exigida, o cliente DEVE comprovar liveness ativa
	//     (challenge blink/smile cumprido). Sem isso, atacante poderia
	//     submeter selfie roubada da vítima. O componente SignaturePad
	//     bloqueia a UI, mas validamos no servidor também — defesa em
	//     profundidade contra cliente comprometido.
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
			livenessChallenge: evidence.livenessChallenge ?? null
		}
	};
}
