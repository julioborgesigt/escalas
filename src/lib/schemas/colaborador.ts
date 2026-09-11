/**
 * Cadastro de colaborador pelo Super Admin (`/colaboradores`) — a terceira
 * identidade, que entra por e-mail (decisão 71 do plano de diárias).
 *
 * O CPF é opcional e, quando vem, precisa ser válido pelos dígitos
 * verificadores: vai cifrado para o banco e, no módulo de diárias, sai impresso
 * no Requerimento — o `cpfValido` existe justamente para o dado digitado à mão
 * uma vez e nunca mais conferido.
 */
import { z } from 'zod';
import { cpfValido } from '$lib/utils/cpf';

export const colaboradorSchema = z.object({
	nome: z.string().trim().min(3, 'Nome muito curto').max(200, 'Nome muito longo (máx. 200)'),
	email: z
		.string()
		.trim()
		.toLowerCase()
		.min(5, 'E-mail é obrigatório')
		.max(254, 'E-mail muito longo')
		.email('E-mail inválido'),
	cpf: z
		.string()
		.trim()
		.max(14, 'CPF inválido')
		.refine((v) => v === '' || cpfValido(v), 'CPF inválido')
		.default(''),
	vinculo: z.string().trim().max(120, 'Vínculo muito longo (máx. 120)').default('')
});
