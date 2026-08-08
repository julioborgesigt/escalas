/**
 * Hook de estados derivados e helpers para a página GISE detalhada.
 * Centraliza permissões, formatação e detecção de dispositivo.
 */

import type { GiseDetalhado } from '$lib/db';
import type { Unidade } from '$lib/types';
import { statusLabel, statusColor } from '$lib/gise/formatters';
import { MediaQuery, SvelteDate } from 'svelte/reactivity';

interface GiseData {
	gise?: GiseDetalhado | null;
	policiais?: unknown[];
	todasUnidades?: Unidade[];
	papelGise?: string;
	minhaSeccionalId?: number | null;
	isGeral?: boolean;
	isSeccional?: boolean;
	isUnidade?: boolean;
	isSupervisor?: boolean;
	isMembro?: boolean;
	usuarioAtual?: { id: number } | null;
}

interface GiseEstadoParams {
	getData: () => GiseData;
}

export function useGiseEstado({ getData }: GiseEstadoParams) {
	const _data = $derived(getData());
	const gise = $derived(_data.gise);
	const policiais = $derived(_data.policiais ?? []);
	const todasUnidades = $derived(_data.todasUnidades ?? []);
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
		isSeccional ? gise?.seccionais?.find((s) => s.seccional_id === minhaSeccionalId) : null
	);

	const todasSeccionaisPreenchidas = $derived(
		(gise?.seccionais?.length ?? 0) > 0 &&
			(gise?.seccionais?.every(
				(s) => s.status === 'preenchida' || s.status === 'preenchida_retificada'
			) ??
				false)
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

	// Helpers de data (rótulos/cores de status vêm de `$lib/gise/formatters`)
	function fmtDate(iso: string): string {
		const d = new SvelteDate(iso + 'T00:00:00');
		return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
	}

	function diaSemana(iso: string): string {
		const d = new SvelteDate(iso + 'T00:00:00');
		return d.toLocaleDateString('pt-BR', { weekday: 'long' });
	}

	// Detecção de mobile via MediaQuery (svelte/reactivity): reativa a resize,
	// sem addEventListener manual; fallback `false` = mobile-first no SSR.
	const desktopQuery = new MediaQuery('(min-width: 768px)', false);
	const isMobile = $derived(!desktopQuery.current);

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
