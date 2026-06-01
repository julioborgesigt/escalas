import { z } from 'zod';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export const escalaSchema = z.object({
	titulo: z.string().min(1, 'Título é obrigatório').max(200, 'Título muito longo (máx. 200)'),
	cidade: z.string().min(1, 'Cidade é obrigatória').max(100, 'Cidade muito longa (máx. 100)'),
	data_inicio: z.string().regex(DATA_ISO, 'Data início deve estar no formato YYYY-MM-DD'),
	data_fim: z.string().regex(DATA_ISO, 'Data fim deve estar no formato YYYY-MM-DD'),
	horario: z.string().max(50).default('08H A 08H'),
	hora_entrada: z.string().max(5).default('08'),
	hora_saida: z.string().max(5).default('08'),
	lotacao: z.string().min(1, 'Lotação é obrigatória').max(200),
	tipo: z.enum(['plantao', 'expediente', 'fds']).optional()
});

export const escalaPolicialSchema = z.object({
	policial_id: z.number({ message: 'policial_id é obrigatório' }),
	data_plantao: z
		.string()
		.regex(DATA_ISO, 'Data deve estar no formato YYYY-MM-DD')
		.optional()
		.or(z.literal('')),
	datas: z
		.array(
			z.object({
				data_plantao: z.string().regex(DATA_ISO, 'Data deve estar no formato YYYY-MM-DD'),
				data_saida: z.string().regex(DATA_ISO, 'Data deve estar no formato YYYY-MM-DD')
			})
		)
		.optional(),
	data_saida: z.string().max(10).default(''),
	hora_entrada: z.string().max(5).default(''),
	hora_saida: z.string().max(5).default(''),
	equipe: z.string().max(50).default('')
});

export type EscalaInput = z.infer<typeof escalaSchema>;
export type EscalaPolicialInput = z.infer<typeof escalaPolicialSchema>;
