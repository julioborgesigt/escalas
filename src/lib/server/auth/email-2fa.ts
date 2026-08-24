/**
 * Onde o código 2FA de LOGIN deve ser enviado.
 *
 * O Admin Geral vinculado autentica contra o e-mail do POLICIAL (`credPol.email`
 * em `auth-flow.ts`). O reenvio lia só `administradores.email` — muitas vezes
 * nulo ou outro endereço — e o usuário pedia um código que nunca chegava, ou
 * chegava em caixa que não é a do login (SEC-04).
 *
 * Um ponto só: login e reenvio perguntam a mesma função.
 */

import { and, eq } from 'drizzle-orm';
import { administradores, policiais } from '../schema';
import type { Database } from '$lib/db';

export async function emailInstitucionalDoDesafio(
	db: Database,
	tipo: 'policial' | 'admin',
	usuarioId: number
): Promise<{ email: string; nome: string } | null> {
	if (tipo === 'policial') {
		const row = await db
			.select({ email: policiais.email, nome: policiais.nome })
			.from(policiais)
			.where(eq(policiais.id, usuarioId))
			.get();
		if (!row?.email) return null;
		return { email: row.email, nome: row.nome };
	}

	const row = await db
		.select({
			adminEmail: administradores.email,
			adminNome: administradores.nome,
			policialId: administradores.policial_id,
			policialEmail: policiais.email,
			policialNome: policiais.nome
		})
		.from(administradores)
		.leftJoin(policiais, and(eq(policiais.id, administradores.policial_id), eq(policiais.ativo, 1)))
		.where(eq(administradores.id, usuarioId))
		.get();

	if (!row) return null;
	if (row.policialId != null) {
		// Vínculo: o login só segue se o policial está ativo (`credPol`). Sem
		// e-mail do join, não há canal — não cair no placeholder da linha admin.
		if (!row.policialEmail) return null;
		return { email: row.policialEmail, nome: row.policialNome ?? row.adminNome };
	}
	if (!row.adminEmail) return null;
	return { email: row.adminEmail, nome: row.adminNome };
}
