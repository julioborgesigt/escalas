/**
 * COMO uma GISE está sendo finalizada — normal ou antecipada.
 *
 * A escada de status leva a `pronta_para_finalizar` só depois do documento
 * principal assinado e de todos os relatórios de extra assinados. Finalizar a
 * partir de `em_andamento` pula esse conjunto inteiro.
 *
 * Essa saída EXISTE de propósito: há GISE cujos relatórios nunca chegam, e o
 * Admin Geral precisa poder encerrar sem mexer no banco. O que estava errado
 * não era ela existir — era ser **silenciosa** (FLW-GISE-005). A tela oferecia
 * o botão nos dois estados sem distinção, o modal não mencionava relatório
 * nenhum, e a trilha registrava as duas do mesmo jeito. Pior: a mensagem de
 * erro da API dizia "precisa estar com todos os relatórios de extra assinados"
 * e mesmo assim aceitava `em_andamento` — a condição contradizia o texto ao
 * lado dela.
 *
 * Módulo PURO e client-safe de propósito: quem decide (as duas rotas de
 * finalização) e quem avisa (o modal) precisam da MESMA resposta. Se a tela
 * recalculasse "é antecipada?" por conta própria, o aviso e o gate divergiriam
 * no primeiro estado novo da escada.
 */

/** Único estado em que a finalização é a esperada pelo fluxo. */
const STATUS_COMPLETO = 'pronta_para_finalizar';

/** Estado a partir do qual o Admin Geral pode encerrar sem o conjunto documental. */
const STATUS_ANTECIPAVEL = 'em_andamento';

export type ModoFinalizacao = 'normal' | 'antecipada' | 'bloqueado';

/**
 * `normal` — a escala percorreu a escada inteira.
 * `antecipada` — encerramento sem o conjunto documental; permitido, mas
 *   registrado como tal.
 * `bloqueado` — qualquer outro estado, inclusive `finalizada`.
 */
export function modoDeFinalizacao(status: string): ModoFinalizacao {
	if (status === STATUS_COMPLETO) return 'normal';
	if (status === STATUS_ANTECIPAVEL) return 'antecipada';
	return 'bloqueado';
}

/**
 * O que a finalização antecipada deixa para trás, para o modal enumerar.
 *
 * Não é decoração: é a diferença entre o Admin Geral clicar sabendo o que faz e
 * clicar num botão que só diz "não poderá ser desfeita".
 */
export const PENDENCIAS_DA_ANTECIPADA = [
	'confirmações de saída dos policiais escalados',
	'relatórios de extra das seccionais',
	'assinaturas desses relatórios'
] as const;
