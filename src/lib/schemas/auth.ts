import { z } from 'zod';

export const loginSchema = z.object({
	matricula: z.string().min(1, 'Matrícula é obrigatória'),
	senha: z.string().min(1, 'Senha é obrigatória'),
	tipo: z.enum(['policial', 'admin']).default('policial')
});

const SENHAS_COMUNS = new Set([
	'12345678', '87654321', 'password', 'admin123', 'qwerty12',
	'abc12345', '11111111', '00000000', 'policial', 'delegado'
]);

export const alterarSenhaSchema = z.object({
	senha_atual: z.string().optional(),
	nova_senha: z
		.string()
		.min(8, 'A senha deve ter no mínimo 8 caracteres')
		.max(64, 'A senha deve ter no máximo 64 caracteres')
		.refine((s) => /[A-Z]/.test(s), 'A senha deve conter pelo menos uma letra maiúscula')
		.refine((s) => /[a-z]/.test(s), 'A senha deve conter pelo menos uma letra minúscula')
		.refine((s) => /[0-9]/.test(s), 'A senha deve conter pelo menos um número')
		.refine((s) => !SENHAS_COMUNS.has(s.toLowerCase()), 'Essa senha é muito comum. Escolha outra.')
});

export type LoginInput = z.infer<typeof loginSchema>;
export type AlterarSenhaInput = z.infer<typeof alterarSenhaSchema>;
