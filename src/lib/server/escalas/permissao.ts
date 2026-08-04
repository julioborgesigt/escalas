import { temSolicitacaoParaDpcAdmin } from '$lib/db';
import { lotacoesAdministradas } from '$lib/server/policial-permissao';
import type { Database } from '$lib/db';

/**
 * Verifica se o usuário tem permissão de leitura/assinatura sobre a escala.
 *
 * Regras, nesta ordem:
 * - Admin geral → sempre permitido
 * - Mesma lotação → sempre permitido
 * - Admin seccional/unidade cujo escopo administrado (`lotacoesAdministradas`)
 *   cobre a lotação da escala → permitido DIRETO, sem checar solicitação nem cargo
 * - Admin DPC (seccional ou unidade) fora do escopo acima → permitido se houver
 *   solicitação de assinatura direcionada a ele (respondência direta ou tipo 'unidade')
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

	// Verifica se a lotação está no escopo de administração (seccional/unidade)
	const escopo = await lotacoesAdministradas(db, u);
	if (escopo === null || escopo.has(escalaLotacao)) {
		return { permitido: true };
	}

	// DPC admin: verifica solicitação de assinatura (ex: respondência fora do escopo normal)
	const isDpcAdmin =
		(u.papel === 'admin_seccional' || u.papel === 'admin_unidade') && u.cargo === 'DPC';

	if (isDpcAdmin) {
		const lotacoesPermitidas = escopo === null ? undefined : Array.from(escopo);
		const temAcesso = await temSolicitacaoParaDpcAdmin(
			db,
			escalaId,
			u.id,
			lotacoesPermitidas,
			escalaLotacao
		);
		if (temAcesso) return { permitido: true };
		return {
			permitido: false,
			motivo: 'Não há solicitação de assinatura direcionada a você para esta escala.'
		};
	}

	return { permitido: false, motivo: 'Sem permissão para acessar esta escala.' };
}
