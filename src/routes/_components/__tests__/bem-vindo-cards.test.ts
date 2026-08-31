/**
 * Paridade entre os quadros de boas-vindas e a navegação lateral.
 *
 * O teste que importa aqui não é "o card tem o texto X" — é **card e menu
 * oferecem os MESMOS destinos**. Foi a ausência dele que deixou admin de
 * unidade sem "Produtividade", ninguém com "Dados base" e o Admin Geral de
 * módulo "ambas" com 4 cards para 7 destinos de menu.
 *
 * `destinosDoMenu` reproduz o markup da sidebar (`+layout.svelte`): os itens
 * soltos por grupo, mais `itensExtraDoMenu` — esta última é a função de
 * verdade, não uma cópia. Mudou o menu, este arquivo reprova até o card
 * acompanhar.
 */
import { describe, it, expect } from 'vitest';
import { visibilidadeDoMenu, itensExtraDoMenu, type FlagsMenu } from '../menu-visibilidade';
import { cardsBemVindo, type UsuarioDosCards } from '../bem-vindo-cards';

type Modulo = 'ambas' | 'gise' | 'escalas';

function flagsDe(
	usuario: UsuarioDosCards,
	adminModulo: Modulo,
	extra: Partial<{
		isSupervisorGise: boolean;
		temLinhaBasePendente: boolean;
		temPresencaGisePendente: boolean;
		temGiseHistorico: boolean;
	}> = {}
): FlagsMenu {
	return visibilidadeDoMenu({
		usuario,
		adminModulo,
		isSupervisorGise: extra.isSupervisorGise ?? false,
		temLinhaBasePendente: extra.temLinhaBasePendente ?? false,
		temPresencaGisePendente: extra.temPresencaGisePendente ?? false,
		temGiseHistorico: extra.temGiseHistorico ?? false
	});
}

/** Os destinos que a sidebar oferece — espelho do markup de `+layout.svelte`. */
function destinosDoMenu(usuario: UsuarioDosCards, flags: FlagsMenu): string[] {
	if (usuario.isSuperAdmin) {
		return [
			'/unidades',
			'/policiais',
			'/conf-ass',
			'/config-geral',
			'/config-custos',
			'/auditoria'
		];
	}
	const ehAdmin = usuario.tipo === 'admin';
	const destinos: string[] = [];

	if (flags.showGrupo1) {
		if (ehAdmin) destinos.push('/painel', '/recebidos');
		if (flags.showEscalasPoliciais) destinos.push('/escalas');
	}
	if (flags.showGrupo2) {
		destinos.push(...itensExtraDoMenu(flags, new URL('http://x/bem-vindo')).map((i) => i.href));
		if (flags.showGise && ehAdmin) destinos.push('/gise/operacoes', '/gise/planos');
	}
	if (flags.showPoliciais) destinos.push('/policiais');
	if (flags.showSolicitacoes) destinos.push('/solicitacoes');
	if (usuario.tipo === 'policial') destinos.push('/perfil');

	return [...new Set(destinos)];
}

const POLICIAL: UsuarioDosCards = { tipo: 'policial', papel: null, cargo: 'OIP' };
const ADM_UNIDADE_OIP: UsuarioDosCards = { tipo: 'policial', papel: 'admin_unidade', cargo: 'OIP' };
const ADM_UNIDADE_DPC: UsuarioDosCards = { tipo: 'policial', papel: 'admin_unidade', cargo: 'DPC' };
const ADM_SECC_OIP: UsuarioDosCards = { tipo: 'policial', papel: 'admin_seccional', cargo: 'OIP' };
const ADM_SECC_DPC: UsuarioDosCards = { tipo: 'policial', papel: 'admin_seccional', cargo: 'DPC' };
const ADM_GERAL: UsuarioDosCards = { tipo: 'admin', papel: null, cargo: null };
const SUPER: UsuarioDosCards = { tipo: 'admin', papel: null, cargo: null, isSuperAdmin: true };

/** Os cenários medidos no navegador na auditoria de ago/2026. */
const CENARIOS: Array<{
	nome: string;
	usuario: UsuarioDosCards;
	modulo: Modulo;
	extra?: Parameters<typeof flagsDe>[2];
}> = [
	{ nome: 'policial comum', usuario: POLICIAL, modulo: 'ambas' },
	{
		nome: 'membro GISE (presença pendente)',
		usuario: POLICIAL,
		modulo: 'ambas',
		extra: { temPresencaGisePendente: true }
	},
	{
		nome: 'supervisor GISE',
		usuario: POLICIAL,
		modulo: 'ambas',
		extra: { isSupervisorGise: true, temPresencaGisePendente: true }
	},
	{
		nome: 'policial com histórico GISE',
		usuario: POLICIAL,
		modulo: 'ambas',
		extra: { temGiseHistorico: true }
	},
	{ nome: 'admin de unidade (OIP)', usuario: ADM_UNIDADE_OIP, modulo: 'ambas' },
	{ nome: 'admin de unidade (DPC)', usuario: ADM_UNIDADE_DPC, modulo: 'ambas' },
	{
		nome: 'admin de unidade com base pendente',
		usuario: ADM_UNIDADE_OIP,
		modulo: 'ambas',
		extra: { temLinhaBasePendente: true }
	},
	{
		nome: 'admin de unidade DPC supervisor de GISE',
		usuario: ADM_UNIDADE_DPC,
		modulo: 'ambas',
		extra: { isSupervisorGise: true }
	},
	{ nome: 'admin de seccional (OIP)', usuario: ADM_SECC_OIP, modulo: 'ambas' },
	{ nome: 'admin de seccional (DPC)', usuario: ADM_SECC_DPC, modulo: 'ambas' },
	{
		nome: 'admin de seccional com presença e histórico',
		usuario: ADM_SECC_OIP,
		modulo: 'ambas',
		extra: { temPresencaGisePendente: true, temGiseHistorico: true }
	},
	{ nome: 'Admin Geral — módulo escalas', usuario: ADM_GERAL, modulo: 'escalas' },
	{ nome: 'Admin Geral — módulo GISE', usuario: ADM_GERAL, modulo: 'gise' },
	{ nome: 'Admin Geral — ambos os módulos', usuario: ADM_GERAL, modulo: 'ambas' },
	{ nome: 'Super Admin', usuario: SUPER, modulo: 'ambas' }
];

describe('cards de boas-vindas × navegação lateral', () => {
	for (const { nome, usuario, modulo, extra } of CENARIOS) {
		describe(nome, () => {
			const flags = flagsDe(usuario, modulo, extra);
			const cards = cardsBemVindo({ usuario, flags });
			const hrefs = cards.map((c) => c.href);
			const menu = destinosDoMenu(usuario, flags);

			it('todo destino do menu tem card', () => {
				expect([...menu].sort()).toEqual([...new Set(hrefs)].sort());
			});

			it('nenhum card duplicado', () => {
				expect(new Set(hrefs).size).toBe(hrefs.length);
			});

			it('todo card tem título, descrição e chamada', () => {
				for (const c of cards) {
					expect(c.titulo.length, `título de ${c.href}`).toBeGreaterThan(2);
					expect(c.descricao.length, `descrição de ${c.href}`).toBeGreaterThan(20);
					expect(c.cta.length, `cta de ${c.href}`).toBeGreaterThan(2);
				}
			});
		});
	}

	it('Super Admin não recebe as abas operacionais do dia a dia', () => {
		const flags = flagsDe(SUPER, 'ambas');
		const hrefs = cardsBemVindo({ usuario: SUPER, flags }).map((c) => c.href);
		expect(hrefs).not.toContain('/escalas');
		expect(hrefs).not.toContain('/gise');
		expect(hrefs).not.toContain('/perfil');
	});

	it('sessão de admin não recebe "Meu perfil" (não tem cadastro de policial)', () => {
		const flags = flagsDe(ADM_GERAL, 'ambas');
		expect(cardsBemVindo({ usuario: ADM_GERAL, flags }).map((c) => c.href)).not.toContain(
			'/perfil'
		);
	});

	it('o verbo do card de escalas segue o cargo, como o servidor', () => {
		const dpc = cardsBemVindo({
			usuario: ADM_UNIDADE_DPC,
			flags: flagsDe(ADM_UNIDADE_DPC, 'ambas')
		}).find((c) => c.href === '/escalas');
		const oip = cardsBemVindo({
			usuario: ADM_UNIDADE_OIP,
			flags: flagsDe(ADM_UNIDADE_OIP, 'ambas')
		}).find((c) => c.href === '/escalas');
		// DPC assina (podeAssinarEscala); OIP cria e SOLICITA
		// (podeOIPSolicitarAssinatura) — server/escalas/permissao.ts.
		expect(dpc?.descricao).toMatch(/assine/i);
		expect(oip?.descricao).toMatch(/pe(ç|c)a .* assinatura|solicit/i);
		// FDS não tem assinatura digital: o card de quem ASSINA não a promete.
		expect(dpc?.descricao).not.toMatch(/fim de semana/i);
		expect(oip?.descricao).toMatch(/fim de semana/i);
	});

	it('usuário sem sessão não recebe card nenhum', () => {
		expect(cardsBemVindo({ usuario: null, flags: flagsDe(POLICIAL, 'ambas') })).toEqual([]);
	});
});
