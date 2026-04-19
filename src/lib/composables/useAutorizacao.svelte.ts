import { page } from '$app/state';

/**
 * Autorização reativa a partir de `page.data.usuario` (SvelteKit load).
 * Cada flag é `$derived` para acompanhar navegação e `invalidate`.
 */
export function useAutorizacao() {
	const isAdmin = $derived(page.data.usuario?.tipo === 'admin');
	const isAdminSeccional = $derived(page.data.usuario?.papel === 'admin_seccional');
	const isAdminUnidade = $derived(page.data.usuario?.papel === 'admin_unidade');
	const isAdminOrSeccional = $derived(
		page.data.usuario?.tipo === 'admin' || page.data.usuario?.papel === 'admin_seccional'
	);
	const tipoUsuario = $derived(page.data.usuario?.tipo ?? null);
	const papelUsuario = $derived(page.data.usuario?.papel ?? null);
	const lotacaoUsuario = $derived(page.data.usuario?.lotacao ?? null);

	return {
		isAdmin,
		isAdminSeccional,
		isAdminUnidade,
		isAdminOrSeccional,
		tipoUsuario,
		papelUsuario,
		lotacaoUsuario
	};
}
