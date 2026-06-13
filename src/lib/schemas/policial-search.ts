import { z } from 'zod';

/**
 * Schema da query string de `GET /api/policiais/search`.
 *
 * - `q`: filtro por nome/matrícula (LIKE escapado no DB)
 * - `cargo`: filtro opcional DPC/OIP
 * - `lotacao`: filtro opcional pelo nome da unidade
 * - `seccional_id`: filtro opcional por seccional (busca em todas as unidades filhas)
 * - `limit`: 1..50 (default 20)
 * - `page`: >= 1 (default 1)
 *
 * Para evitar varredura completa da tabela por usuários sem necessidade, o
 * handler exige que pelo menos um filtro discriminativo (`q` >= 2 chars,
 * `lotacao` ou `seccional_id`) seja informado quando o usuário NÃO for admin.
 */
export const policialSearchQuerySchema = z.object({
	q: z.string().trim().max(120).optional(),
	cargo: z.enum(['DPC', 'OIP']).optional(),
	lotacao: z.string().trim().max(120).optional(),
	seccional_id: z.coerce.number().int().positive().optional(),
	somente_admins: z
		.string()
		.optional()
		.transform((v) => v === 'true' || v === '1'),
	limit: z.coerce.number().int().min(1).max(50).default(20),
	page: z.coerce.number().int().min(1).max(10000).default(1)
});

type PolicialSearchQuery = z.infer<typeof policialSearchQuerySchema>;
