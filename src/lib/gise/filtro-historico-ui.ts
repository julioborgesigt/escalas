/**
 * Tokens visuais da busca detalhada do histórico GISE.
 *
 * `/res-gise` (policial) e `/gise` (admin) compartilham a mesma barra; o admin
 * só acrescenta o seletor de seccional. No telefone os controles ficam um
 * degrau abaixo do desktop (`h-10` / `text-2xs`) para caber na largura do
 * card; a partir de `sm` voltam ao tamanho de leitura (`h-11` / `text-sm`).
 */

export const OPCOES_TIPO_EQUIPE = [
	['', 'Todos'],
	['operacional', 'Operacional'],
	['seint', 'SEINT']
] as const;

export const OPCOES_PERIODO = [
	['ciclo', 'Ciclo'],
	['mes', 'Mês'],
	['data', 'Data específica']
] as const;

/** "Data específica" não cabe no segmento do telefone; o campo abaixo já diz o nome. */
export const ROTULO_PERIODO_DATA_MOBILE = 'Data';

export const CLASSE_ROTULO_FILTRO =
	'text-2xs sm:text-xs font-black text-surface-600 dark:text-surface-400 uppercase tracking-wider ml-0.5';

export const CLASSE_BARRA_FILTRO =
	'flex flex-col sm:flex-row sm:flex-wrap xl:flex-nowrap sm:items-end gap-3 sm:gap-2 bg-surface-100/50 dark:bg-surface-800/30 p-3 rounded-xl border border-surface-200 dark:border-surface-800';

export const CLASSE_CAMPO_FILTRO = 'flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:shrink-0';

export const CLASSE_SELETOR_SEGMENTO = 'w-full sm:w-fit h-10 sm:h-11';

export const CLASSE_CONTROLE_SEGMENTO =
	'inline-flex items-center w-full min-w-0 sm:w-fit h-10 sm:h-11 overflow-hidden rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 p-0.5 gap-0.5';

export const CLASSE_ITEM_SEGMENTO =
	'flex flex-1 sm:flex-none min-w-0 items-center justify-center h-full px-2 sm:px-3.5 text-center text-2xs sm:text-sm font-semibold leading-tight whitespace-nowrap rounded-lg cursor-pointer select-none transition-colors duration-200 text-surface-600 dark:text-surface-400 data-[state=checked]:bg-primary-500 data-[state=checked]:text-white data-[state=checked]:shadow-md data-[state=checked]:shadow-primary-500/25 hover:text-surface-700 dark:hover:text-surface-200';

export const CLASSE_INPUT_FILTRO =
	'box-border block h-10 sm:h-11 min-w-0 px-2.5 sm:px-3.5 text-xs sm:text-sm rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 font-semibold shadow-sm focus:ring-2 focus:ring-primary-500 transition-all';
