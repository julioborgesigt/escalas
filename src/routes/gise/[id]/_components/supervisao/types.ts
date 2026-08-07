/**
 * Tipos compartilhados do quadro de supervisão GISE.
 *
 * Usados por designação, rodagem e documentos — evita redefinir a mesma
 * forma de `gise`/`policial`/`presença` em cada pedaço do card.
 */

import type { SubmitFunction } from '@sveltejs/kit';
import type { Snippet } from 'svelte';
import type { GiseAssinaturaRelatorio } from '$lib/server/schema';

export type PresencaGiseLinha = {
	policial_id: number;
	entrada_timestamp: string | null;
	saida_timestamp: string | null;
};

export interface GiseSupervisaoGise {
	id: number;
	data_inicio: string;
	supervisor_id: number | null;
	supervisor_nome: string | null;
	assessor_id: number | null;
	assessor_email_notificacao?: string | null;
	assessor_nome?: string | null;
	seint1_id: number | null;
	seint1_nome?: string | null;
	seint2_id: number | null;
	seint2_nome?: string | null;
	status: string;
	seccionais?: { status: string; seccional_nome: string }[];
}

export interface PolicialOpcao {
	id: number;
	nome: string;
	matricula: string;
	cargo: string;
	email?: string | null;
	email_pessoal?: string | null;
}

export interface DocumentoAssinadoInfo {
	existe: boolean;
	assinante_nome: string;
	/** Quem assinou (policiais.id) — decide a visibilidade do "C/ manifesto". */
	assinante_id?: number | null;
}

export type LoadOptionsFn = (
	query: string,
	signal: AbortSignal
) => Promise<{ value: number | null; label: string }[]>;

export type SelectedOption = { value: number | null; label: string } | null;

/** Os quatro papéis designáveis no quadro (edição é por papel). */
export type PapelSupervisao = 'supervisor' | 'assessor' | 'seint1' | 'seint2';

/** Props públicas do orquestrador `GiseSupervisao` (facade estável para a página). */
export interface GiseSupervisaoProps {
	gise: GiseSupervisaoGise;
	policiais: PolicialOpcao[];
	isAdminGeral: boolean;
	isSeccional: boolean;
	podeEditar: boolean;
	modoEdicaoGeral: boolean;
	editando: boolean;
	documentoAssinadoInfo: DocumentoAssinadoInfo | null;
	pendingCrud: boolean;
	buscarDpcs: LoadOptionsFn;
	buscarOips: LoadOptionsFn;
	selectedFromPoliciais: (id: number | null) => SelectedOption;
	supervisorId: number | null;
	assessorId: number | null;
	/** E-mail onde o assessor recebe aviso quando uma seccional envia a GISE (confirmado pelo Admin Geral). */
	assessorEmailNotificacao?: string;
	seint1Id: number | null;
	seint2Id: number | null;
	/** Presenças da GISE (entrada/saída) para marcadores do quadro. */
	presencasGise?: PresencaGiseLinha[] | null;
	/** Policiais SEINT do quadro que já enviaram relatório SEINT (sem `equipe_id`). */
	seintSupervisaoComRelatorio?: number[];
	/** Relatório de extra do quadro (unidade sintética). */
	supervisaoExtraUnidadeId?: number | null;
	assinaturasRelatorios?: GiseAssinaturaRelatorio[] | null;
	podeDownload?: boolean;
	isSupervisor?: boolean;
	isMobile?: boolean;
	onAssinarExtraSupervisaoManual?: () => void;
	onAssinarExtraSupervisaoDigital?: () => void;
	/** Exibe o painel de assinatura da escala (supervisor) dentro deste card, antes do relatório de extra. */
	mostrarPainelAssinaturaEscala?: boolean;
	assinaturaEscalaSignerEmail?: string;
	rubricaCapturada?: string | null | undefined;
	painelTokenGise?: { assinarComSerpro: () => Promise<void> } | null | undefined;
	serproSignerName?: string | undefined;
	serproSignerCpf?: string | undefined;
	onAbrirAssinaturaEscalaManual: () => void;
	onAssinaturaEscalaDigitalSuccess: () => Promise<void>;
	loteSection?: Snippet;
	onEditar: () => void;
	onCancelar: () => void;
	onSubmit: SubmitFunction;
}
