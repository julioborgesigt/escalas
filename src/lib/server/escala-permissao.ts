import { temSolicitacaoParaDpcAdmin } from '$lib/db';
import type { Database } from '$lib/db';

/**
 * Verifica se o usuário tem permissão de leitura/assinatura sobre a escala.
 *
 * Regras:
 * - Admin geral → sempre permitido
 * - Mesma lotação → sempre permitido
 * - Admin DPC (seccional ou unidade) → permitido se houver solicitação de assinatura
 *   direcionada a ele (respondência direta ou tipo 'unidade')
 * - Demais → negado
 *
 * Retorna `{ permitido: true }` ou `{ permitido: false, motivo: string }`.
 */
export async function verificarPermissaoEscala(
	db: Database,
	escalaId: number,
	escalaLotacao: string,
	u: NonNullable<App.Locals['usuario']>
): Promise<{ permitido: boolean; motivo?: string }> {
	// Admin geral: acesso irrestrito
	if (u.tipo === 'admin') return { permitido: true };

	// Mesma lotação: acesso direto
	if (u.lotacao === escalaLotacao) return { permitido: true };

	// DPC admin: verifica solicitação de assinatura
	const isDpcAdmin =
		(u.papel === 'admin_seccional' || u.papel === 'admin_unidade') && u.cargo === 'DPC';

	if (isDpcAdmin) {
		const temAcesso = await temSolicitacaoParaDpcAdmin(db, escalaId, u.id);
		if (temAcesso) return { permitido: true };
		return { permitido: false, motivo: 'Não há solicitação de assinatura direcionada a você para esta escala.' };
	}

	return { permitido: false, motivo: 'Sem permissão para acessar esta escala.' };
}
