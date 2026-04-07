import { page } from '$app/state';

/**
 * Hook reutilizável para verificações de autorização/autorização.
 * Centraliza a lógica de verificação de papéis do usuário.
 *
 * @returns Objeto com flags de autorização
 *
 * @example
 * const { isAdmin, isAdminSeccional, isAdminUnidade } = useAutorizacao();
 */
export function useAutorizacao() {
	const usuario = page.data.usuario;

	return {
		isAdmin: usuario?.tipo === 'admin',
		isAdminSeccional: usuario?.papel === 'admin_seccional',
		isAdminUnidade: usuario?.papel === 'admin_unidade',
		isAdminOrSeccional:
			usuario?.tipo === 'admin' || usuario?.papel === 'admin_seccional',
		tipoUsuario: usuario?.tipo ?? null,
		papelUsuario: usuario?.papel ?? null,
		lotacaoUsuario: usuario?.lotacao ?? null
	};
}
