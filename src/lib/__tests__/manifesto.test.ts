import { describe, it, expect } from 'vitest';
import { podeBaixarComManifesto } from '../manifesto';
import type { UsuarioLogado } from '../auth';

/**
 * `podeBaixarComManifesto` decide quem recebe o PDF assinado ÍNTEGRO — o que
 * carrega a página de manifesto forense com CPF, IP, GPS e selfie de quem
 * assinou. Quem não passa recebe a cópia de conferência, sem esses dados.
 *
 * O módulo existe separado justamente para que a UI esconda o botão com a MESMA
 * regra que o servidor aplica no download; são 14 call sites entre rotas de API
 * e componentes. Até esta data a regra não tinha teste nenhum, enquanto sua
 * irmã `podeBaixarForense` (o gate equivalente do portal público) tinha seis.
 * Uma varredura de mutação confirmou o custo: trocar o corpo por `return true`
 * não derrubava a suíte.
 *
 * O par (usuário, assinanteId) é o que importa aqui — não basta o papel.
 */

function admin(over: Partial<UsuarioLogado> = {}): UsuarioLogado {
	return { id: 1, tipo: 'admin', nome: 'Admin Geral', primeiro_acesso: false, ...over };
}

function policial(over: Partial<UsuarioLogado> = {}): UsuarioLogado {
	return {
		id: 2,
		tipo: 'policial',
		nome: 'Policial',
		primeiro_acesso: false,
		papel: null,
		cargo: 'DPC',
		...over
	};
}

describe('podeBaixarComManifesto — pelo papel', () => {
	it('Admin Geral recebe, mesmo sem assinante informado', () => {
		expect(podeBaixarComManifesto(admin())).toBe(true);
	});

	it('Super Admin recebe (é sessão de admin)', () => {
		expect(podeBaixarComManifesto(admin({ isSuperAdmin: true }))).toBe(true);
	});

	it('admin de unidade/seccional NÃO recebe pelo papel — não é sessão de admin', () => {
		expect(podeBaixarComManifesto(policial({ papel: 'admin_unidade' }))).toBe(false);
		expect(podeBaixarComManifesto(policial({ papel: 'admin_seccional' }))).toBe(false);
	});

	it('policial sem papel não recebe', () => {
		expect(podeBaixarComManifesto(policial())).toBe(false);
	});

	it('sem sessão não recebe', () => {
		expect(podeBaixarComManifesto(null)).toBe(false);
		expect(podeBaixarComManifesto(undefined)).toBe(false);
	});
});

describe('podeBaixarComManifesto — pelo vínculo com a assinatura', () => {
	it('DPC que assinou recebe o próprio documento', () => {
		expect(podeBaixarComManifesto(policial({ id: 7, cargo: 'DPC' }), 7)).toBe(true);
	});

	it('DPC que NÃO assinou não recebe — o vínculo é com a assinatura, não com o cargo', () => {
		expect(podeBaixarComManifesto(policial({ id: 7, cargo: 'DPC' }), 8)).toBe(false);
	});

	it('OIP que assinou não recebe — a regra do assinante exige cargo DPC', () => {
		expect(podeBaixarComManifesto(policial({ id: 7, cargo: 'OIP' }), 7)).toBe(false);
	});

	/**
	 * `assinanteId` nulo/ausente NEGA a regra do assinante — e isso é observável
	 * em produção: `escalas/[id]/download` chama sem o argumento, então lá um DPC
	 * não alcança com manifesto a escala que ele mesmo assinou, enquanto em
	 * `gise/[id]/download` (que passa o id) alcança. A assimetria fica registrada
	 * aqui: se algum dia ela for resolvida, é este teste que precisa mudar junto.
	 */
	it('sem assinanteId, o DPC não recebe — só a regra de admin sobrevive', () => {
		expect(podeBaixarComManifesto(policial({ id: 7, cargo: 'DPC' }))).toBe(false);
		expect(podeBaixarComManifesto(policial({ id: 7, cargo: 'DPC' }), null)).toBe(false);
	});

	it('a regra de admin não depende do assinante — admin passa com id de outro', () => {
		expect(podeBaixarComManifesto(admin({ id: 1 }), 999)).toBe(true);
	});

	/** `id` coincidente entre tipos diferentes não cria vínculo. */
	it('admin e policial com o mesmo id não se confundem', () => {
		expect(podeBaixarComManifesto(policial({ id: 1, cargo: 'DPC' }), 1)).toBe(true);
		expect(podeBaixarComManifesto(policial({ id: 1, cargo: 'OIP' }), 1)).toBe(false);
	});
});
