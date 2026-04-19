import { z } from 'zod';
import { optionalNullable } from './assinatura-pdf';

/** Schema para validação de assinatura de relatórios GISE */
export const giseSignatureSchema = z.object({
	coords: z
		.object({
			lat: z.number().nullable(),
			lng: z.number().nullable()
		})
		.optional(),
	/** `JSON.stringify` envia `null` para selfie/código quando ausentes; `z.string().optional()` não aceita null. */
	rubrica: z
		.union([z.string(), z.null()])
		.transform((v) => v ?? '')
		.pipe(z.string().min(1, 'Rubrica é obrigatória')),
	selfieBase64: optionalNullable(
		z.string().max(5 * 1024 * 1024, 'Imagem muito grande (máx 5 MB)')
	),
	codigoEmail: optionalNullable(z.string().trim().max(200)),
	codigoValidação: optionalNullable(z.string().max(32)),
	desafioId: optionalNullable(z.string().max(80)),
	type: optionalNullable(z.string()),
	hash: optionalNullable(z.string()),
	signerName: optionalNullable(z.string().max(200)),
	signerCpf: optionalNullable(z.string().max(20)),
	latitude: z.number().nullable().optional(),
	longitude: z.number().nullable().optional()
});

/**
 * Validação para ações simples que recebem apenas o ID do GISE
 */
export const giseIdParamSchema = z.object({
	id: z.coerce.number().positive('ID inválido')
});

/**
 * Validação para o endpoint de download do GISE
 */
export const giseDownloadSchema = z.object({
	format: z.enum(['xlsx', 'pdf', 'extraordinario', 'produtividade']).default('xlsx'),
	seccionalId: z.coerce.number().optional(),
	equipeType: z.enum(['operacional', 'seint']).nullable().optional()
});

export type GiseSignatureInput = z.infer<typeof giseSignatureSchema>;
