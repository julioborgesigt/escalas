import { json } from '@sveltejs/kit';

/**
 * Cria uma resposta JSON de erro padronizada para a API.
 * Formato: { error: string, status: number, errorType?: string }
 */
export function apiError(
	message: string,
	status: number = 500,
	errorType?: string
): Response {
	const body: Record<string, unknown> = { error: message, status };
	if (errorType) body.errorType = errorType;
	return json(body, { status });
}
