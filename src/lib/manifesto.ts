/**
 * Quem pode baixar o PDF assinado ÍNTEGRO (folha de manifesto forense) via
 * `?manifesto=true`. Módulo client-safe: a UI esconde o botão com a MESMA
 * regra que o servidor aplica nos downloads.
 */
import type { UsuarioLogado } from '$lib/auth';

/**
 * Regras (basta uma): Admin Geral / Super Admin (`tipo === 'admin'`), ou DPC
 * que é o próprio assinante. `assinanteId` nulo faz esta segunda regra negar
 * — a primeira ainda vale.
 */
export function podeBaixarComManifesto(
	u: UsuarioLogado | null | undefined,
	assinanteId?: number | null
): boolean {
	if (u?.tipo === 'admin') return true;
	if (u?.cargo === 'DPC' && assinanteId != null && u.id === assinanteId) return true;
	return false;
}
