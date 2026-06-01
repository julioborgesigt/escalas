/**
 * Schemas Zod para os endpoints de assinatura PDF.
 *
 * Antes esses endpoints faziam `await request.json()` cru e pegavam até 15
 * campos sem validação. Riscos:
 *  - `parseInt(null)` virando NaN silencioso;
 *  - latitudes/longitudes fora de faixa;
 *  - payloads gigantes consumindo CPU do Worker (Erro 1102 em Cloudflare);
 *  - exceptions não tratadas vazando para o handleError.
 *
 * Cada schema reflete EXATAMENTE os campos que o endpoint historicamente lê,
 * preservando o contrato com os clientes existentes (Web PKI / SERPRO / app).
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Building blocks reutilizáveis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helpers que aceitam `null` como entrada (clientes JS frequentemente serializam
 * `undefined` como `null`) mas devolvem `undefined` para a aplicação — assim
 * o tipo final é `T | undefined`, compatível com as assinaturas existentes
 * dos helpers de PDF/DB.
 */
/** Exportado para reutilizar em outros schemas (ex.: `giseSignatureSchema`) sem duplicar lógica. */
export const optionalNullable = <T extends z.ZodTypeAny>(schema: T) =>
	schema.nullish().transform((v) => v ?? undefined);

/** Latitude WGS-84. Aceita número, null ou ausente — devolve `number | undefined`. */
const latitudeSchema = optionalNullable(z.number().min(-90).max(90));
/** Longitude WGS-84. */
const longitudeSchema = optionalNullable(z.number().min(-180).max(180));

/** Imagem em data URL base64 (rubrica desenhada ou selfie). Limite 5 MB. */
const dataUrlImagemSchema = optionalNullable(
	z
		.string()
		.max(5 * 1024 * 1024, 'Imagem muito grande (máx 5 MB)')
		.regex(/^data:image\/(png|jpe?g|webp);base64,/, 'Imagem deve ser data URL base64')
);

/** PDF em base64 puro (sem prefixo data URL). Limite 10 MB → ~7.5 MB binário. */
const pdfBase64Schema = z
	.string()
	.min(100, 'PDF inválido')
	.max(10 * 1024 * 1024, 'PDF muito grande (máx 10 MB)');

/** Hash hexadecimal (document hash, message digest). */
const hashHexSchema = z
	.string()
	.regex(/^[0-9a-fA-F]+$/, 'Hash deve ser hexadecimal')
	.min(8)
	.max(128);

/** Código de verificação gerado por gerarCodigoValidacao(): formato "XXXX-XXXX". */
const codigoVerificacaoSchema = z
	.string()
	.regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'Código de verificação inválido')
	.max(9);

/** ISO 8601 timestamp string. */
const isoTimestampSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'signingTime deve ser ISO 8601')
	.max(40);

/** Nome humano (signer). */
const nomeAssinanteSchema = optionalNullable(z.string().trim().max(200));
/** CPF — só dígitos ou formatado, sem validar dígito verificador (vem do certificado). */
const cpfAssinanteSchema = optionalNullable(z.string().trim().max(20));
/** E-mail (best effort — usado só para registrar contexto). */
const emailAssinanteSchema = optionalNullable(z.string().trim().email('E-mail inválido').max(200));

/** Base64 padrão. */
const base64Schema = z
	.string()
	.regex(/^[A-Za-z0-9+/=]+$/, 'Esperado base64')
	.max(20 * 1024 * 1024);

// ─────────────────────────────────────────────────────────────────────────────
// PREPARAR-ASSINATURA — comum a escalas / gise / gise/relatorios
// ─────────────────────────────────────────────────────────────────────────────

export const prepararAssinaturaSchema = z.object({
	signerName: nomeAssinanteSchema,
	signerCpf: cpfAssinanteSchema,
	rubrica: dataUrlImagemSchema,
	latitude: latitudeSchema,
	longitude: longitudeSchema
});
export type PrepararAssinaturaInput = z.infer<typeof prepararAssinaturaSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// FINALIZAR-ASSINATURA — escalas (usa nomes "signature" / "certificate" / "messageDigestHex")
// ─────────────────────────────────────────────────────────────────────────────

export const finalizarAssinaturaEscalasSchema = z.object({
	preparedPdf: pdfBase64Schema,
	serproCms: optionalNullable(base64Schema),
	/** SERPRO devolve um JSON arbitrário; só guardamos para tipo de carimbo de tempo. */
	serproResponse: optionalNullable(z.record(z.string(), z.unknown())),
	verificationHash: codigoVerificacaoSchema,
	signingTimeISO: optionalNullable(isoTimestampSchema),
	messageDigestHex: optionalNullable(hashHexSchema),
	documentHash: optionalNullable(hashHexSchema),
	assinanteEmail: emailAssinanteSchema,
	latitude: latitudeSchema,
	longitude: longitudeSchema
});
export type FinalizarAssinaturaEscalasInput = z.infer<typeof finalizarAssinaturaEscalasSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// FINALIZAR-ASSINATURA — gise (usa nomes "rawSignature" / "certificateBase64" / "messageDigest")
// Compartilhado entre /api/gise/[id]/finalizar-assinatura e
//                    /api/gise/[id]/relatorios/[seccionalId]/finalizar-assinatura
// ─────────────────────────────────────────────────────────────────────────────

export const finalizarAssinaturaGiseSchema = z.object({
	preparedPdf: pdfBase64Schema,
	serproCms: optionalNullable(base64Schema),
	serproResponse: optionalNullable(z.record(z.string(), z.unknown())),
	messageDigest: optionalNullable(hashHexSchema),
	signingTimeISO: optionalNullable(isoTimestampSchema),
	signerName: nomeAssinanteSchema,
	signerCpf: cpfAssinanteSchema,
	verificationHash: codigoVerificacaoSchema,
	documentHash: optionalNullable(hashHexSchema),
	assinanteEmail: emailAssinanteSchema,
	rubrica: dataUrlImagemSchema,
	latitude: latitudeSchema,
	longitude: longitudeSchema,
	/** Específico do daily GISE: 'manha' | 'tarde' | 'ambos'. */
	dia: optionalNullable(z.enum(['manha', 'tarde', 'ambos']))
});
export type FinalizarAssinaturaGiseInput = z.infer<typeof finalizarAssinaturaGiseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// ASSINAR-SIMPLES — schema canônico (escalas + gise unificados)
//
// Antes existiam dois schemas distintos: `assinarSimplesEscalasSchema` (apenas
// rubrica + GPS) e `assinarSimplesGiseSchema` (rubrica + GPS + selfie + 2FA).
// Isso fazia escala mensal ignorar silenciosamente as flags globais
// `exigirFotoAssinatura` e `exigirCodigoEmailAssinatura`.
//
// Agora o schema aceita todos os campos como opcionais; a obrigatoriedade
// é decidida pelo servidor em `signature-service.ts` a partir das flags
// efetivas lidas via `lerFlagsAssinatura(platform)`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resultado do challenge de liveness ativa (eye blink, smile, ...).
 *
 * Quando `exigirFoto` está ativo, o cliente DEVE enviar este campo. O servidor
 * rejeita `cumprido=false` ou ausência total (sinal de bypass do front).
 */
const livenessChallengeSchema = optionalNullable(
	z.object({
		tipo: z.enum(['blink', 'smile']),
		cumprido: z.boolean(),
		tentativas: z.number().int().min(1).max(20),
		iniciadoEm: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}T/)
			.nullable(),
		concluidoEm: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}T/)
			.nullable(),
		duracaoMs: z.number().int().min(0).max(600_000)
	})
);

export const assinarSimplesSchema = z.object({
	rubrica: dataUrlImagemSchema,
	latitude: latitudeSchema,
	longitude: longitudeSchema,
	selfieBase64: dataUrlImagemSchema,
	/** Nome do campo é histórico (com cedilha) — manter para não quebrar clientes. */
	codigoValidação: optionalNullable(z.string().regex(/^\d{4,8}$/, 'Código inválido')),
	desafioId: optionalNullable(
		z
			.string()
			.regex(/^[0-9a-fA-F]+$/, 'desafioId inválido')
			.max(80)
	),
	livenessChallenge: livenessChallengeSchema
});
export type AssinarSimplesInput = z.infer<typeof assinarSimplesSchema>;
export type LivenessChallengeInput = NonNullable<z.infer<typeof livenessChallengeSchema>>;

/** @deprecated use `assinarSimplesSchema`. Alias mantido para não quebrar imports. */
export const assinarSimplesEscalasSchema = assinarSimplesSchema;
/** @deprecated */
export type AssinarSimplesEscalasInput = AssinarSimplesInput;
/** @deprecated use `assinarSimplesSchema`. */
export const assinarSimplesGiseSchema = assinarSimplesSchema;
/** @deprecated */
export type AssinarSimplesGiseInput = AssinarSimplesInput;
