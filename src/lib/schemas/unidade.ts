import { z } from 'zod';

export const unidadeSchema = z.object({
	nome: z
		.string()
		.min(1, 'Nome da unidade é obrigatório')
		.transform((s) => s.trim())
});

export type UnidadeInput = z.infer<typeof unidadeSchema>;
