import { z } from 'zod';

export const giseCriarSchema = z.object({
	data_inicio: z.string().min(10, 'Data de início é obrigatória'),
	data_fim: z.string().optional(),
	hora_entrada: z.string().regex(/^\d{1,2}:\d{2}$/, 'Use o formato HH:MM, ex: 08:00').default('08:00'),
	hora_saida: z.string().regex(/^\d{1,2}:\d{2}$/, 'Use o formato HH:MM, ex: 16:00').default('16:00'),
	modo: z.enum(['completa', 'clonada']).default('completa'),
	clonar_de: z.union([z.number().int(), z.literal('')]).optional()
}).refine(data => data.modo === 'completa' || !!data.clonar_de, {
	message: 'Selecione uma escala de origem',
	path: ['clonar_de']
});

export type GiseCriarInput = z.infer<typeof giseCriarSchema>;
