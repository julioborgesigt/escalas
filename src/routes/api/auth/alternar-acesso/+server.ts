import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarPolicial,
	buscarAdminVinculadoPorPolicial,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { criarSessao, excluirSessao, obterRotaBemVindo, type UsuarioLogado } from '$lib/auth';
import { cookieOptions } from '$lib/server/auth/auth-flow';
import { invalidarSessaoCache } from '$lib/server/auth/session-cache';
import { requireAuth, forbidden, conflict } from '$lib/server/api';
import { modulosDaContaAdmin, cookieModuloParaGravar } from '$lib/server/auth/admin-modulos';

/**
 * Alterna o tipo da sessão entre ADM Geral (`admin`) e Usuário (`policial`)
 * para a MESMA pessoa, sem exigir novo login.
 *
 * Segurança: não concede privilégio novo. Só funciona quando as duas
 * identidades já pertencem à mesma pessoa (Admin Geral VINCULADO —
 * `administradores.policial_id`), isto é, quem já conseguiria logar como
 * ADM Geral com o mesmo login/senha. Um policial sem vínculo é recusado.
 * O 2FA já foi satisfeito no login desta sessão (mesma credencial/e-mail),
 * então a troca é imediata — espelha o swap de módulo GISE/Escalas.
 */
export const POST: RequestHandler = async (event) => {
	const { locals, platform, cookies, url } = event;
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const db = getDB(platform);
	const tokenAtual = cookies.get('session_token');
	const { contexto, env } = contextoDeEvento(event);

	// ---- ADM Geral → Usuário ----
	if (u.tipo === 'admin') {
		const policialId = u.adminPolicialId ?? null;
		if (!policialId) {
			return forbidden('Esta conta de administrador não está vinculada a um policial.');
		}
		const policial = await buscarPolicial(db, policialId);
		if (!policial) return conflict('Policial vinculado não encontrado.');

		const novoToken = await criarSessao(db, 'policial', policial.id);
		cookies.set('session_token', novoToken, cookieOptions(url));
		// Preserva o cookie `admin_modulo` (só surte efeito em sessão admin) para
		// que, ao voltar ao modo admin, caia no último módulo usado.
		if (tokenAtual) {
			await excluirSessao(db, tokenAtual);
			await invalidarSessaoCache(tokenAtual);
		}

		const destino: UsuarioLogado = {
			id: policial.id,
			tipo: 'policial',
			nome: policial.nome,
			papel: policial.papel ?? null,
			primeiro_acesso: policial.primeiro_acesso === 1
		};

		await auditar(
			db,
			{
				acao: 'alternar_acesso',
				usuario: u,
				entidade: 'admin',
				entidade_id: u.id,
				alvo_tipo: 'policial',
				alvo_id: policial.id,
				alvo_nome: policial.nome,
				detalhes: 'Alternou de ADM Geral para modo Usuário',
				metadados: { de: 'admin', para: 'policial' },
				...contexto
			},
			{ env }
		);

		return json({
			success: true,
			redirect: destino.primeiro_acesso ? '/alterar-senha' : obterRotaBemVindo(destino),
			primeiro_acesso: destino.primeiro_acesso
		});
	}

	// ---- Usuário → ADM Geral (só se vinculado) ----
	const admin = await buscarAdminVinculadoPorPolicial(db, u.id);
	if (!admin) {
		return forbidden('Você não possui acesso de Administrador Geral.');
	}

	const novoToken = await criarSessao(db, 'admin', admin.id);
	cookies.set('session_token', novoToken, cookieOptions(url));
	// Preferência de tela dentro do que a conta permite. Default GISE só quando
	// os dois estão liberados e não há cookie salvo.
	const permitidos = modulosDaContaAdmin(admin);
	const moduloSalvo = cookies.get('admin_modulo');
	const modulo = cookieModuloParaGravar(
		permitidos,
		moduloSalvo === 'gise' || moduloSalvo === 'escalas' ? moduloSalvo : 'gise'
	);
	cookies.set('admin_modulo', modulo, cookieOptions(url));
	if (tokenAtual) {
		await excluirSessao(db, tokenAtual);
		await invalidarSessaoCache(tokenAtual);
	}

	const destino: UsuarioLogado = {
		id: admin.id,
		tipo: 'admin',
		nome: admin.nome,
		// Herda o flag da sessão policial atual (vínculo). Hardcode `false`
		// mandava o cliente a bem-vindo enquanto o próximo request ainda
		// exigia /alterar-senha (FLW-AUT-020).
		primeiro_acesso: u.primeiro_acesso,
		adminPolicialId: u.id
	};

	await auditar(
		db,
		{
			acao: 'alternar_acesso',
			usuario: u,
			entidade: 'policial',
			entidade_id: u.id,
			alvo_tipo: 'admin',
			alvo_id: admin.id,
			alvo_nome: admin.nome,
			detalhes: `Alternou de modo Usuário para ADM Geral (${modulo})`,
			metadados: { de: 'policial', para: 'admin', modulo },
			...contexto
		},
		{ env }
	);

	const redirectTo = destino.primeiro_acesso
		? '/alterar-senha'
		: obterRotaBemVindo(destino, modulo);
	return json({
		success: true,
		redirect: redirectTo,
		primeiro_acesso: destino.primeiro_acesso
	});
};
