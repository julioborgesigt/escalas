<script lang="ts">
	/**
	 * Card do QUADRO DE SUPERVISÃO da GISE — supervisor (DPC), assessor e os dois
	 * SEINT. São os quatro papéis que não pertencem a nenhuma seccional, e é por
	 * isso que ficam num card próprio, acima da lista de seccionais.
	 *
	 * O card acumula três responsabilidades que na tela são a mesma coisa:
	 *   1. DESIGNAR os papéis (Admin Geral), um por vez;
	 *   2. mostrar a RODAGEM de cada integrante — entrada, saída e, para o SEINT,
	 *      o relatório entregue;
	 *   3. hospedar as ASSINATURAS que são do quadro e não de uma seccional: a da
	 *      escala GISE (quando `mostrarPainelAssinaturaEscala`) e a do relatório
	 *      de extra da "unidade sintética" de supervisão.
	 *
	 * Decisões que o markup não explica:
	 *
	 * - a edição é POR PAPEL (`editandoPapel`), não do card inteiro: trocar o
	 *   assessor não pode obrigar a reconfirmar supervisor e SEINT;
	 * - `idsPapel` é um objeto com getters/setters em vez de quatro variáveis
	 *   soltas porque snippet não aceita prop `$bindable` — `bind:` numa
	 *   propriedade de objeto funciona, e os accessors fazem proxy para as props
	 *   bindables, mantendo a API do componente intacta;
	 * - remover uma designação submete o form por `requestSubmit()` depois de
	 *   `tick()`: os inputs hidden precisam já refletir o `null`. A versão
	 *   anterior usava `setTimeout(50)` e corria com o DOM;
	 * - o bloco de extra aparece sempre que existe quadro nomeado
	 *   (`quadroSupervisaoExtraExigeRelatorio`), independentemente de
	 *   `podeDownload` — senão o card desaparecia para o DPC, que precisa vê-lo
	 *   para assinar. O que a permissão controla é o BOTÃO, não o bloco;
	 * - o download do relatório de extra exige rubricas completas de TODO o
	 *   quadro (`supervisaoExtraRubricasCompletas`); faltando alguém, o motivo é
	 *   mostrado com os primeiros nomes (`faltantesSupervisaoExtra`).
	 */
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick } from 'svelte';
	import type { Snippet } from 'svelte';
	import SearchableSelect from '$lib/components/SearchableSelect.svelte';
	import PainelAssinaturaToken from '$lib/components/PainelAssinaturaToken.svelte';
	import SupervisaoDocumentoCard from './SupervisaoDocumentoCard.svelte';
	import MarcadorPresenca from './MarcadorPresenca.svelte';
	import { UserRound, Users, FileDown, Clock, PenLine, Trash2 } from 'lucide-svelte';
	import Spinner from '$lib/components/Spinner.svelte';
	import {
		estadoMarcadorRodagemSupervisao,
		quadroSupervisaoExtraExigeRelatorio,
		supervisaoExtraRubricasCompletas,
		faltantesSupervisaoExtra,
		FALTANTE_RUBRICA_SUPER_PREFIX
	} from '$lib/gise/supervisao-extra';
	import type { GiseAssinaturaRelatorio } from '$lib/server/schema';
	import { podeBaixarComManifesto } from '$lib/manifesto';
	import { SvelteMap } from 'svelte/reactivity';

	type PresencaGiseLinha = {
		policial_id: number;
		entrada_timestamp: string | null;
		saida_timestamp: string | null;
	};

	interface Gise {
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

	interface Policial {
		id: number;
		nome: string;
		matricula: string;
		cargo: string;
		email?: string | null;
		email_pessoal?: string | null;
	}

	interface DocumentoAssinadoInfo {
		existe: boolean;
		assinante_nome: string;
		/** Quem assinou (policiais.id) — decide a visibilidade do "C/ manifesto". */
		assinante_id?: number | null;
	}

	type LoadOptionsFn = (
		query: string,
		signal: AbortSignal
	) => Promise<{ value: number | null; label: string }[]>;

	type SelectedOption = { value: number | null; label: string } | null;

	interface Props {
		gise: Gise;
		policiais: Policial[];
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

	let {
		gise,
		policiais,
		isAdminGeral,
		isSeccional,
		podeEditar,
		modoEdicaoGeral,
		editando = $bindable(false),
		documentoAssinadoInfo,
		pendingCrud,
		buscarDpcs,
		buscarOips,
		selectedFromPoliciais,
		supervisorId = $bindable(),
		assessorId = $bindable(),
		assessorEmailNotificacao = $bindable(''),
		seint1Id = $bindable(),
		seint2Id = $bindable(),
		presencasGise = null,
		seintSupervisaoComRelatorio = [],
		supervisaoExtraUnidadeId = null,
		assinaturasRelatorios = null,
		podeDownload = false,
		isSupervisor = false,
		isMobile = false,
		onAssinarExtraSupervisaoManual,
		onAssinarExtraSupervisaoDigital,
		mostrarPainelAssinaturaEscala = false,
		assinaturaEscalaSignerEmail = undefined,
		rubricaCapturada = $bindable(null),
		painelTokenGise = $bindable(null),
		serproSignerName = $bindable(''),
		serproSignerCpf = $bindable(''),
		onAbrirAssinaturaEscalaManual,
		onAssinaturaEscalaDigitalSuccess,
		loteSection,
		onEditar,
		onCancelar,
		onSubmit
	}: Props = $props();

	const seintRelatorioSet = $derived(new Set(seintSupervisaoComRelatorio ?? []));

	function marcador(
		papel: 'supervisor' | 'assessor' | 'seint',
		policialId: number | null | undefined
	) {
		return estadoMarcadorRodagemSupervisao(
			papel,
			policialId,
			presencasGise ?? [],
			seintRelatorioSet
		);
	}

	/**
	 * Estado de entrada/saída do integrante, para o `<MarcadorPresenca>` exibido ao
	 * lado do rótulo do papel. Deriva das MESMAS presenças que alimentam
	 * `estadoMarcadorRodagemSupervisao`; `faltaRelatorio` só se aplica ao SEINT.
	 */
	function presencaDe(policialId: number | null | undefined) {
		const p = (presencasGise ?? []).find((x) => x.policial_id === policialId);
		return {
			entrada: !!p?.entrada_timestamp,
			saida: !!p?.saida_timestamp
		};
	}

	const nomesSupervisaoPorId = $derived.by(() => {
		const m = new SvelteMap<number, string>();
		if (gise.supervisor_id && gise.supervisor_nome) m.set(gise.supervisor_id, gise.supervisor_nome);
		if (gise.assessor_id && gise.assessor_nome) m.set(gise.assessor_id, gise.assessor_nome);
		if (gise.seint1_id && gise.seint1_nome) m.set(gise.seint1_id, gise.seint1_nome);
		if (gise.seint2_id && gise.seint2_nome) m.set(gise.seint2_id, gise.seint2_nome);
		for (const p of policiais) {
			if (!m.has(p.id)) m.set(p.id, p.nome);
		}
		return m;
	});

	/** Sempre que existir quadro de supervisão com extra — não depende de `podeDownload` (evita sumir para o DPC). */
	const mostrarBlocoExtraSupervisao = $derived(quadroSupervisaoExtraExigeRelatorio(gise));

	const extraSupervisaoConfigurado = $derived(supervisaoExtraUnidadeId != null);

	const assRelSup = $derived(
		supervisaoExtraUnidadeId == null
			? undefined
			: assinaturasRelatorios?.find(
					(a) => a.seccional_id === supervisaoExtraUnidadeId && a.tipo === 'extraordinario'
				)
	);
	const rubSupOk = $derived(supervisaoExtraRubricasCompletas(gise, presencasGise ?? []));
	const faltSup = $derived(
		faltantesSupervisaoExtra(gise, presencasGise ?? [], nomesSupervisaoPorId)
	);

	const downloadExtraSupHabilitado = $derived(
		extraSupervisaoConfigurado &&
			!!podeDownload &&
			rubSupOk &&
			(assRelSup || isAdminGeral || isSeccional || isSupervisor)
	);
	const downloadExtraSupConferenciaHabilitado = $derived(
		extraSupervisaoConfigurado && (isAdminGeral || isSupervisor)
	);
	const assinaturaEscalaHabilitada = $derived(!!podeDownload);
	const assinaturaExtraHabilitada = $derived(!!rubSupOk && !!extraSupervisaoConfigurado);
	const mostrarPainelAssinaturaEscalaReadonly = $derived(
		isAdminGeral && !documentoAssinadoInfo?.existe
	);
	const seccionaisPendentes = $derived(
		gise.seccionais?.filter(
			(s) => s.status !== 'preenchida' && s.status !== 'preenchida_retificada'
		) || []
	);

	const urlDocumentoAssinado = $derived(`/api/gise/${gise.id}/documento-assinado`);
	const urlDocumentoAssinadoManifesto = $derived(
		`/api/gise/${gise.id}/documento-assinado?manifesto=true`
	);
	const urlDownloadPdf = $derived(`/api/gise/${gise.id}/download?format=pdf`);
	const urlDownloadExtra = $derived(
		`/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${supervisaoExtraUnidadeId}`
	);
	const urlDownloadExtraManifesto = $derived(
		`/api/gise/${gise.id}/download?format=extraordinario&seccionalId=${supervisaoExtraUnidadeId}&manifesto=true`
	);

	let expandirEscala = $state(false);
	let expandirExtra = $state(false);
	let formEl = $state<HTMLFormElement | null>(null);

	type Papel = 'supervisor' | 'assessor' | 'seint1' | 'seint2';

	let editandoPapel = $state<Papel | null>(null);
	let removendoPapel = $state<Papel | null>(null);

	/**
	 * Visão-objeto dos quatro binds de papel. Snippets não aceitam props
	 * `$bindable`, mas `bind:value={idsPapel[papel]}` em propriedade de objeto
	 * funciona — os accessors fazem proxy para as props bindables, mantendo a
	 * API do componente (e o pai) intacta.
	 */
	const idsPapel = {
		get supervisor() {
			return supervisorId;
		},
		set supervisor(v: number | null) {
			supervisorId = v;
		},
		get assessor() {
			return assessorId;
		},
		set assessor(v: number | null) {
			assessorId = v;
		},
		get seint1() {
			return seint1Id;
		},
		set seint1(v: number | null) {
			seint1Id = v;
		},
		get seint2() {
			return seint2Id;
		},
		set seint2(v: number | null) {
			seint2Id = v;
		}
	};

	/** Valor persistido (do `gise`) de cada papel, para cancelamento de edição. */
	const idPersistido: Record<Papel, () => number | null> = {
		supervisor: () => gise.supervisor_id ?? null,
		assessor: () => gise.assessor_id ?? null,
		seint1: () => gise.seint1_id ?? null,
		seint2: () => gise.seint2_id ?? null
	};

	$effect(() => {
		if (!pendingCrud) {
			removendoPapel = null;
		}
	});

	function iniciarEdicao(papel: Papel) {
		editandoPapel = papel;
		onEditar();
	}

	function cancelarEdicao() {
		if (editandoPapel) {
			idsPapel[editandoPapel] = idPersistido[editandoPapel]();
			if (editandoPapel === 'assessor') {
				assessorEmailNotificacao = gise.assessor_email_notificacao ?? '';
			}
		}
		editandoPapel = null;
		onCancelar();
	}

	function excluirMembro(papel: Papel) {
		if (!confirm('Deseja realmente remover esta designação?')) return;

		removendoPapel = papel;
		idsPapel[papel] = null;
		if (papel === 'assessor') {
			assessorEmailNotificacao = '';
		}

		// Garante que o estado seja atualizado nos inputs hidden antes de submeter
		// (tick() é determinístico; setTimeout(50) era uma corrida com o DOM).
		void tick().then(() => {
			if (formEl) {
				formEl.requestSubmit();
			}
		});
	}

	$effect(() => {
		editando = editandoPapel !== null;
	});

	$effect(() => {
		if (!editando) {
			editandoPapel = null;
		}
	});
</script>

<!-- Par Salvar/Cancelar da edição inline — repetia-se nos 4 slots.
     Mesmo estilo dos botões "Adicionar/Fechar" que alocam policiais na equipe:
     rótulos em texto, preenchido (primário) + contornado. No mobile os dois
     dividem UMA linha em partes iguais (`grid-cols-2`); em sm+ voltam à
     largura natural, lado a lado com o campo de busca. -->
{#snippet botoesSalvarCancelar(papel: Papel, classe: string = '')}
	<div class="w-full grid grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0 {classe}">
		<button
			type="submit"
			class="btn preset-filled-primary-500 text-sm px-3 py-1.5 rounded-lg w-full sm:w-auto transition-all"
			disabled={pendingCrud}
		>
			{#if pendingCrud && editandoPapel === papel}
				<Spinner size="sm" />
			{:else}
				Adicionar
			{/if}
		</button>
		<button
			type="button"
			class="btn preset-outlined-primary-500 text-sm px-3 py-1.5 rounded-lg w-full sm:w-auto"
			onclick={cancelarEdicao}
			disabled={pendingCrud}
		>
			Fechar
		</button>
	</div>
{/snippet}

<!-- Par Editar/Remover (Admin Geral em modo edição) — repetia-se nos 4 slots.
     `compacto` cobre a variação do slot de supervisor (ícones 14px, padding maior). -->
{#snippet botoesEdicao(papel: Papel, temId: boolean, compacto: boolean = true)}
	{#if isAdminGeral && podeEditar && modoEdicaoGeral}
		<div class="flex items-center gap-1 shrink-0">
			<button
				type="button"
				class="btn btn-xs preset-filled-surface-500 rounded p-1"
				title="Editar"
				aria-label="Editar"
				onclick={() => iniciarEdicao(papel)}
			>
				<PenLine size={compacto ? 12 : 14} />
			</button>
			{#if temId}
				<button
					type="button"
					class="btn btn-xs preset-outlined-error-500 rounded p-1"
					title="Remover"
					aria-label="Remover"
					onclick={() => excluirMembro(papel)}
					disabled={pendingCrud}
				>
					{#if pendingCrud && removendoPapel === papel}
						<Spinner size="xs" />
					{:else}
						<Trash2 size={compacto ? 12 : 14} />
					{/if}
				</button>
			{/if}
		</div>
	{/if}
{/snippet}

<!-- Card NUIP OIP — os dois slots SEINT eram cópias idênticas (~115 linhas cada);
     `id` é o valor persistido (nome/marcador), o bind vai em idsPapel[papel]. -->
{#snippet slotSeint(papel: 'seint1' | 'seint2', id: number | null)}
	<div
		class="flex items-center justify-between gap-2 p-2.5 px-3 rounded-xl bg-white dark:bg-surface-900 border border-secondary-500/20 dark:border-secondary-500/35 shadow-sm hover:shadow transition-all duration-200"
	>
		<div class="flex items-center gap-2.5 min-w-0 flex-1">
			<div class="text-secondary-600/70 dark:text-secondary-400/70 shrink-0">
				<Users size={14} />
			</div>
			<div class="overflow-hidden min-w-0 flex-1">
				<!-- Rótulo + indicador de presença na MESMA linha: fica fora do espaço do
				     nome do escalado (que abaixo pode truncar). -->
				<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
					<span
						class="text-3xs uppercase font-bold text-secondary-500/80 dark:text-secondary-400/80"
						>NUIP OIP</span
					>
					{#if id}
						{@const pr = presencaDe(id)}
						<MarcadorPresenca
							entrada={pr.entrada}
							saida={pr.saida}
							faltaRelatorio={marcador('seint', id) === 'falta_relatorio'}
						/>
					{/if}
				</div>
				{#if editandoPapel === papel}
					<div class="flex flex-col sm:flex-row sm:items-center gap-2 mt-1 w-full">
						<div class="flex-1 min-w-0">
							<SearchableSelect
								id="{papel}Id"
								bind:value={idsPapel[papel]}
								loadOptions={buscarOips}
								selectedOption={selectedFromPoliciais(idsPapel[papel])}
								placeholder="Pesquisar NUIP OIP..."
								minSearchChars={2}
								showTrigger={false}
								class="w-full"
							/>
						</div>
						{@render botoesSalvarCancelar(papel)}
					</div>
				{:else}
					<div class="flex items-center gap-2">
						<p class="text-sm font-semibold text-surface-700 dark:text-surface-200 truncate">
							{id ? (policiais.find((p) => p.id === id)?.nome ?? 'Carregando...') : 'Não definido'}
						</p>
						{@render botoesEdicao(papel, !!id)}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/snippet}

<!-- Ícone de caneta usado nas ações dos cards de documento (repetia-se 6×) -->
{#snippet iconeCaneta()}
	<svg class="h-2.5 w-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
		><path
			stroke-linecap="round"
			stroke-linejoin="round"
			stroke-width="2"
			d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
		/></svg
	>
{/snippet}

<!-- Detalhes/ações dos dois cards de documento (escala GISE e relatório de
     extra), renderizados por SupervisaoDocumentoCard nas variantes mobile e
     desktop — o parâmetro `mobile` cobre as diferenças pontuais. -->
{#snippet detalhesEscala(mobile: boolean)}
	{#if documentoAssinadoInfo?.existe}
		<p class="text-xs font-bold text-surface-800 dark:text-surface-100 break-words">
			{documentoAssinadoInfo.assinante_nome}
		</p>
	{:else}
		<p class="text-2xs leading-snug text-surface-500 dark:text-surface-400">
			O supervisor poderá assinar a escala quando todas as seccionais enviarem a escala.
		</p>
		<p
			class="text-2xs leading-snug text-surface-500 dark:text-surface-400 {mobile ? '' : 'mt-0.5'}"
		>
			<span class="text-error-600 dark:text-error-400 font-medium">Faltando envio de:</span>
			{#if !gise.seccionais || gise.seccionais.length === 0}
				a escalar
			{:else if seccionaisPendentes.length === 0}
				Nenhum
			{:else}
				{seccionaisPendentes.map((s) => s.seccional_nome).join(', ')}
			{/if}
		</p>
	{/if}
{/snippet}

{#snippet acoesEscala(mobile: boolean)}
	{#if documentoAssinadoInfo?.existe}
		{@const podeManifesto = podeBaixarComManifesto(
			page.data.usuario,
			documentoAssinadoInfo.assinante_id
		)}
		<a
			href={urlDocumentoAssinado}
			target="_blank"
			class="btn btn-xs preset-filled-primary-500 px-2.5 py-1.5 text-3xs font-bold rounded-lg no-underline flex items-center gap-1 {mobile
				? ''
				: 'hover:scale-[1.02] transition-all'}"
			title={podeManifesto ? 'Baixar sem manifesto (para impressão)' : 'Baixar PDF assinado'}
		>
			<FileDown size={13} class="shrink-0" />
			{podeManifesto ? 'S/ manifesto' : 'Baixar PDF'}
		</a>
		{#if podeManifesto}
			<a
				href={urlDocumentoAssinadoManifesto}
				target="_blank"
				class="btn btn-xs preset-outlined-primary-500 px-2.5 py-1.5 text-3xs font-bold rounded-lg no-underline flex items-center gap-1 {mobile
					? ''
					: 'hover:scale-[1.02] transition-all'}"
				title="Baixar com manifesto (folha de auditoria)"
			>
				<FileDown size={13} class="shrink-0" />
				C/ manifesto
			</a>
		{/if}
	{:else}
		{#if isSupervisor || isAdminGeral}
			<a
				class="btn btn-xs text-3xs px-2.5 py-1.5 rounded-lg font-semibold no-underline flex items-center gap-1 {mobile
					? ''
					: 'hover:scale-[1.02] transition-all'} {assinaturaEscalaHabilitada
					? 'preset-tonal-primary border border-primary-500/30 hover:border-primary-500'
					: 'preset-tonal-surface opacity-50 pointer-events-none'}"
				href={urlDownloadPdf}
				target="_blank"
				title="Conferência (sem assinatura digital)"
			>
				{@render iconeCaneta()}
				Conferência
			</a>
		{/if}
		{#if isSupervisor}
			{#if mobile}
				<button
					type="button"
					class="btn btn-xs preset-filled-warning-500 border border-warning-600/30 px-2.5 py-1.5 text-3xs font-bold rounded-lg hover:border-warning-600 disabled:opacity-40 flex items-center gap-1"
					disabled={!mostrarPainelAssinaturaEscala}
					onclick={() => onAbrirAssinaturaEscalaManual()}
				>
					{@render iconeCaneta()}
					Tela
				</button>
			{:else}
				<button
					type="button"
					class="btn btn-xs preset-filled-tertiary-500 border border-tertiary-600/30 px-2.5 py-1.5 text-3xs font-bold rounded-lg hover:border-tertiary-600 disabled:opacity-40 flex items-center gap-1 hover:scale-[1.02] transition-all"
					disabled={!mostrarPainelAssinaturaEscala}
					onclick={() => painelTokenGise?.assinarComSerpro()}
				>
					{@render iconeCaneta()}
					Token
				</button>
			{/if}
		{/if}
	{/if}
{/snippet}

{#snippet detalhesExtra(mobile: boolean)}
	{#if assRelSup}
		<p class="text-xs font-bold text-surface-800 dark:text-surface-100 break-words">
			{assRelSup.assinante_nome}
		</p>
	{:else}
		<p class="text-2xs leading-snug text-surface-500 dark:text-surface-400">
			O supervisor poderá assinar o relatório de extra do quadro de supervisão quando todos os
			integrantes confirmarem sua saída.
		</p>
		{#if !rubSupOk}
			<p
				class="text-2xs leading-snug text-surface-500 dark:text-surface-400 {mobile
					? ''
					: 'mt-0.5'}"
			>
				{#if faltSup?.startsWith(FALTANTE_RUBRICA_SUPER_PREFIX)}
					<span class="text-error-600 dark:text-error-400 font-medium">Faltando rúbrica de:</span
					>{faltSup.slice(FALTANTE_RUBRICA_SUPER_PREFIX.length)}
				{:else}
					{faltSup ?? 'Aguardando rúbricas do quadro de supervisão.'}
				{/if}
			</p>
		{:else}
			<p
				class="text-2xs leading-snug text-surface-500 dark:text-surface-400 {mobile
					? ''
					: 'mt-0.5'}"
			>
				Disponível para conferência. Aguardando assinatura.
			</p>
		{/if}
	{/if}
{/snippet}

{#snippet acoesExtra(mobile: boolean)}
	{#if assRelSup}
		{@const podeManifesto = podeBaixarComManifesto(page.data.usuario, assRelSup.assinante_id)}
		<a
			href={urlDownloadExtra}
			target="_blank"
			class="btn btn-xs preset-filled-primary-500 px-2.5 py-1.5 text-3xs font-bold rounded-lg no-underline flex items-center gap-1 {mobile
				? ''
				: 'hover:scale-[1.02] transition-all'} {!downloadExtraSupHabilitado
				? 'pointer-events-none opacity-60'
				: ''}"
			title={podeManifesto ? 'Baixar sem manifesto (para impressão)' : 'Baixar PDF assinado'}
		>
			<FileDown size={13} class="shrink-0" />
			{podeManifesto ? 'S/ manifesto' : 'Baixar PDF'}
		</a>
		{#if podeManifesto}
			<a
				href={urlDownloadExtraManifesto}
				target="_blank"
				class="btn btn-xs preset-outlined-primary-500 px-2.5 py-1.5 text-3xs font-bold rounded-lg no-underline flex items-center gap-1 {mobile
					? ''
					: 'hover:scale-[1.02] transition-all'} {!downloadExtraSupHabilitado
					? 'pointer-events-none opacity-60'
					: ''}"
				title="Baixar com manifesto (folha de auditoria)"
			>
				<FileDown size={13} class="shrink-0" />
				C/ manifesto
			</a>
		{/if}
	{:else}
		<a
			class="btn btn-xs text-3xs px-2.5 py-1.5 rounded-lg font-semibold no-underline flex items-center gap-1 {mobile
				? ''
				: 'hover:scale-[1.02] transition-all'} {downloadExtraSupConferenciaHabilitado
				? 'preset-tonal-primary border border-primary-500/30 hover:border-primary-500'
				: 'preset-tonal-surface opacity-50 pointer-events-none'}"
			href={urlDownloadExtra}
			target="_blank"
		>
			{@render iconeCaneta()}
			Conferência
		</a>
		{#if isSupervisor && extraSupervisaoConfigurado}
			{#if mobile}
				<button
					type="button"
					class="btn btn-xs preset-filled-warning-500 border border-warning-600/30 px-2.5 py-1.5 text-3xs font-bold rounded-lg hover:border-warning-600 disabled:opacity-40 flex items-center gap-1"
					disabled={!assinaturaExtraHabilitada}
					onclick={() => onAssinarExtraSupervisaoManual?.()}
				>
					{@render iconeCaneta()}
					Tela
				</button>
			{:else}
				<button
					type="button"
					class="btn btn-xs preset-filled-tertiary-500 border border-tertiary-600/30 px-2.5 py-1.5 text-3xs font-bold rounded-lg hover:border-tertiary-600 disabled:opacity-40 flex items-center gap-1 hover:scale-[1.02] transition-all"
					disabled={!assinaturaExtraHabilitada}
					onclick={() => onAssinarExtraSupervisaoDigital?.()}
				>
					{@render iconeCaneta()}
					Token
				</button>
			{/if}
		{/if}
	{/if}
{/snippet}

<!-- Sem "card" externo: o quadro é uma SEÇÃO da página (título + blocos), não um
     cartão dentro de cartão. Antes havia um container com borda/sombra/barra de
     gradiente envolvendo tudo, o que empilhava molduras (card > card > card). -->
<section class="space-y-3 sm:space-y-5">
	<div class="flex flex-wrap items-baseline justify-between gap-2 sm:gap-4">
		<h2 class="text-xl font-bold text-surface-900 dark:text-surface-50 tracking-tight">
			Supervisão e apoio
		</h2>

		<div class="flex w-full sm:w-auto flex-wrap items-center justify-end gap-2 sm:gap-3">
			{#if !editando && !documentoAssinadoInfo?.existe && mostrarBlocoExtraSupervisao && !(mostrarPainelAssinaturaEscala || mostrarPainelAssinaturaEscalaReadonly)}
				<span
					class="inline-flex items-center gap-1.5 rounded-full bg-warning-500 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-warning-500/20"
				>
					<Clock size={12} class="shrink-0" />
					Ass. Escala Pend.
				</span>
			{/if}
		</div>
	</div>
	<form
		bind:this={formEl}
		method="POST"
		action="?/salvarSupervisores"
		use:enhance={onSubmit}
		class="contents"
	>
		<div
			class="p-3 sm:p-4 md:p-5 rounded-2xl bg-white dark:bg-surface-950 border border-surface-200 dark:border-surface-800 shadow-sm"
		>
			<div class="space-y-2.5 sm:space-y-4">
				<div class="flex items-start gap-2.5 sm:gap-4">
					<div
						class="mt-1 flex-shrink-0 w-10 h-10 rounded-full bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 flex items-center justify-center text-primary-600 dark:text-primary-400 shadow-sm"
					>
						<UserRound size={20} />
					</div>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-0.5">
							<span
								class="text-3xs uppercase tracking-wider font-bold text-surface-500 dark:text-surface-400"
								>DPC Supervisão</span
							>
							{#if gise.supervisor_id}
								{@const pr = presencaDe(gise.supervisor_id)}
								<MarcadorPresenca entrada={pr.entrada} saida={pr.saida} />
							{/if}
						</div>
						{#if editandoPapel === 'supervisor'}
							<div class="flex flex-col sm:flex-row sm:items-center gap-2 mt-1 w-full">
								<div class="flex-1 min-w-0 sm:max-w-md">
									<SearchableSelect
										id="supId"
										bind:value={supervisorId}
										loadOptions={buscarDpcs}
										selectedOption={selectedFromPoliciais(supervisorId)}
										placeholder="Pesquisar DPC..."
										minSearchChars={2}
										showTrigger={false}
										class="w-full"
									/>
								</div>
								{@render botoesSalvarCancelar('supervisor')}
							</div>
						{:else}
							<div class="flex min-w-0 items-center gap-3">
								<p
									class="min-w-0 shrink font-bold text-lg leading-tight text-surface-900 dark:text-white truncate"
								>
									{gise.supervisor_nome ?? 'Não definido'}
								</p>

								{@render botoesEdicao('supervisor', !!gise.supervisor_id, false)}
							</div>
						{/if}
					</div>
				</div>

				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3 pt-1.5 sm:pt-2">
					<!-- Assessor -->
					<div
						class="flex flex-col gap-2 p-2.5 px-3 rounded-xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 shadow-sm hover:shadow transition-all duration-200 {editandoPapel ===
						'assessor'
							? 'col-span-full'
							: ''}"
					>
						{#if editandoPapel === 'assessor'}
							<div class="flex flex-col gap-1.5 w-full">
								<div class="flex items-center gap-2">
									<div class="text-surface-400 dark:text-surface-500 shrink-0">
										<Users size={14} />
									</div>
									<span
										class="block text-3xs uppercase font-bold text-surface-400 dark:text-surface-500"
									>
										Assessor
									</span>
								</div>
								<div class="flex flex-wrap lg:flex-nowrap items-end gap-3 w-full">
									<div class="flex-1 min-w-[200px]">
										<span
											class="block text-3xs font-semibold text-surface-500 dark:text-surface-400 mb-1"
										>
											Nome do Assessor
										</span>
										<SearchableSelect
											id="assessorId"
											bind:value={assessorId}
											loadOptions={buscarOips}
											selectedOption={selectedFromPoliciais(assessorId)}
											placeholder="Pesquisar Assessor..."
											minSearchChars={2}
											showTrigger={false}
											class="w-full"
										/>
									</div>

									{#if assessorId != null}
										<div class="flex-1 min-w-[200px]">
											<label
												for="assessorEmailNotif"
												class="block text-3xs font-semibold text-surface-500 dark:text-surface-400 mb-1"
											>
												E-mail (avisos GISE)
											</label>
											<input
												id="assessorEmailNotif"
												type="email"
												name="assessor_email_notificacao"
												autocomplete="email"
												bind:value={assessorEmailNotificacao}
												class="w-full px-3 py-1.5 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-sm focus:border-primary-400 focus:ring-1 focus:ring-primary-400/30 focus:outline-none transition-colors text-surface-900 dark:text-surface-50 placeholder:text-surface-400 dark:placeholder:text-surface-500 h-[38px]"
												placeholder="nome@provedor.com"
											/>
										</div>

										<div class="flex items-center h-[38px] shrink-0">
											<label class="flex items-center gap-1.5 cursor-pointer">
												<input
													type="checkbox"
													name="confirmar_email_assessor"
													value="1"
													class="rounded border-surface-400 w-3.5 h-3.5"
													required
												/>
												<span
													class="text-2xs text-surface-500 dark:text-surface-400 leading-none select-none"
												>
													Confirmo e-mail.
												</span>
											</label>
										</div>
									{/if}

									{@render botoesSalvarCancelar('assessor', 'h-[38px]')}
								</div>
							</div>
						{:else}
							<div class="flex items-center justify-between gap-2">
								<div class="flex items-center gap-2.5 min-w-0 flex-1">
									<div class="text-surface-400 dark:text-surface-500 shrink-0">
										<Users size={14} />
									</div>
									<div class="overflow-hidden min-w-0 flex-1">
										<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
											<span
												class="text-3xs uppercase font-bold text-surface-400 dark:text-surface-500"
												>Assessor</span
											>
											{#if gise.assessor_id}
												{@const pr = presencaDe(gise.assessor_id)}
												<MarcadorPresenca entrada={pr.entrada} saida={pr.saida} />
											{/if}
										</div>
										<div class="flex items-center gap-2">
											<p
												class="text-sm font-semibold text-surface-700 dark:text-surface-200 truncate"
											>
												{gise.assessor_id
													? (policiais.find((p) => p.id === gise.assessor_id)?.nome ??
														'Carregando...')
													: 'Não definido'}
											</p>
											{@render botoesEdicao('assessor', !!gise.assessor_id)}
										</div>
										{#if gise.assessor_email_notificacao}
											<p
												class="text-3xs text-surface-500 dark:text-surface-400 truncate mt-0.5"
												title="E-mail para avisos de seccionais"
											>
												Avisos: {gise.assessor_email_notificacao}
											</p>
										{/if}
									</div>
								</div>
							</div>
						{/if}
					</div>

					<!-- NUIP OIP 1 e 2 — mesmo card, parametrizado pelo papel -->
					{@render slotSeint('seint1', gise.seint1_id)}
					{@render slotSeint('seint2', gise.seint2_id)}
				</div>
			</div>
		</div>

		<input type="hidden" name="supervisor_id" value={supervisorId ?? ''} />
		<input type="hidden" name="assessor_id" value={assessorId ?? ''} />
		<input type="hidden" name="seint1_id" value={seint1Id ?? ''} />
		<input type="hidden" name="seint2_id" value={seint2Id ?? ''} />
		{#if editandoPapel !== 'assessor'}
			<input
				type="hidden"
				name="assessor_email_notificacao"
				value={assessorEmailNotificacao ?? ''}
			/>
			{#if assessorId != null}
				<input type="hidden" name="confirmar_email_assessor" value="1" />
			{/if}
		{/if}
	</form>
	{#if documentoAssinadoInfo?.existe || mostrarPainelAssinaturaEscala || mostrarPainelAssinaturaEscalaReadonly || mostrarBlocoExtraSupervisao || loteSection || isSupervisor}
		{@const mostrarColEscala =
			!!documentoAssinadoInfo?.existe ||
			mostrarPainelAssinaturaEscala ||
			mostrarPainelAssinaturaEscalaReadonly ||
			isSupervisor}
		<div class="border-t border-surface-200/60 dark:border-surface-700/60 pt-3 mt-4 sm:mt-5">
			<div class="flex flex-col gap-4">
				{#if mostrarColEscala}
					<div class="flex flex-col gap-1.5 w-full animate-fade">
						<SupervisaoDocumentoCard
							{isMobile}
							tituloExternoMobile={documentoAssinadoInfo?.existe
								? 'Escala GISE'
								: 'Assinatura da escala GISE'}
							tituloMobile={documentoAssinadoInfo?.existe
								? 'Escala assinada digitalmente'
								: 'Assinatura da escala GISE'}
							tituloDesktop={documentoAssinadoInfo?.existe
								? 'Escala GISE'
								: 'Assinatura da escala GISE'}
							badgeEstado={documentoAssinadoInfo?.existe
								? 'sucesso'
								: gise.status === 'aguardando_assinatura'
									? 'alerta'
									: 'neutro'}
							badgeLabel={documentoAssinadoInfo?.existe
								? 'Assinada'
								: gise.status === 'aguardando_assinatura'
									? 'ass. Pendente'
									: 'em preenchimento'}
							bind:expandido={expandirEscala}
							detalhes={detalhesEscala}
							acoes={acoesEscala}
						/>

						{#if mostrarPainelAssinaturaEscala}
							<div class="sr-only" aria-hidden="true">
								<PainelAssinaturaToken
									bind:control={painelTokenGise}
									bind:signerName={serproSignerName}
									bind:signerCpf={serproSignerCpf}
									signerEmail={assinaturaEscalaSignerEmail ?? ''}
									prepararUrl="/api/gise/{gise.id}/preparar-assinatura"
									finalizarUrl="/api/gise/{gise.id}/finalizar-assinatura"
									nomeArquivo="gise_{gise.data_inicio}_assinada.pdf"
									extraPayload={{ rubrica: rubricaCapturada }}
									disabled={false}
									onSuccess={onAssinaturaEscalaDigitalSuccess}
								/>
							</div>
						{/if}
					</div>
				{/if}

				{#if mostrarBlocoExtraSupervisao}
					<div class="flex flex-col gap-1.5 w-full animate-fade">
						{#if !extraSupervisaoConfigurado}
							{#if isMobile}
								<p
									class="text-3xs font-bold uppercase tracking-wider text-surface-400 dark:text-surface-500"
								>
									Relatório de extra (Supervisão e apoio)
								</p>
							{/if}
							<div
								class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300 p-3.5"
							>
								<p
									class="text-xs text-warning-700 dark:text-warning-400 bg-warning-500/10 border border-warning-500/20 rounded-lg px-3 py-2"
								>
									O relatório de extra do quadro ainda não está disponível. Peça ao administrador
									para executar as migrações.
								</p>
							</div>
						{:else}
							<SupervisaoDocumentoCard
								{isMobile}
								tituloExternoMobile="Relatório de extra (Supervisão e apoio)"
								tituloMobile="Relatório de extra — supervisão e apoio"
								tituloDesktop={assRelSup ? 'Relatório de extra' : 'Relatório de extra (supervisão)'}
								badgeEstado={assRelSup ? 'sucesso' : rubSupOk ? 'alerta' : 'neutro'}
								badgeLabel={assRelSup
									? 'Assinado'
									: rubSupOk
										? 'pronto para assinar'
										: 'Aguardando rubricas'}
								bind:expandido={expandirExtra}
								detalhes={detalhesExtra}
								acoes={acoesExtra}
							/>
						{/if}
					</div>
				{/if}

				{@render loteSection?.()}
			</div>
		</div>
	{/if}
</section>
