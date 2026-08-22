import { z } from 'zod';
import { optionalNullable, livenessChallengeSchema } from './assinatura-pdf';

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
		z
			.string()
			.max(5 * 1024 * 1024, 'Imagem muito grande (máx 5 MB)')
			.regex(/^data:image\/(png|jpe?g|webp);base64,/, 'Selfie deve ser data URL base64')
	),
	codigoEmail: optionalNullable(z.string().trim().max(200)),
	codigoValidação: optionalNullable(z.string().max(32)),
	desafioId: optionalNullable(z.string().max(80)),
	type: optionalNullable(z.string()),
	hash: optionalNullable(z.string()),
	signerName: optionalNullable(z.string().max(200)),
	signerCpf: optionalNullable(z.string().max(20)),
	latitude: z.number().min(-90).max(90).nullable().optional(),
	longitude: z.number().min(-180).max(180).nullable().optional(),
	/** Liveness challenge cumprido — exigido quando exigirFoto está ativo. */
	livenessChallenge: livenessChallengeSchema,
	reauthId: optionalNullable(z.string().regex(/^[0-9a-f]{64}$/, 'reauthId inválido'))
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
	equipeType: z.enum(['operacional', 'seint']).nullable().optional(),
	manifesto: z
		.enum(['true', 'false'])
		.optional()
		.transform((v) => v === 'true')
});

/** Query string do export agregado do histórico GISE (admin geral). */
export const giseHistoricoExportQuerySchema = z
	.object({
		format: z.enum(['xlsx', 'pdf']),
		seccionalId: z.coerce.number().optional(),
		tipoEquipe: z.enum(['operacional', 'seint']).optional(),
		periodo: z.enum(['mes', 'ciclo', 'data']),
		mesAno: z.string().optional(),
		ano: z.coerce.number().optional(),
		ciclo: z.coerce.number().min(1).max(12).optional(),
		data: z.string().optional()
	})
	.superRefine((data, ctx) => {
		if (data.periodo === 'mes') {
			if (!data.mesAno || !/^\d{4}-\d{2}$/.test(data.mesAno)) {
				ctx.addIssue({
					code: 'custom',
					message: 'Para período "mes", informe mesAno no formato YYYY-MM',
					path: ['mesAno']
				});
			}
		} else if (data.periodo === 'ciclo') {
			if (data.ano === undefined || Number.isNaN(data.ano)) {
				ctx.addIssue({
					code: 'custom',
					message: 'Para período "ciclo", informe ano',
					path: ['ano']
				});
			}
			if (data.ciclo === undefined || Number.isNaN(data.ciclo)) {
				ctx.addIssue({
					code: 'custom',
					message: 'Para período "ciclo", informe ciclo (1–12)',
					path: ['ciclo']
				});
			}
		} else {
			if (!data.data || !/^\d{4}-\d{2}-\d{2}$/.test(data.data)) {
				ctx.addIssue({
					code: 'custom',
					message: 'Para período "data", informe data no formato YYYY-MM-DD',
					path: ['data']
				});
			}
		}
	});
