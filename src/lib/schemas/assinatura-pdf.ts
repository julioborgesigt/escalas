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
import { webauthnAssercaoSchema } from './webauthn';

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

/**
 * Token OPACO da preparação de assinatura (FLW-DOC-001). 64 hex de
 * `gerarTokenOpaco`; o servidor confere contra o hash guardado. Obrigatório:
 * sem ele o finalizar não tem como saber para qual documento o PDF foi
 * preparado.
 */
const intencaoSchema = z.string().regex(/^[0-9a-f]{64}$/, 'Preparação de assinatura inválida');

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

// ─────────────────────────────────────────────────────────────────────────────
// PRESENÇA GISE via Token A3 (desktop) — preparar/finalizar
// Diferente dos demais: NÃO recebe `rubrica` do cliente (usa a rubrica
// cadastrada do policial, lida no servidor). `tipo` indica entrada/saída.
// ─────────────────────────────────────────────────────────────────────────────

export const prepararPresencaSchema = z.object({
	signerName: nomeAssinanteSchema,
	signerCpf: cpfAssinanteSchema,
	latitude: latitudeSchema,
	longitude: longitudeSchema,
	tipo: z.enum(['entrada', 'saida'])
});

export const finalizarPresencaSchema = z.object({
	intencao: intencaoSchema,
	preparedPdf: pdfBase64Schema,
	serproCms: optionalNullable(base64Schema),
	serproResponse: optionalNullable(z.record(z.string(), z.unknown())),
	messageDigest: optionalNullable(hashHexSchema),
	signingTimeISO: optionalNullable(isoTimestampSchema),
	signerName: nomeAssinanteSchema,
	signerCpf: cpfAssinanteSchema,
	documentHash: optionalNullable(hashHexSchema),
	assinanteEmail: emailAssinanteSchema,
	latitude: latitudeSchema,
	longitude: longitudeSchema,
	tipo: z.enum(['entrada', 'saida'])
});

// ─────────────────────────────────────────────────────────────────────────────
// FINALIZAR-ASSINATURA — escalas (usa nomes "signature" / "certificate" / "messageDigestHex")
// ─────────────────────────────────────────────────────────────────────────────

export const finalizarAssinaturaEscalasSchema = z.object({
	intencao: intencaoSchema,
	preparedPdf: pdfBase64Schema,
	serproCms: optionalNullable(base64Schema),
	/** SERPRO devolve um JSON arbitrário; só guardamos para tipo de carimbo de tempo. */
	serproResponse: optionalNullable(z.record(z.string(), z.unknown())),
	signingTimeISO: optionalNullable(isoTimestampSchema),
	messageDigestHex: optionalNullable(hashHexSchema),
	documentHash: optionalNullable(hashHexSchema),
	assinanteEmail: emailAssinanteSchema,
	latitude: latitudeSchema,
	longitude: longitudeSchema
});

// ─────────────────────────────────────────────────────────────────────────────
// FINALIZAR-ASSINATURA — gise (usa nomes "rawSignature" / "certificateBase64" / "messageDigest")
// Compartilhado entre /api/gise/[id]/finalizar-assinatura e
//                    /api/gise/[id]/relatorios/[seccionalId]/finalizar-assinatura
// ─────────────────────────────────────────────────────────────────────────────

export const finalizarAssinaturaGiseSchema = z.object({
	intencao: intencaoSchema,
	preparedPdf: pdfBase64Schema,
	serproCms: optionalNullable(base64Schema),
	serproResponse: optionalNullable(z.record(z.string(), z.unknown())),
	messageDigest: optionalNullable(hashHexSchema),
	signingTimeISO: optionalNullable(isoTimestampSchema),
	signerName: nomeAssinanteSchema,
	signerCpf: cpfAssinanteSchema,
	documentHash: optionalNullable(hashHexSchema),
	assinanteEmail: emailAssinanteSchema,
	rubrica: dataUrlImagemSchema,
	latitude: latitudeSchema,
	longitude: longitudeSchema,
	/** Específico do daily GISE: 'manha' | 'tarde' | 'ambos'. */
	dia: optionalNullable(z.enum(['manha', 'tarde', 'ambos']))
});

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
 * Resultado do challenge de liveness ativa (head_turn, smile, ...).
 *
 * Quando `exigirFoto` está ativo, o cliente DEVE enviar este campo. O servidor
 * rejeita `cumprido=false` ou ausência total (sinal de bypass do front).
 *
 * `blink` é aceito por compatibilidade com assinaturas históricas (o desafio
 * foi aposentado no cliente por ser inviável de amostrar em celular).
 */
const livenessChallengeSchema = optionalNullable(
	z.object({
		tipo: z.enum(['blink', 'smile', 'head_turn']),
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
	livenessChallenge: livenessChallengeSchema,
	/**
	 * Janela de reautenticação por senha. 64 hex de `gerarTokenOpaco`. Ausente
	 * é recusado no serviço (403), não no Zod (400): a senha é piso da
	 * cerimônia, não corpo malformado.
	 */
	reauthId: optionalNullable(z.string().regex(/^[0-9a-f]{64}$/, 'reauthId inválido'))
});

export const assinarPresencaAvancadaSchema = assinarSimplesSchema.extend({
	tipo: z.enum(['entrada', 'saida'])
});

// ─────────────────────────────────────────────────────────────────────────────
// Assinatura AVANÇADA em duas fases (passkey) — escalas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finalização da assinatura por passkey.
 *
 * O corpo devolve o MESMO `preparedPdf` que o `preparar` montou: é sobre o hash
 * dele que a cerimônia biométrica aconteceu, e `consumirIntencaoAssinatura`
 * confere byte a byte. Nada mais do documento vem do cliente — nem o código de
 * validação, nem a chave da selfie no R2 (ambos viajam pela intenção).
 */
export const finalizarPasskeyEscalaSchema = z.object({
	intencao: intencaoSchema,
	preparedPdf: pdfBase64Schema,
	assercao: webauthnAssercaoSchema
});
