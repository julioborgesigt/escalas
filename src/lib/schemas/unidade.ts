import { z } from 'zod';

export const unidadeSchema = z.object({
	nome: z
		.string()
		.min(1, 'Nome da unidade é obrigatório')
		.transform((s) => s.trim()),
	tem_plantao: z.boolean().default(false),
	tem_expediente: z.boolean().default(false),
	tem_fds: z.boolean().default(false)
});

export type UnidadeInput = z.infer<typeof unidadeSchema>;
