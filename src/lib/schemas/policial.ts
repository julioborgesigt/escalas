import { z } from 'zod';

export const policialSchema = z.object({
	nome: z.string().min(1, 'Nome é obrigatório').max(200, 'Nome muito longo (máx. 200)'),
	matricula: z.string().min(1, 'Matrícula é obrigatória').max(20),
	cargo: z.enum(['DPC', 'OIP'], { message: 'Cargo deve ser DPC ou OIP' }),
	cpf: z.string().max(14).optional().nullable(),
	telefone: z.string().max(20).default(''),
	lotacao: z.string().max(200).default(''),
	regime: z.enum(['plantao', 'expediente']).default('plantao'),
	classe: z.string().max(100).default(''),
	papel: z.enum(['admin_seccional', 'admin_unidade']).nullable().optional(),
	papel_unidade_id: z.number().nullable().optional(),
	email: z.string().email('E-mail inválido').or(z.literal('')).nullable().optional().default(null)
});

export const policialUpdateSchema = policialSchema.partial().extend({
	ativo: z.number().min(0).max(1).optional()
});

export type PolicialInput = z.infer<typeof policialSchema>;
