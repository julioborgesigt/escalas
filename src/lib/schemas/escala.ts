import { z } from 'zod';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export const escalaSchema = z.object({
	titulo: z.string().min(1, 'Título é obrigatório').max(200, 'Título muito longo (máx. 200)'),
	cidade: z.string().min(1, 'Cidade é obrigatória').max(100, 'Cidade muito longa (máx. 100)'),
	data_inicio: z.string().regex(DATA_ISO, 'Data início deve estar no formato YYYY-MM-DD'),
	data_fim: z.string().regex(DATA_ISO, 'Data fim deve estar no formato YYYY-MM-DD'),
	horario: z.string().default('08H A 08H').max(50),
	hora_entrada: z.string().default('08').max(5),
	hora_saida: z.string().default('08').max(5),
	lotacao: z.string().default('').max(200),
	tipo: z.enum(['plantao', 'expediente', 'fds']).optional()
});

export const escalaPolicialSchema = z.object({
	policial_id: z.number({ message: 'policial_id é obrigatório' }),
	data_plantao: z.string().regex(DATA_ISO, 'Data deve estar no formato YYYY-MM-DD').optional().or(z.literal('')),
	datas: z.array(z.object({
		data_plantao: z.string().regex(DATA_ISO, 'Data deve estar no formato YYYY-MM-DD'),
		data_saida: z.string().regex(DATA_ISO, 'Data deve estar no formato YYYY-MM-DD')
	})).optional(),
	data_saida: z.string().default(''),
	hora_entrada: z.string().default('').max(5),
	hora_saida: z.string().default('').max(5),
	equipe: z.string().default('').max(50)
});

export type EscalaInput = z.infer<typeof escalaSchema>;
export type EscalaPolicialInput = z.infer<typeof escalaPolicialSchema>;
