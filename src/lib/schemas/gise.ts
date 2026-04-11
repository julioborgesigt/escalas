import { z } from 'zod';

/** Schema para validação de assinatura de relatórios GISE */
export const giseSignatureSchema = z.object({
	coords: z
		.object({
			lat: z.number().nullable(),
			lng: z.number().nullable()
		})
		.optional(),
	rubrica: z.string().min(1, 'Rubrica é obrigatória'),
	selfieBase64: z.string().optional(),
	codigoEmail: z.string().optional(),
	desafioId: z.string().optional()
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
