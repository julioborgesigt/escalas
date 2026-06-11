/**
 * Hook de estados derivados e helpers para a página GISE detalhada.
 * Centraliza permissões, formatação e detecção de dispositivo.
 */

import type { GiseDetalhado } from '$lib/db';
import { SvelteDate } from 'svelte/reactivity';

interface GiseData {
	gise?: GiseDetalhado | null;
	policiais?: unknown[];
	todasUnidades?: unknown[];
	papelGise?: string;
	minhaSeccionalId?: number | null;
	isGeral?: boolean;
	isSeccional?: boolean;
	isUnidade?: boolean;
	isSupervisor?: boolean;
	isMembro?: boolean;
	usuarioAtual?: { id: number } | null;
}

export interface GiseEstadoParams {
	getData: () => GiseData;
}

export function useGiseEstado({ getData }: GiseEstadoParams) {
	const _data = $derived(getData());
	const gise = $derived(_data.gise);
	const policiais = $derived(_data.policiais ?? []);
	const todasUnidades = $derived(_data.todasUnidades ?? []);
	const papelGise = $derived(_data.papelGise);
	const minhaSeccionalId = $derived(_data.minhaSeccionalId ?? null);

	// Permissões
	const isAdminGeral = $derived(_data.isGeral === true);
	const isSeccional = $derived(_data.isSeccional === true);
	const isUnidade = $derived(_data.isUnidade === true);
	const isSupervisor = $derived(
		_data.isSupervisor === true || gise?.supervisor_id === _data.usuarioAtual?.id
	);
	const isMembro = $derived(_data.isMembro === true);

	const minhaSeccional = $derived(
		isSeccional
			? gise?.seccionais?.find((s) => s.seccional_id === minhaSeccionalId)
			: null
	);

	const todasSeccionaisPreenchidas = $derived(
		(gise?.seccionais?.length ?? 0) > 0 &&
			(gise?.seccionais?.every(
				(s) => s.status === 'preenchida' || s.status === 'preenchida_retificada'
			) ?? false)
	);

	const editaBloqueado = $derived(
		gise?.status === 'aguardando_assinatura' ||
			gise?.status === 'em_andamento' ||
			gise?.status === 'aguardando_relatorios' ||
			gise?.status === 'aguardando_assinatura_relat' ||
			gise?.status === 'pronta_para_finalizar' ||
			gise?.status === 'finalizada'
	);

	const podeDownload = $derived(isAdminGeral || isSeccional || isSupervisor);
	const podeEditar = $derived(!editaBloqueado);

	// Helpers de status
	const STATUS_MAP: Record<string, string> = {
		em_definicao_supervisor: 'Em definição do supervisor',
		em_preenchimento: 'Preenchendo escalados',
		aguardando_assinatura: 'Aguardando assinatura do supervisor (escala)',
		em_andamento: 'GISE em operação',
		aguardando_relatorios: 'Aguardando entradas',
		aguardando_assinatura_relat: 'Aguardando assinatura do supervisor (extras)',
		pronta_para_finalizar: 'Pronta para finalizar',
		finalizada: 'Concluída'
	};

	const STATUS_COLOR: Record<string, string> = {
		em_definicao_supervisor: 'bg-surface-500/15 text-surface-600 dark:text-surface-300',
		em_preenchimento: 'bg-warning-500/15 text-warning-700 dark:text-warning-400',
		aguardando_assinatura: 'bg-primary-500/15 text-primary-700 dark:text-primary-400',
		em_andamento: 'bg-success-500/15 text-success-700 dark:text-success-400',
		aguardando_relatorios: 'bg-info-500/15 text-info-700 dark:text-info-400',
		aguardando_assinatura_relat: 'bg-secondary-500/15 text-secondary-700 dark:text-secondary-400',
		pronta_para_finalizar: 'bg-success-500/20 text-success-800 dark:text-success-300',
		finalizada: 'bg-surface-500/15 text-surface-600 dark:text-surface-400'
	};

	function statusLabel(status: string): string {
		return STATUS_MAP[status] ?? status;
	}

	function statusColor(status: string): string {
		return STATUS_COLOR[status] ?? 'bg-surface-500/10 text-surface-600';
	}

	// Helpers de data
	function fmtDate(iso: string): string {
		const d = new SvelteDate(iso + 'T00:00:00');
		return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
	}

	function diaSemana(iso: string): string {
		const d = new SvelteDate(iso + 'T00:00:00');
		return d.toLocaleDateString('pt-BR', { weekday: 'long' });
	}

	// Detecção de mobile via matchMedia (confiável e reativa a resize)
	let isMobile = $state(
		typeof window !== 'undefined' ? !window.matchMedia('(min-width: 768px)').matches : true
	);
	$effect(() => {
		const mql = window.matchMedia('(min-width: 768px)');
		isMobile = !mql.matches;
		const handler = (e: MediaQueryListEvent) => (isMobile = !e.matches);
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	});

	return {
		get gise() {
			return gise;
		},
		get policiais() {
			return policiais;
		},
		get todasUnidades() {
			return todasUnidades;
		},
		get isAdminGeral() {
			return isAdminGeral;
		},
		get isSeccional() {
			return isSeccional;
		},
		get isUnidade() {
			return isUnidade;
		},
		get isSupervisor() {
			return isSupervisor;
		},
		get isMembro() {
			return isMembro;
		},
		get minhaSeccional() {
			return minhaSeccional;
		},
		get minhaSeccionalId() {
			return minhaSeccionalId;
		},
		get todasSeccionaisPreenchidas() {
			return todasSeccionaisPreenchidas;
		},
		get editaBloqueado() {
			return editaBloqueado;
		},
		get podeDownload() {
			return podeDownload;
		},
		get podeEditar() {
			return podeEditar;
		},
		get isMobile() {
			return isMobile;
		},
		statusLabel,
		statusColor,
		fmtDate,
		diaSemana
	};
}
