/**
 * Os quadros de "Acesso rápido" das telas de boas-vindas — a regra fora do
 * `.svelte`, ao lado de `menu-visibilidade.ts` e pelo mesmo motivo.
 *
 * **Card e item de menu são a MESMA pergunta feita duas vezes**: "o que este
 * usuário alcança daqui?". Até ago/2026 eram duas respostas independentes — a
 * sidebar num `.ts` puro com testes, os cards em três arrays escritos à mão
 * dentro de `/bem-vindo`, `/escalas/bem-vindo` e `/gise/bem-vindo`. Elas
 * divergiram, e a divergência não aparecia em lugar nenhum:
 *
 *  - admin de unidade e de seccional tinham **Produtividade** na barra e nenhum
 *    card (e `showIndicadores` inclui admin de unidade DE PROPÓSITO — quem
 *    informa a linha de base precisa ver o resultado dela);
 *  - **Dados base** só aparece para quem tem base pendente, que é justamente o
 *    caso em que a tela de entrada deveria chamar a atenção — e não chamava;
 *  - o Admin Geral com os DOIS módulos ligados via 7 destinos na barra e 4
 *    cards: escala extra, produtividade e operações sumiam da tela de entrada.
 *
 * Nada disso era teoria: foi medido no navegador, papel por papel. Por isso a
 * lista passou a sair das MESMAS flags que a barra consome
 * (`visibilidadeDoMenu`), e `__tests__/bem-vindo-cards.test.ts` reprova
 * qualquer destino de menu que fique sem card.
 *
 * O que continua em cada página `.svelte`: só a apresentação (cabeçalho,
 * `accent`, grade). Quem decide O QUE aparece é este arquivo.
 */
import { visibilidadeDoMenu, type FlagsMenu } from './menu-visibilidade';

/** Um quadro de acesso rápido. Mesma forma que `BemVindoCardAcao` consome. */
export interface CardBemVindo {
	titulo: string;
	descricao: string;
	href: string;
	cta: string;
}

/** Só o recorte de `UsuarioLogado` que a escolha dos cards consulta. */
export interface UsuarioDosCards {
	tipo?: 'policial' | 'admin';
	papel?: 'admin_seccional' | 'admin_unidade' | null;
	cargo?: string | null;
	isSuperAdmin?: boolean;
}

export interface EntradaCards {
	usuario: UsuarioDosCards | null | undefined;
	flags: FlagsMenu;
}

/* ── Cards fixos ────────────────────────────────────────────────────────── */

/**
 * `/perfil` — o texto promete só o que a tela entrega, e ela entrega menos desde
 * ago/2026: o servidor deixou de SOLICITAR a correção do próprio cadastro (quem
 * pede é o administrador da unidade ou da seccional dele). O que sobrou é
 * leitura mais as duas coisas que pertencem ao titular — o e-mail pessoal e a
 * chave de assinatura —, e é isso que o texto diz. Manter "solicite a correção"
 * aqui mandaria o servidor procurar um botão que não existe mais.
 */
const MEU_PERFIL: CardBemVindo = {
	titulo: 'Meu perfil',
	descricao:
		'Você pode conferir seus dados cadastrais, trocar o seu e-mail pessoal e registrar a chave de assinatura do celular (caso solicitado).',
	href: '/perfil',
	cta: 'Abrir meu perfil'
};

const MINHA_PRESENCA: CardBemVindo = {
	titulo: 'Minha presença',
	descricao:
		'Confirme sua entrada e saída nas escalas extras em que você foi escalado e assine a folha de presença.',
	href: '/res-gise',
	cta: 'Registrar presença'
};

const MEU_HISTORICO: CardBemVindo = {
	titulo: 'Meu histórico',
	descricao:
		'Consulte suas escalas extras já encerradas: comprovantes de presença e relatórios das operações anteriores.',
	href: '/res-gise?status=finalizadas',
	cta: 'Ver histórico'
};

/**
 * `/produtividade` — sem citar "armas, drogas e prisões". Os indicadores e as
 * metas são configurados POR OPERAÇÃO (a própria tela avisa quando a operação
 * não tem indicador configurado); listar três exemplos como se fossem a função
 * descrevia uma operação específica, não a página.
 */
const PRODUTIVIDADE: CardBemVindo = {
	titulo: 'Produtividade',
	descricao:
		'Acompanhe os indicadores e as metas em cada operação através de gráficos que você pode exportar.',
	href: '/produtividade',
	cta: 'Ver produtividade'
};

/**
 * `/dados-base` — só aparece para quem TEM base pendente (`showDadosBase`), o
 * que faz dele o card mais próximo de uma tarefa a fazer. O texto diz para que
 * serve o número, porque quem preenche precisa saber que ele é o denominador da
 * meta.
 */
const DADOS_BASE: CardBemVindo = {
	titulo: 'Dados base',
	descricao:
		'Informe os números iniciais da sua unidade: são eles que servem de base para as metas percentuais das operações.',
	href: '/dados-base',
	cta: 'Informar dados base'
};

const POLICIAIS: CardBemVindo = {
	titulo: 'Policiais',
	descricao: 'Consulte e gerencie o cadastro dos policiais e os dados de cada um.',
	href: '/policiais',
	cta: 'Gerenciar policiais'
};

/**
 * `/policiais` para quem administra uma seccional ou uma unidade: a MESMA tela,
 * com outro poder. O texto diz SOLICITAR porque é o que a ficha faz para ele —
 * prometer "gerencie o cadastro", como no card do Admin Geral, criaria a
 * expectativa que a tela seguinte frustra (o mesmo cuidado do card de perfil).
 * A movimentação entra no texto por ser o único caminho de troca de lotação.
 */
const POLICIAIS_ESCOPO: CardBemVindo = {
	titulo: 'Policiais',
	descricao:
		'Gerencie o cadastro dos servidores da sua unidade e solicite a correção de dados, a movimentação, o afastamento ou a desvinculação de cada um.',
	href: '/policiais',
	cta: 'Ver servidores'
};

const SOLICITACOES: CardBemVindo = {
	titulo: 'Solicitações',
	descricao:
		'Analise os pedidos de alteração de cadastro, movimentação, afastamento e desvinculação enviados.',
	href: '/solicitacoes',
	cta: 'Ver solicitações'
};

const PAINEL: CardBemVindo = {
	titulo: 'Painel de conformidade',
	descricao:
		'Acompanhe, por delegacia, quais escalas já foram enviadas e assinadas, e onde estão as pendências de prazo.',
	href: '/painel',
	cta: 'Abrir painel'
};

const RECEBIDOS: CardBemVindo = {
	titulo: 'Caixa de entrada',
	descricao:
		'Veja as escalas conforme chegam, acompanhe as assinaturas e exporte o que precisar (Word, Excel ou PDF).',
	href: '/recebidos',
	cta: 'Abrir caixa de entrada'
};

/**
 * `/gise/finalizadas` — só o Admin Geral. Era o bloco Histórico no rodapé de
 * `/gise`; virou aba para o arquivo não competir com as escalas em andamento.
 */
const FINALIZADAS: CardBemVindo = {
	titulo: 'Finalizadas',
	descricao:
		'Consulte o histórico das escalas extras já encerradas.',
	href: '/gise/finalizadas',
	cta: 'Ver finalizadas'
};

/**
 * `/gise/operacoes` — o formulário de produtividade entra no texto de propósito:
 * o editor é alcançado pelo botão "Formulário" de CADA operação, e não por uma
 * aba solta. Havia um card "Configuração de Formulários" apontando para
 * `/res-gise` sem operação escolhida; ele contradizia a decisão registrada no
 * menu (o editor precisa do contexto da operação) e por isso saiu.
 */
const OPERACOES: CardBemVindo = {
	titulo: 'Operações',
	descricao:
		'Crie e gerencie as operações extraordinárias e configure o formulário de produtividade para cada uma.',
	href: '/gise/operacoes',
	cta: 'Gerenciar operações'
};

/**
 * `/gise/planos` — a operação COM deslocamento, que é o que a distingue da
 * escala extra e o que o texto precisa dizer: quem lê o card decide por aqui
 * qual dos dois cadastros abrir.
 */
const PLANOS: CardBemVindo = {
	titulo: 'Planos operacionais',
	descricao:
		'Crie o plano operacional, configure as equipes, os custos e gere o plano em PDF.',
	href: '/gise/planos',
	cta: 'Ver planos operacionais'
};

/* ── Super Admin ────────────────────────────────────────────────────────── */

const UNIDADES: CardBemVindo = {
	titulo: 'Unidades',
	descricao:
		'Cadastre e organize a estrutura da corporação: departamentos, seccionais e delegacias.',
	href: '/unidades',
	cta: 'Gerenciar unidades'
};

const POLICIAIS_SUPER: CardBemVindo = {
	titulo: 'Policiais',
	descricao:
		'Gerencie o cadastro dos policiais, os papéis administrativos (RBAC) e a concessão de Admin Geral.',
	href: '/policiais',
	cta: 'Gerenciar policiais'
};

/**
 * `/conf-ass` — o texto acompanha as CINCO chaves da tela. Ficou por um tempo
 * em "foto, GPS e código por e-mail", de quando eram três: as duas que faltavam
 * (restrição a smartphone e exigência da chave de assinatura) são justamente as
 * de maior efeito sobre quem consegue assinar.
 */
const CONF_ASS: CardBemVindo = {
	titulo: 'Configurações de assinatura',
	descricao:
		'Defina o que a assinatura em tela exige: foto, localização, código por e-mail, restrição a smartphone e a chave de assinatura do celular.',
	href: '/conf-ass',
	cta: 'Abrir configurações'
};

const CONFIG_GERAL: CardBemVindo = {
	titulo: 'Configurações gerais',
	descricao:
		'Ajustes globais do sistema, como o provedor de e-mail padrão (Cloudflare ou Resend) e o seu substituto em caso de falha.',
	href: '/config-geral',
	cta: 'Abrir configurações'
};

/**
 * `/config-custos` — do Super Admin, e não do Admin Geral que monta os planos:
 * é a tabela de hora extra e diária da corporação. Quem planeja a operação
 * escolhe QUANTAS horas; quanto vale a hora é decisão de outro nível.
 */
const CONFIG_CUSTOS: CardBemVindo = {
	titulo: 'Valores de custo',
	descricao:
		'Defina os valores de hora extra por cargo e classe e os das diárias. É a tabela que os planos operacionais aplicam — cada versão fica gravada, e um plano antigo continua com a que usou.',
	href: '/config-custos',
	cta: 'Abrir valores de custo'
};

const AUDITORIA: CardBemVindo = {
	titulo: 'Auditoria',
	descricao:
		'Trilha forense das ações do sistema, com filtros, verificação de integridade e exportação (CSV ou PDF).',
	href: '/auditoria',
	cta: 'Abrir auditoria'
};

/* ── Cards que dependem do papel ────────────────────────────────────────── */

/**
 * `/escalas` para quem administra unidade ou seccional.
 *
 * O verbo segue o cargo porque o SERVIDOR segue o cargo
 * (`podeAssinarEscala` × `podeOIPSolicitarAssinatura`, em
 * `server/escalas/permissao.ts`): DPC assina, OIP cria e SOLICITA a assinatura.
 * Solicitar é o ato que fecha o trabalho do OIP e não aparecia em texto nenhum.
 *
 * O DPC não vê "fim de semana" no texto porque a escala de FDS não tem
 * assinatura digital — ali o ato é finalizar e enviar por e-mail à DPIS.
 */
function cardEscalas(u: UsuarioDosCards): CardBemVindo {
	const naSeccional = u.papel === 'admin_seccional';
	const onde = naSeccional ? 'da sua seccional' : 'da sua unidade';

	if (u.cargo === 'DPC') {
		return {
			titulo: 'Conferência e assinatura',
			descricao: `Confira e assine as escalas de plantão e expediente ${onde}, e acompanhe o que ainda está esperando assinatura.`,
			href: '/escalas',
			cta: 'Conferir e assinar'
		};
	}
	return {
		titulo: 'Escalas ordinárias',
		descricao: `Monte e gerencie as escalas de plantão, expediente e fim de semana ${onde}, e peça ao delegado a assinatura de cada uma.`,
		href: '/escalas',
		cta: 'Acessar escalas'
	};
}

/** `/gise` — supervisionar, escalar ou planejar, conforme de onde a pessoa vem. */
function cardEscalaExtra(u: UsuarioDosCards): CardBemVindo {
	if (u.tipo === 'admin') {
		return {
			titulo: 'Escala extra',
			descricao:
				'Planeje e valide a escalação das equipes operacionais e de inteligência em serviço extraordinário.',
			href: '/gise',
			cta: 'Acessar escalas extras'
		};
	}
	if (u.papel === 'admin_seccional') {
		return {
			titulo: 'Escala extra',
			descricao:
				'Escale os policiais convocados da sua seccional para as operações extraordinárias e acompanhe as escalas em andamento.',
			href: '/gise',
			cta: 'Acessar escalas extras'
		};
	}
	return {
		titulo: 'Supervisão da escala extra',
		descricao:
			'Acompanhe a escalação e a execução das escalas extras sob sua supervisão, e assine o que for da sua responsabilidade.',
		href: '/gise',
		cta: 'Acessar supervisão'
	};
}

/**
 * Os cards deste usuário, na ordem em que a tela os mostra.
 *
 * Espelha `visibilidadeDoMenu` + `itensExtraDoMenu`: mesma entrada, mesmas
 * condições. Um destino novo no menu tem de entrar aqui também — o teste de
 * paridade reprova o esquecimento.
 */
export function cardsBemVindo({ usuario, flags }: EntradaCards): CardBemVindo[] {
	if (!usuario) return [];

	// Super Admin: console próprio, sem as abas operacionais.
	if (usuario.isSuperAdmin) {
		return [UNIDADES, POLICIAIS_SUPER, CONF_ASS, CONFIG_GERAL, CONFIG_CUSTOS, AUDITORIA];
	}

	const cards: CardBemVindo[] = [];
	const ehAdmin = usuario.tipo === 'admin';

	// Grupo 1 — escalas ordinárias.
	if (flags.showGrupo1) {
		if (ehAdmin) cards.push(PAINEL, RECEBIDOS);
		if (flags.showEscalasPoliciais) cards.push(cardEscalas(usuario));
	}

	// Grupo 2 — tudo o que é de escala extra (o submenu "Escala extra").
	if (flags.showGrupo2) {
		if (flags.showGise) cards.push(cardEscalaExtra(usuario));
		if (flags.isAdmGeral && flags.showGise) cards.push(FINALIZADAS);
		if (flags.showIndicadores) cards.push(PRODUTIVIDADE);
		if (flags.showDadosBase) cards.push(DADOS_BASE);
		// O Admin Geral não presta serviço: presença e histórico são de quem é
		// escalado. Mesma condição do menu.
		if (!ehAdmin && flags.temPresencaGiseAtiva) cards.push(MINHA_PRESENCA);
		if (!ehAdmin && flags.temGiseHistorico) cards.push(MEU_HISTORICO);
		if (ehAdmin && flags.showGise) cards.push(OPERACOES, PLANOS);
	}

	// Grupo 3 — gestão de pessoas. O cadastro é dos três papéis administrativos,
	// com texto conforme o poder de cada um; a fila de decisão é de quem decide.
	if (flags.showPoliciais) cards.push(ehAdmin ? POLICIAIS : POLICIAIS_ESCOPO);
	if (flags.showSolicitacoes) cards.push(SOLICITACOES);

	// Grupo 4 — todo policial tem perfil; sessão de admin não tem cadastro.
	if (usuario.tipo === 'policial') cards.push(MEU_PERFIL);

	return cards;
}

/**
 * Atalho para as páginas `.svelte`: monta as flags a partir do que o
 * `+layout.server.ts` já publica em `page.data` e devolve os cards prontos.
 *
 * Existe para que as três telas de boas-vindas não repitam a montagem de
 * `visibilidadeDoMenu` — repetir seria reabrir, em outra forma, a mesma porta
 * pela qual card e menu se afastaram.
 */
export function cardsBemVindoDaPagina(
	usuario: UsuarioDosCards | null | undefined,
	dados: {
		adminModulo?: 'ambas' | 'gise' | 'escalas';
		isSupervisorGise?: boolean;
		temLinhaBasePendente?: boolean;
		temPresencaGisePendente?: boolean;
		temGiseHistorico?: boolean;
	}
): CardBemVindo[] {
	if (!usuario) return [];
	const flags = visibilidadeDoMenu({
		usuario,
		adminModulo: dados.adminModulo ?? 'ambas',
		isSupervisorGise: !!dados.isSupervisorGise,
		temLinhaBasePendente: !!dados.temLinhaBasePendente,
		temPresencaGisePendente: !!dados.temPresencaGisePendente,
		temGiseHistorico: !!dados.temGiseHistorico
	});
	return cardsBemVindo({ usuario, flags });
}
