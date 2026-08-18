/**
 * Autorização do domínio escalas ordinárias: leitura por lotação/solicitação
 * (`verificarPermissaoEscala`), quem pode assinar (`podeAssinarEscala`) e o
 * portão completo das rotas de assinatura (`carregarEscalaParaAssinatura`).
 * Não há `autorizar()` único — a regra deste domínio mora aqui.
 */
import { temSolicitacaoParaDpcAdmin, buscarEscala, buscarDocumentoEscala } from '$lib/db';
import { lotacoesAdministradas } from '$lib/server/policial-permissao';
import type { Database } from '$lib/db';
import type { Escala } from '$lib/server/schema';
import { badRequest, conflict, forbidden, notFound } from '$lib/server/api';
import { isAnyAdmin } from '$lib/auth';

/**
 * Verifica se o usuário tem permissão de LEITURA sobre a escala.
 *
 * Assinar / preparar / finalizar / revogar o PDF é outro gate:
 * `podeAssinarEscala`, usado **depois** desta função.
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

/**
 * Quem pode ASSINAR / preparar / finalizar / revogar o PDF da escala.
 *
 * `verificarPermissaoEscala` é ACL de LEITURA (mesma lotação, escopo admin,
 * solicitação a DPC). Assinar é mais estrito e espelha a UI
 * (`PainelAssinaturaDigital.podeAssinar`): Admin Geral, ou
 * `(admin_seccional|admin_unidade) && cargo === 'DPC'`.
 *
 * Sem este gate, policial sem papel na lotação da escala assinava por POST
 * direto (FLW-AUT-001). OIP admin continua podendo solicitar, não assinar.
 *
 * Usar **depois** de `verificarPermissaoEscala`: quem assina ainda precisa
 * enxergar a escala (escopo / solicitação).
 */
export function podeAssinarEscala(u: App.Locals['usuario']): boolean {
	if (!u) return false;
	if (u.tipo === 'admin') return true;
	return (u.papel === 'admin_seccional' || u.papel === 'admin_unidade') && u.cargo === 'DPC';
}

/**
 * Portão COMPLETO das cinco rotas de assinatura de escala (`assinar-simples`,
 * `preparar-assinatura`, `finalizar-assinatura` e os dois passos da avançada):
 * id válido → escala existe → ACL de leitura → `podeAssinarEscala` → FDS →
 * documento já assinado.
 *
 * As cinco recusas rodavam copiadas nas cinco rotas, e a cópia divergiu como
 * sempre diverge: `finalizar-assinatura-avancada` era a única SEM o gate de
 * FDS (FLW-AUT-012). Ali a preparação já barrava o fluxo pela intenção, então
 * não havia buraco explorável — mas era a quinta cópia esperando alguém
 * removê-lo do lugar que ainda o tinha. A ordem das recusas é a mesma das
 * cópias, porque `e2e/autorizacao-negativa` distingue 400 de 403 e de 404.
 *
 * Devolve `{ escala, id }` ou `{ recusa }` — a rota só repassa a `recusa`.
 * O nome deste helper está em `HELPERS_OBRIGATORIOS` (`guard:autorizacao`) e
 * na `RE_403` do guard: extrair o 403 para cá sem registrar deixaria a
 * varredura cega, exatamente como aconteceu com `carregarEscalaComPermissao`.
 *
 * @param conflitoDocumento mensagem do 409 quando já existe documento assinado.
 *   `null` desliga a checagem (nenhuma rota usa hoje; o padrão é checar).
 */
export async function carregarEscalaParaAssinatura(
	db: Database,
	idParam: string | undefined,
	u: NonNullable<App.Locals['usuario']>,
	conflitoDocumento: string | null = 'Revogue a assinatura existente antes de assinar novamente'
): Promise<{ escala: Escala; id: number; recusa?: never } | { recusa: Response; escala?: never }> {
	const id = parseInt(idParam!);
	if (isNaN(id)) return { recusa: badRequest('ID inválido') };

	const escala = await buscarEscala(db, id);
	if (!escala) return { recusa: notFound('Escala') };

	// Leitura (lotação/escopo/solicitação) + assinatura (Admin Geral ou DPC admin) — FLW-AUT-001.
	const perm = await verificarPermissaoEscala(db, id, escala.lotacao, u);
	if (!perm.permitido) {
		return { recusa: forbidden(perm.motivo ?? 'Sem permissão para assinar esta escala') };
	}
	if (!podeAssinarEscala(u)) {
		return {
			recusa: forbidden(
				'Apenas Admin Geral ou DPC com papel administrativo pode assinar esta escala'
			)
		};
	}

	// FLW-AUT-012: FDS encerra por e-mail, não por assinatura digital.
	if (escala.tipo === 'fds') {
		return {
			recusa: badRequest(
				'Escala de fim de semana não admite assinatura digital — use o fluxo por e-mail'
			)
		};
	}

	// FLW-AUT-004: reassinatura exige revogar antes (DELETE documento-assinado).
	if (conflitoDocumento !== null && (await buscarDocumentoEscala(db, id))) {
		return { recusa: conflict(conflitoDocumento) };
	}

	return { escala, id };
}

/**
 * Quem pode SOLICITAR assinatura de escala (OIP admin ou Admin Geral).
 *
 * Espelha detalhe `/escalas/[id]` e a API `solicitar-assinatura`. A listagem
 * `/escalas` omitia Admin Geral — unificado aqui (FLW-AUT-013).
 */
export function podeOIPSolicitarAssinatura(u: App.Locals['usuario']): boolean {
	if (!u) return false;
	if (u.tipo === 'admin') return true;
	return (u.papel === 'admin_seccional' || u.papel === 'admin_unidade') && u.cargo === 'OIP';
}
