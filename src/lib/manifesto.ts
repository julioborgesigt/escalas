import type { UsuarioLogado } from '$lib/auth';

/**
 * Quem pode baixar o PDF assinado ÍNTEGRO (com a folha de manifesto forense:
 * CPF/IP/GPS/selfie) via `?manifesto=true`.
 *
 * Regras (basta uma):
 * - ADM Geral ou Super Admin (`tipo === 'admin'`).
 * - Policial com cargo DPC que seja o próprio assinante do documento
 *   (`assinanteId` é o `id` de quem assinou; `null`/`undefined` = identidade
 *   do assinante indisponível → esta regra nega, mas a anterior ainda vale).
 *
 * Fonte ÚNICA da regra: o servidor a aplica nos endpoints de download
 * (via re-export em `$lib/server/copia-conferencia`) e o cliente a usa para
 * decidir a visibilidade do botão "C/ manifesto" — quem não passa aqui
 * receberia do servidor apenas a cópia de conferência, então o botão nem
 * é exibido.
 */
export function podeBaixarComManifesto(
	u: UsuarioLogado | null | undefined,
	assinanteId?: number | null
): boolean {
	if (u?.tipo === 'admin') return true;
	if (u?.cargo === 'DPC' && assinanteId != null && u.id === assinanteId) return true;
	return false;
}
