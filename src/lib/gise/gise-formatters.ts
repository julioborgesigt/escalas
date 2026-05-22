const STATUS_LABELS: Record<string, string> = {
	em_definicao_supervisor: 'Em definição do supervisor',
	em_preenchimento: 'Preenchendo escalados',
	aguardando_assinatura: 'Aguardando assinatura do supervisor (escala)',
	em_andamento: 'GISE em operação',
	aguardando_relatorios: 'Aguardando entradas',
	aguardando_assinatura_relat: 'Aguardando assinatura do supervisor (extras)',
	pronta_para_finalizar: 'Pronta para finalizar',
	finalizada: 'Concluída'
};

const STATUS_COLORS: Record<string, string> = {
	em_definicao_supervisor: 'bg-surface-500/15 text-surface-600 dark:text-surface-300',
	em_preenchimento: 'bg-warning-500/15 text-warning-700 dark:text-warning-400',
	aguardando_assinatura: 'bg-primary-500/15 text-primary-700 dark:text-primary-400',
	em_andamento: 'bg-success-500/15 text-success-700 dark:text-success-400',
	aguardando_relatorios: 'bg-info-500/15 text-info-700 dark:text-info-400',
	aguardando_assinatura_relat: 'bg-secondary-500/15 text-secondary-700 dark:text-secondary-400',
	pronta_para_finalizar: 'bg-success-500/20 text-success-800 dark:text-success-300',
	finalizada: 'bg-surface-500/15 text-surface-600 dark:text-surface-400'
};

export function statusLabel(status: string): string {
	return STATUS_LABELS[status] ?? status;
}

export function statusColor(status: string): string {
	return STATUS_COLORS[status] ?? '';
}

export function fmtDate(iso: string): string {
	if (!iso) return '';
	const [y, m, d] = iso.split('-');
	return `${d}/${m}/${y}`;
}

export function diaSemana(iso: string): string {
	if (!iso) return '';
	const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
	return dias[new Date(iso + 'T12:00:00').getDay()];
}
