import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { eq } from 'drizzle-orm';
import {
	getDB,
	listarUnidades,
	criarSolicitacoesCadastro,
	listarMinhasSolicitacoesCadastro,
	registrarAuditComContexto,
	contextoDeEvento,
	buscarCredencialAtiva,
	type CampoSolicitacao
} from '$lib/db';
import { credencialDoUsuario } from '$lib/server/auth/credencial';
import { descreverVinculoCredencial } from '$lib/server/assinatura/webauthn/authenticator-data';
import { policiais } from '$lib/server/schema';
import { classesDoCargo, TELEFONE_RE } from '$lib/perfil-campos';
import { limparTelefone } from '$lib/utils/formato';

/**
 * "Meu perfil" (`/perfil`) — visão do próprio servidor.
 *
 * O policial não edita o próprio cadastro: ele SOLICITA a alteração, que fica
 * pendente até o Admin Geral decidir em `/solicitacoes`. Nome, matrícula e
 * cargo nem entram na solicitação (vêm da sincronização institucional).
 */

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	// Admin geral não tem cadastro de policial próprio — perfil é do servidor.
	if (u.tipo !== 'policial') redirect(302, '/escalas/bem-vindo');

	const db = getDB(platform);
	const [row, unidades, solicitacoes, credencial] = await Promise.all([
		db
			.select({
				nome: policiais.nome,
				matricula: policiais.matricula,
				cargo: policiais.cargo,
				telefone: policiais.telefone,
				classe: policiais.classe,
				regime: policiais.regime,
				lotacao: policiais.lotacao,
				email: policiais.email,
				email_pessoal: policiais.email_pessoal,
				email_pessoal_verificado: policiais.email_pessoal_verificado,
				rubrica: policiais.rubrica,
				rubrica_atualizada_em: policiais.rubrica_atualizada_em
			})
			.from(policiais)
			.where(eq(policiais.id, u.id))
			.get(),
		listarUnidades(db),
		listarMinhasSolicitacoesCadastro(db, u.id),
		buscarCredencialAtiva(db, credencialDoUsuario(u))
	]);

	if (!row) redirect(302, '/login');

	return {
		perfil: row,
		classes: classesDoCargo(row.cargo),
		lotacoes: unidades.map((un) => un.nome),
		solicitacoes,
		// Só o que a tela precisa mostrar. `credential_id` e chave pública NÃO
		// vão para o cliente: são dados da credencial, não da apresentação.
		passkey: credencial
			? { criadoEm: credencial.criadoEm, vinculo: descreverVinculoCredencial(credencial) }
			: null
	};
};

export const actions: Actions = {
	solicitar: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u || u.tipo !== 'policial') return fail(401, { error: 'Não autorizado' });

		const db = getDB(platform);
		const atual = await db
			.select({
				cargo: policiais.cargo,
				telefone: policiais.telefone,
				classe: policiais.classe,
				regime: policiais.regime,
				lotacao: policiais.lotacao
			})
			.from(policiais)
			.where(eq(policiais.id, u.id))
			.get();
		if (!atual) return fail(404, { error: 'Cadastro não encontrado' });

		const data = await request.formData();
		// Campo em branco = "não quero mudar isto", não "apagar o valor".
		const telefone = (data.get('telefone')?.toString() ?? '').trim();
		const classe = (data.get('classe')?.toString() ?? '').trim();
		const regime = (data.get('regime')?.toString() ?? '').trim();
		const lotacao = (data.get('lotacao')?.toString() ?? '').trim();

		// Validações por campo (mesmos domínios do cadastro administrativo)
		if (telefone && !TELEFONE_RE.test(telefone)) {
			return fail(400, { error: 'Telefone inválido — use apenas números, espaços, ( ) + -.' });
		}
		if (classe && !classesDoCargo(atual.cargo).includes(classe)) {
			return fail(400, { error: 'Classe inválida para o seu cargo.' });
		}
		if (regime && regime !== 'plantao' && regime !== 'expediente') {
			return fail(400, { error: 'Regime inválido.' });
		}
		if (lotacao) {
			const unidades = await listarUnidades(db);
			if (!unidades.some((un) => un.nome === lotacao)) {
				return fail(400, { error: 'Lotação inválida — selecione uma unidade da lista.' });
			}
		}

		// Só vira solicitação o que realmente difere do cadastro atual — evita fila
		// de pedidos que não mudam nada quando o usuário salva o formulário inteiro.
		const mudancas: Array<{
			campo: CampoSolicitacao;
			valorAtual: string | null;
			valorNovo: string;
		}> = [];
		// Compara por DÍGITOS (`limparTelefone`): o formulário envia o telefone só
		// com números (máx. 11), enquanto o valor no banco pode estar formatado
		// (espaço/traço). Sem isto, mudar só a classe geraria também uma
		// "solicitação de telefone" que na prática é o mesmo número, sem formatação.
		if (telefone && limparTelefone(telefone) !== limparTelefone(atual.telefone)) {
			mudancas.push({ campo: 'telefone', valorAtual: atual.telefone, valorNovo: telefone });
		}
		if (classe && classe !== atual.classe) {
			mudancas.push({ campo: 'classe', valorAtual: atual.classe, valorNovo: classe });
		}
		if (regime && regime !== atual.regime) {
			mudancas.push({ campo: 'regime', valorAtual: atual.regime, valorNovo: regime });
		}
		if (lotacao && lotacao !== atual.lotacao) {
			mudancas.push({ campo: 'lotacao', valorAtual: atual.lotacao, valorNovo: lotacao });
		}

		if (mudancas.length === 0) {
			return fail(400, { error: 'Nenhuma alteração em relação ao cadastro atual.' });
		}

		// Uma solicitação por campo: o admin pode aprovar telefone e recusar lotação.
		try {
			await criarSolicitacoesCadastro(db, u.id, mudancas);
		} catch {
			return fail(500, { error: 'Erro ao registrar a solicitação. Tente novamente.' });
		}

		const { contexto, env } = contextoDeEvento(event);
		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'solicitar_alteracao_cadastro',
			entidade: 'policial',
			entidade_id: u.id,
			alvo_tipo: 'policial',
			alvo_id: u.id,
			alvo_nome: u.nome,
			detalhes: `Solicitação de alteração cadastral: ${mudancas.map((m) => m.campo).join(', ')}`,
			metadados: { mudancas },
			...contexto,
			env
		});

		// Devolve a lista já atualizada: a tela troca o quadro "Minhas solicitações"
		// sem precisar de `invalidateAll`.
		const solicitacoes = await listarMinhasSolicitacoesCadastro(db, u.id);
		return { success: true, solicitacoes };
	}
};
