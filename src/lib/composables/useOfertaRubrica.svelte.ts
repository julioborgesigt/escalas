/**
 * Oferta única do cadastro de rubrica reutilizável (Lógica 2a).
 *
 * Quem pode assinar por token e ainda não tem rubrica é convidado a
 * cadastrá-la UMA vez por sessão de navegação (sessionStorage) — depois o
 * banner da página mantém a opção visível sem incomodar a cada troca de aba.
 * A chave é compartilhada entre /escalas e /gise/[id]: a rubrica é a mesma,
 * cadastrar uma vez cobre ambas. Nunca bloqueia a assinatura.
 *
 * Extraído das duas páginas, que duplicavam o efeito byte-a-byte
 * (auditoria 2026-07-16, achado B-6.1).
 */

import { browser } from '$app/environment';

const CHAVE_SESSAO = 'rubrica-prompt-oferecido';

/** Só considera "tem rubrica" quando é um dataURL de imagem real. */
export function rubricaValida(v: unknown): string | null {
	return typeof v === 'string' && v.startsWith('data:image/') ? v : null;
}

/**
 * @param precisaRubrica função reativa: usuário assina por token e não tem rubrica.
 * @param jaAberto função reativa: modal de cadastro já está aberto.
 * @param abrir abre o modal de cadastro.
 */
export function useOfertaRubrica(
	precisaRubrica: () => boolean,
	jaAberto: () => boolean,
	abrir: () => void
) {
	$effect(() => {
		if (!browser || !precisaRubrica() || jaAberto()) return;
		if (!sessionStorage.getItem(CHAVE_SESSAO)) {
			sessionStorage.setItem(CHAVE_SESSAO, '1');
			abrir();
		}
	});
}
