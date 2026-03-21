import { z } from 'zod';

export const loginSchema = z.object({
	matricula: z.string().min(1, 'Matrícula é obrigatória'),
	senha: z.string().min(1, 'Senha é obrigatória'),
	tipo: z.enum(['policial', 'admin']).default('policial')
});

export const alterarSenhaSchema = z.object({
	senha_atual: z.string().optional(),
	nova_senha: z
		.string()
		.length(8, 'A nova senha deve ter exatamente 8 caracteres')
		.refine((s) => s !== '12345678', 'Escolha uma senha diferente da padrão')
});

export type LoginInput = z.infer<typeof loginSchema>;
export type AlterarSenhaInput = z.infer<typeof alterarSenhaSchema>;
