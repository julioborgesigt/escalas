import { temSolicitacaoParaDpcAdmin } from '$lib/db';
import { lotacoesAdministradas } from '$lib/server/policial-permissao';
import type { Database } from '$lib/db';
import { isAnyAdmin } from '$lib/auth';

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

/**
 * Quem pode ALTERAR a escala de uma lotação: o Admin Geral, em qualquer uma, e
 * o policial COM papel administrativo, na sua.
 *
 * Até ago/2026 o servidor exigia só a lotação — qualquer policial lotado na
 * unidade, sem papel algum, montava e assinava a escala dela por POST direto
 * (FLW-ESC-001).
 *
 * A tela já calculava esta regra, e é dela que ela vem: `podeEditarEscala &&
 * (podeOIPSolicitar || papel administrativo com cargo DPC)`. Só que a usava em
 * UM dos sete componentes de edição e passava a flag larga para os outros seis.
 * A regra estava certa e escrita; o que faltava era ser a mesma nos sete
 * lugares e no servidor — por isso agora ela é calculada AQUI e desce pronta
 * para a tela, em vez de recalculada lá.
 *
 * Expandindo os dois ramos: `tipo === 'admin'` ou papel em
 * {admin_seccional, admin_unidade} com cargo em {DPC, OIP}. Como `cargo` só tem
 * esses dois valores, o conjunto é exatamente `isAnyAdmin`.
 */
export function podeMexerNaEscala(u: App.Locals['usuario'], lotacaoDaEscala: string): boolean {
	if (!u) return false;
	if (u.tipo === 'admin') return true;
	return u.lotacao === lotacaoDaEscala && isAnyAdmin(u);
}
