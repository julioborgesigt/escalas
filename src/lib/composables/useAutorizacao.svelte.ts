import { page } from '$app/state';

/**
 * Autorização reativa a partir de `page.data.usuario` (SvelteKit load).
 * Propriedades são getters para ler `page.data` em cada acesso (evita
 * `state_referenced_locally` ao retornar objeto literal com `$derived`).
 *
 * Preferir `const auth = useAutorizacao()` e `const isAdmin = $derived(auth.isAdmin)`
 * em vez de desestruturar na primeira linha (perde reatividade).
 */
export function useAutorizacao() {
	return {
		get isAdmin() {
			const u = page.data.usuario;
			return u?.tipo === 'admin' || u?.papel === 'admin_geral';
		},
		get isAdminSeccional() {
			return page.data.usuario?.papel === 'admin_seccional';
		},
		get isAdminUnidade() {
			return page.data.usuario?.papel === 'admin_unidade';
		},
		get isAdminOrSeccional() {
			const u = page.data.usuario;
			return u?.tipo === 'admin' || u?.papel === 'admin_geral' || u?.papel === 'admin_seccional';
		},
		get tipoUsuario() {
			return page.data.usuario?.tipo ?? null;
		},
		get papelUsuario() {
			return page.data.usuario?.papel ?? null;
		},
		get lotacaoUsuario() {
			return page.data.usuario?.lotacao ?? null;
		}
	};
}
