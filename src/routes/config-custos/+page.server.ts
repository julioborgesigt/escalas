/**
 * `/config-custos` — os valores de hora extra e diária do plano operacional.
 * **Restrito ao SUPER ADMIN**, no `load` E na action.
 *
 * O gate é o mesmo de `/config-geral`, e a razão de não ser o Admin Geral está
 * na divisão de papéis: quem MONTA a operação (Admin Geral, em `/gise/planos`)
 * não é quem fixa quanto vale a hora. Deixar os dois no mesmo papel permitiria
 * a quem orça a operação ajustar o preço dela.
 *
 * ## Salvar cria uma VERSÃO, nunca sobrescreve
 *
 * `custo_parametros` é append-only. Cada gravação insere uma linha nova, e o
 * plano guarda qual delas aplicou — é o que faz o PDF de um plano de março,
 * reemitido depois de um reajuste, sair com os mesmos totais. A tela mostra o
 * histórico justamente para o operador conseguir responder "por que aquele
 * plano soma diferente?" sem abrir o banco.
 *
 * ## O signatário NÃO mora aqui
 *
 * Quem assina é campo do PLANO (`/gise/planos`), escolhido na criação e
 * editável depois. Já esteve nesta tela como padrão global e saiu: quem assina
 * varia por operação — o Titular assina umas, o Adjunto outras —, então um
 * padrão único ou seria ignorado na maioria das vezes ou induziria a trocar a
 * configuração de TODOS os planos seguintes para acertar um.
 */
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getDB,
	criarCustoParametros,
	listarCustoParametros,
	buscarCustoParametrosVigente,
	auditar,
	contextoDeEvento
} from '$lib/db';
import { lerBRL } from '$lib/planos/rotulos';
import { hojeBrasilISO } from '$lib/utils/datas';
import { logger } from '$lib/server/logger';

/**
 * Os dez campos de valor, na ordem em que a tela os apresenta.
 *
 * Uma lista só, consumida pelo `load`, pela action e pelo `.svelte`: é ela que
 * garante que um campo novo apareça nos três lugares. Três listas escritas à
 * mão divergiriam, e o sintoma seria um valor que a tela mostra e a action não
 * grava — silencioso, porque o campo faltante simplesmente fica zero.
 */
const CAMPOS_VALOR = [
	{ chave: 'oip_cd_normal', rotulo: 'OIP classes D e C', grupo: 'normal' },
	{ chave: 'oip_ab_normal', rotulo: 'OIP classes B e A', grupo: 'normal' },
	{ chave: 'dpc_12_normal', rotulo: 'DPC 1ª e 2ª classe', grupo: 'normal' },
	{ chave: 'dpc_3e_normal', rotulo: 'DPC 3ª classe e especial', grupo: 'normal' },
	{ chave: 'oip_cd_plus', rotulo: 'OIP classes D e C', grupo: 'plus' },
	{ chave: 'oip_ab_plus', rotulo: 'OIP classes B e A', grupo: 'plus' },
	{ chave: 'dpc_12_plus', rotulo: 'DPC 1ª e 2ª classe', grupo: 'plus' },
	{ chave: 'dpc_3e_plus', rotulo: 'DPC 3ª classe e especial', grupo: 'plus' },
	{ chave: 'diaria_estadual', rotulo: 'Diária estadual', grupo: 'diaria' },
	{ chave: 'diaria_interestadual', rotulo: 'Diária interestadual', grupo: 'diaria' }
] as const;

type ChaveValor = (typeof CAMPOS_VALOR)[number]['chave'];

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.usuario?.isSuperAdmin) redirect(302, '/');

	const db = getDB(platform);
	const [vigente, historico] = await Promise.all([
		buscarCustoParametrosVigente(db),
		listarCustoParametros(db)
	]);

	return {
		vigente,
		// O histórico já vem do mais recente para o mais antigo; a tela mostra os
		// últimos para caber sem paginação — quem precisa de mais consulta a
		// auditoria, onde cada gravação está registrada com autor.
		historico: historico.slice(0, 10),
		hoje: hojeBrasilISO()
	};
};

export const actions: Actions = {
	/**
	 * Grava uma versão nova dos dez valores.
	 *
	 * Valida os dez ANTES de inserir: um campo mal digitado não pode deixar
	 * metade dos valores gravados numa versão que o próximo plano aplicaria.
	 */
	salvarValores: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (!u?.isSuperAdmin) return fail(403, { error: 'Acesso restrito ao Super Administrador' });

		const fd = await request.formData();

		const valores = {} as Record<ChaveValor, number>;
		for (const campo of CAMPOS_VALOR) {
			const bruto = String(fd.get(campo.chave) ?? '').trim();

			// Campo vazio é ERRO, não zero.
			//
			// Tratar o vazio como 0 grava uma faixa a custo zero sem ninguém ter
			// decidido isso, e o sintoma aparece semanas depois: um DPC 3ª classe
			// escalado numa operação noturna sai custando R$ 0,00 no Anexo II, com o
			// documento parecendo completo. É a mesma classe de defeito que
			// `pendencias` impede no efetivo — aqui, um nível acima.
			//
			// Zero continua sendo valor legítimo (a corporação pode não pagar diária
			// interestadual); mas tem de ser DIGITADO, para virar decisão em vez de
			// esquecimento.
			if (bruto === '') {
				return fail(400, {
					error: `Preencha "${campo.rotulo}". Para não pagar essa faixa, digite 0,00.`,
					campo: campo.chave
				});
			}

			const centavos = lerBRL(bruto);
			if (centavos === null || centavos < 0) {
				return fail(400, {
					error: `Valor inválido em "${campo.rotulo}". Use o formato 27,30.`,
					campo: campo.chave
				});
			}
			valores[campo.chave] = centavos;
		}

		const vigenteDesde = String(fd.get('vigente_desde') ?? '').trim();
		if (!/^\d{4}-\d{2}-\d{2}$/.test(vigenteDesde)) {
			return fail(400, { error: 'Informe a data de vigência (AAAA-MM-DD).' });
		}

		const db = getDB(platform);
		let novoId: number;
		try {
			novoId = await criarCustoParametros(db, {
				...valores,
				vigente_desde: vigenteDesde,
				criado_por_id: u.tipo === 'policial' ? u.id : null,
				criado_por_nome: u.nome ?? ''
			});
		} catch (e) {
			logger.error('[config-custos] salvar valores', { error: String(e) });
			return fail(500, { error: 'Erro ao gravar os valores.' });
		}

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'salvar_custo_parametros',
				usuario: u,
				entidade: 'configuracao',
				entidade_id: novoId,
				detalhes: `Nova versão de valores de custo (vigente desde ${vigenteDesde})`,
				dados_depois: { ...valores, vigente_desde: vigenteDesde },
				...contexto
			},
			{ env }
		);

		return { success: true, versao: novoId };
	}
};
