import { z } from 'zod';

export const policialSchema = z.object({
	nome: z.string().min(1, 'Nome é obrigatório'),
	matricula: z.string().min(1, 'Matrícula é obrigatória'),
	cargo: z.enum(['DPC', 'OIP'], { message: 'Cargo deve ser DPC ou OIP' }),
	telefone: z.string().default(''),
	lotacao: z.string().default(''),
	regime: z.enum(['plantao', 'expediente', 'ambos']).default('ambos'),
	classe: z.string().default('')
});

export const policialUpdateSchema = policialSchema.partial().extend({
	ativo: z.number().min(0).max(1).optional()
});

export type PolicialInput = z.infer<typeof policialSchema>;
