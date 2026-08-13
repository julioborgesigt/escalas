/**
 * JSON de metadados/contexto da auditoria: lixo ou vazio vira `null`, nunca
 * um throw no template. As duas telas (`/auditoria` e `/auditoria/logs`)
 * parseiam o mesmo tipo de coluna TEXT.
 */
export function parseJson(s: string | null): Record<string, unknown> | null {
	if (!s) return null;
	try {
		return JSON.parse(s) as Record<string, unknown>;
	} catch {
		return null;
	}
}
