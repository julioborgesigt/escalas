/**
 * Hook que concentra os 11 fluxos de mutação CRUD do card de seccional GISE
 * (`GiseSeccional.svelte`):
 *   - Finalizar seccional, selecionar/remover/adicionar unidade-slot
 *   - Adicionar/remover equipe, salvar vagas e horários da equipe
 *   - Adicionar/remover membro da equipe
 *   - Remover seccional (com modal de confirmação)
 *   - Factory `buscarPorCargo` para o SearchableSelect de policiais
 *
 * O componente fica com a UI/estado de edição inline; o composable fica com
 * `pendingCrud`, os handlers `use:enhance` e o fluxo do modal de remoção.
 * Callbacks `onXxxSuccess` permitem ao componente fechar dialogs/limpar selects
 * sem que o composable saiba quais variáveis de UI existem.
 */

import { invalidateShared } from '$lib/cross-tab-invalidate';
import { postFormAction } from '$lib/post-form-action';
import { toaster } from '$lib/toast';
import { makeEnhanceHandler } from '$lib/enhance-handler';
import { validarHora } from '$lib/gise/horarios';
import { buscarPoliciaisOptions } from '$lib/busca-policiais';

interface UseGiseSeccionalActionsParams {
	/** Callbacks de reset chamados pelo composable após cada sucesso de CRUD. */
	onFinalizarSeccionalSuccess?: () => void;
	onSelecionarUnidadeSuccess?: () => void;
	onAdicionarEquipeSuccess?: () => void;
	onSalvarSlotsEquipeSuccess?: () => void;
	onSalvarHorariosEquipeSuccess?: () => void;
	onAdicionarMembroSuccess?: () => void;
	onAdicionarUnidadeSuccess?: () => void;
	onSalvarHorariosSecSuccess?: () => void;
	/**
	 * Lê os horários atuais do formulário inline de edição de equipe — usado
	 * no `beforeSubmit` de `handleSalvarHorariosEquipe` para validar antes de
	 * deixar o POST sair.
	 */
	getHorariosEquipeFormulario: () => { entrada: string; saida: string };
	/**
	 * Lê os horários atuais do formulário inline de edição de seccional — usado
	 * no `beforeSubmit` de `handleSalvarHorariosSec` para validar antes de
	 * deixar o POST sair.
	 */
	getHorariosSecFormulario: () => { entrada: string; saida: string };
}

export function useGiseSeccionalActions(params: UseGiseSeccionalActionsParams) {
	const {
		onFinalizarSeccionalSuccess,
		onSelecionarUnidadeSuccess,
		onAdicionarEquipeSuccess,
		onSalvarSlotsEquipeSuccess,
		onSalvarHorariosEquipeSuccess,
		onAdicionarMembroSuccess,
		onAdicionarUnidadeSuccess,
		onSalvarHorariosSecSuccess,
		getHorariosEquipeFormulario,
		getHorariosSecFormulario
	} = params;

	let pendingFinalizarSeccional = $state(false);
	let pendingSelecionarUnidade = $state(false);
	let pendingRemoverUnidade = $state(false);
	let pendingAdicionarEquipe = $state(false);
	let pendingRemoverEquipe = $state(false);
	let pendingSalvarSlotsEquipe = $state(false);
	let pendingSalvarHorariosEquipe = $state(false);
	let pendingSalvarHorariosSec = $state(false);
	let pendingAdicionarMembro = $state(false);
	let pendingRemoverMembro = $state(false);
	let pendingAdicionarUnidade = $state(false);
	let pendingRemoverSeccional = $state(false);

	let dialogRemoverSeccionalAberto = $state(false);
	let formRemoverSeccionalPendente: HTMLFormElement | null = null;

	const pendingCrud = $derived(
		pendingFinalizarSeccional ||
			pendingSelecionarUnidade ||
			pendingRemoverUnidade ||
			pendingAdicionarEquipe ||
			pendingRemoverEquipe ||
			pendingSalvarSlotsEquipe ||
			pendingSalvarHorariosEquipe ||
			pendingSalvarHorariosSec ||
			pendingAdicionarMembro ||
			pendingRemoverMembro ||
			pendingAdicionarUnidade ||
			pendingRemoverSeccional
	);

	const handleFinalizarSeccional = makeEnhanceHandler<{ gise_status?: string }>({
		setPending: (p) => (pendingFinalizarSeccional = p),
		successTitle: (d) =>
			d?.gise_status === 'aguardando_assinatura'
				? 'Todas as seccionais finalizadas!'
				: 'Seccional finalizada',
		successDescription: (d) =>
			d?.gise_status === 'aguardando_assinatura'
				? 'Escala aguardando assinatura do Supervisor.'
				: 'Aguardando demais seccionais.',
		errorTitle: 'Erro ao finalizar',
		onSuccess: () => onFinalizarSeccionalSuccess?.()
	});

	const handleSelecionarUnidade = makeEnhanceHandler({
		setPending: (p) => (pendingSelecionarUnidade = p),
		successTitle: 'Unidade selecionada',
		errorTitle: 'Erro ao selecionar',
		onSuccess: () => onSelecionarUnidadeSuccess?.()
	});

	const handleRemoverUnidade = makeEnhanceHandler({
		setPending: (p) => (pendingRemoverUnidade = p),
		errorTitle: 'Erro ao remover DP'
	});

	const handleAdicionarEquipe = makeEnhanceHandler({
		setPending: (p) => (pendingAdicionarEquipe = p),
		successTitle: 'Equipe adicionada',
		errorTitle: 'Erro ao adicionar',
		onSuccess: () => onAdicionarEquipeSuccess?.()
	});

	const handleRemoverEquipe = makeEnhanceHandler({
		setPending: (p) => (pendingRemoverEquipe = p),
		successTitle: 'Equipe removida',
		errorTitle: 'Erro ao remover'
	});

	const handleSalvarSlotsEquipe = makeEnhanceHandler({
		setPending: (p) => (pendingSalvarSlotsEquipe = p),
		successTitle: 'Vagas atualizadas',
		errorTitle: 'Erro ao atualizar',
		onSuccess: () => onSalvarSlotsEquipeSuccess?.()
	});

	const handleSalvarHorariosEquipe = makeEnhanceHandler({
		setPending: (p) => (pendingSalvarHorariosEquipe = p),
		beforeSubmit: () => {
			const { entrada, saida } = getHorariosEquipeFormulario();
			const horas = [entrada, saida].filter(Boolean);
			if (horas.some((h) => !validarHora(h))) {
				toaster.error({
					title: 'Formato inválido',
					description: 'Use o formato HH:MM, ex: 14:00'
				});
				return false;
			}
			return true;
		},
		successTitle: 'Horários da equipe atualizados',
		errorTitle: 'Erro ao salvar',
		onSuccess: () => onSalvarHorariosEquipeSuccess?.()
	});

	const handleSalvarHorariosSec = makeEnhanceHandler({
		setPending: (p) => (pendingSalvarHorariosSec = p),
		beforeSubmit: () => {
			const { entrada, saida } = getHorariosSecFormulario();
			const horas = [entrada, saida].filter(Boolean);
			if (horas.some((h) => !validarHora(h))) {
				toaster.error({
					title: 'Formato inválido',
					description: 'Use o formato HH:MM, ex: 14:00'
				});
				return false;
			}
			return true;
		},
		successTitle: 'Horários da seccional atualizados',
		errorTitle: 'Erro ao salvar',
		onSuccess: () => onSalvarHorariosSecSuccess?.()
	});

	const handleAdicionarMembro = makeEnhanceHandler({
		setPending: (p) => (pendingAdicionarMembro = p),
		successTitle: 'Membro adicionado',
		errorTitle: 'Erro ao adicionar membro',
		onSuccess: () => onAdicionarMembroSuccess?.()
	});

	const handleRemoverMembro = makeEnhanceHandler({
		setPending: (p) => (pendingRemoverMembro = p),
		successTitle: 'Membro removido',
		errorTitle: 'Erro ao remover membro'
	});

	const handleAdicionarUnidade = makeEnhanceHandler({
		setPending: (p) => (pendingAdicionarUnidade = p),
		successTitle: 'Unidade adicionada',
		errorTitle: 'Erro ao adicionar unidade',
		onSuccess: () => onAdicionarUnidadeSuccess?.()
	});

	/**
	 * Intercepta o submit nativo do form `?/removerSeccional` para mostrar um
	 * dialog de confirmação. `confirmarRemoverSeccional` re-envia via fetch
	 * para evitar duplicação do form em outro lugar do DOM.
	 */
	function handleRemoverSeccionalForm({
		cancel,
		formElement
	}: {
		cancel(): void;
		formElement: HTMLFormElement;
	}) {
		cancel();
		formRemoverSeccionalPendente = formElement;
		dialogRemoverSeccionalAberto = true;
	}

	async function confirmarRemoverSeccional() {
		if (!formRemoverSeccionalPendente) return;
		pendingRemoverSeccional = true;
		const formData = new FormData(formRemoverSeccionalPendente);
		try {
			const result = await postFormAction(formRemoverSeccionalPendente.action, formData);
			if (result.type === 'success') {
				dialogRemoverSeccionalAberto = false;
				await invalidateShared('gise:detail', 'app:gise-list');
				toaster.success({ title: 'Seccional removida' });
			} else {
				const data =
					result.type === 'failure' ? (result.data as { error?: string } | undefined) : undefined;
				toaster.error({ title: String(data?.error || 'Erro ao remover') });
			}
		} catch {
			toaster.error({ title: 'Erro ao remover seccional' });
		} finally {
			pendingRemoverSeccional = false;
			formRemoverSeccionalPendente = null;
		}
	}

	/** Factory de `loadOptions` para `<SearchableSelect>`, filtrado por cargo (DPC/OIP). */
	function buscarPorCargo(cargo: 'DPC' | 'OIP') {
		return buscarPoliciaisOptions({ cargo, rotulo: 'matricula', valorNumerico: true });
	}

	return {
		get pendingCrud() {
			return pendingCrud;
		},
		get pendingFinalizarSeccional() {
			return pendingFinalizarSeccional;
		},
		get pendingSelecionarUnidade() {
			return pendingSelecionarUnidade;
		},
		get pendingRemoverUnidade() {
			return pendingRemoverUnidade;
		},
		get pendingAdicionarEquipe() {
			return pendingAdicionarEquipe;
		},
		get pendingRemoverEquipe() {
			return pendingRemoverEquipe;
		},
		get pendingSalvarSlotsEquipe() {
			return pendingSalvarSlotsEquipe;
		},
		get pendingSalvarHorariosEquipe() {
			return pendingSalvarHorariosEquipe;
		},
		get pendingSalvarHorariosSec() {
			return pendingSalvarHorariosSec;
		},
		get pendingAdicionarMembro() {
			return pendingAdicionarMembro;
		},
		get pendingRemoverMembro() {
			return pendingRemoverMembro;
		},
		get pendingAdicionarUnidade() {
			return pendingAdicionarUnidade;
		},
		get pendingRemoverSeccional() {
			return pendingRemoverSeccional;
		},
		get dialogRemoverSeccionalAberto() {
			return dialogRemoverSeccionalAberto;
		},
		set dialogRemoverSeccionalAberto(v: boolean) {
			dialogRemoverSeccionalAberto = v;
		},
		handleFinalizarSeccional,
		handleSelecionarUnidade,
		handleRemoverUnidade,
		handleAdicionarEquipe,
		handleRemoverEquipe,
		handleSalvarSlotsEquipe,
		handleSalvarHorariosEquipe,
		handleSalvarHorariosSec,
		handleAdicionarMembro,
		handleRemoverMembro,
		handleAdicionarUnidade,
		handleRemoverSeccionalForm,
		confirmarRemoverSeccional,
		buscarPorCargo
	};
}

/** Tipo do objeto devolvido — para props de componentes filhos (slot/equipe). */
export type GiseSeccionalActions = ReturnType<typeof useGiseSeccionalActions>;
