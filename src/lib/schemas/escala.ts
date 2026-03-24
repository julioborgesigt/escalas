import { z } from 'zod';

export const escalaSchema = z.object({
	titulo: z.string().min(1, 'Título é obrigatório'),
	cidade: z.string().min(1, 'Cidade é obrigatória'),
	data_inicio: z.string().min(1, 'Data início é obrigatória'),
	data_fim: z.string().min(1, 'Data fim é obrigatória'),
	horario: z.string().default('08H A 08H'),
	hora_entrada: z.string().default('08'),
	hora_saida: z.string().default('08'),
	lotacao: z.string().default(''),
	tipo: z.enum(['plantao', 'expediente', 'fds']).optional()
});

export const escalaPolicialSchema = z.object({
	policial_id: z.number({ message: 'policial_id é obrigatório' }),
	data_plantao: z.string().optional(),
	datas: z.array(z.object({ data_plantao: z.string(), data_saida: z.string() })).optional(),
	data_saida: z.string().default(''),
	hora_entrada: z.string().default(''),
	hora_saida: z.string().default(''),
	equipe: z.string().default('')
});

export type EscalaInput = z.infer<typeof escalaSchema>;
export type EscalaPolicialInput = z.infer<typeof escalaPolicialSchema>;
