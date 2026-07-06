/**
 * Domínios dos campos cadastrais editáveis do policial — compartilhados entre
 * o cadastro administrativo (/policiais) e a página "Meu perfil".
 */

/** Classes válidas por cargo. */
export function classesDoCargo(cargo: string): string[] {
	return cargo === 'DPC' ? ['1ª', '2ª', '3ª', 'ESPECIAL'] : ['A', 'B', 'C', 'D'];
}

/** Telefone: dígitos e separadores usuais, 8–20 caracteres. */
export const TELEFONE_RE = /^[0-9()+\-\s]{8,20}$/;

export type CampoSolicitacao = 'telefone' | 'classe' | 'regime' | 'lotacao';

/** Rótulos de exibição dos campos alteráveis via solicitação. */
export const ROTULO_CAMPO: Record<CampoSolicitacao, string> = {
	telefone: 'Telefone',
	classe: 'Classe',
	regime: 'Regime de trabalho',
	lotacao: 'Lotação'
};
