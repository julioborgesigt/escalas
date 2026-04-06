import { z } from 'zod';

export const unidadeSchema = z.object({
	nome: z
		.string()
		.min(1, 'Nome da unidade é obrigatório')
		.max(200, 'Nome muito longo (máx. 200)')
		.transform((s) => s.trim()),
	tipo: z.enum(['seccional', 'delegacia']).default('delegacia'),
	seccional_id: z.number().nullable().default(null),
	tem_plantao: z.boolean().default(false),
	tem_expediente: z.boolean().default(false),
	tem_fds: z.boolean().default(false),
	cidade: z.string().min(1, 'Cidade é obrigatória').max(200).default('')
});

export type UnidadeInput = z.infer<typeof unidadeSchema>;
