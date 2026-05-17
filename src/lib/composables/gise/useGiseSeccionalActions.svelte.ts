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

import { invalidate } from '$app/navigation';
import { toaster } from '$lib/toast';
import { csrfHeaders } from '$lib/csrf';
import { makeEnhanceHandler } from '$lib/enhance-handler';
import { validarHora } from '$lib/gise/gise-horarios';

export interface UseGiseSeccionalActionsParams {
	/** Callbacks de reset chamados pelo composable após cada sucesso de CRUD. */
	onFinalizarSeccionalSuccess?: () => void;
	onSelecionarUnidadeSuccess?: () => void;
	onAdicionarEquipeSuccess?: () => void;
	onSalvarSlotsEquipeSuccess?: () => void;
	onSalvarHorariosEquipeSuccess?: () => void;
	onAdicionarMembroSuccess?: () => void;
	onAdicionarUnidadeSuccess?: () => void;
	/**
	 * Lê os horários atuais do formulário inline de edição de equipe — usado
	 * no `beforeSubmit` de `handleSalvarHorariosEquipe` para validar antes de
	 * deixar o POST sair.
	 */
	getHorariosEquipeFormulario: () => { entrada: string; saida: string };
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
		getHorariosEquipeFormulario
	} = params;

	let pendingCrud = $state(false);
	let dialogRemoverSeccionalAberto = $state(false);
	let formRemoverSeccionalPendente: HTMLFormElement | null = null;

	const setPending = (p: boolean) => (pendingCrud = p);

	const handleFinalizarSeccional = makeEnhanceHandler<{ gise_status?: string }>({
		setPending,
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
		setPending,
		successTitle: 'Unidade selecionada',
		errorTitle: 'Erro ao selecionar',
		onSuccess: () => onSelecionarUnidadeSuccess?.()
	});

	const handleRemoverUnidade = makeEnhanceHandler({
		setPending,
		errorTitle: 'Erro ao remover DP'
	});

	const handleAdicionarEquipe = makeEnhanceHandler({
		setPending,
		successTitle: 'Equipe adicionada',
		errorTitle: 'Erro ao adicionar',
		onSuccess: () => onAdicionarEquipeSuccess?.()
	});

	const handleRemoverEquipe = makeEnhanceHandler({
		setPending,
		successTitle: 'Equipe removida',
		errorTitle: 'Erro ao remover'
	});

	const handleSalvarSlotsEquipe = makeEnhanceHandler({
		setPending,
		successTitle: 'Vagas atualizadas',
		errorTitle: 'Erro ao atualizar',
		onSuccess: () => onSalvarSlotsEquipeSuccess?.()
	});

	const handleSalvarHorariosEquipe = makeEnhanceHandler({
		setPending,
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

	const handleAdicionarMembro = makeEnhanceHandler({
		setPending,
		successTitle: 'Membro adicionado',
		errorTitle: 'Erro ao adicionar membro',
		onSuccess: () => onAdicionarMembroSuccess?.()
	});

	const handleRemoverMembro = makeEnhanceHandler({
		setPending,
		successTitle: 'Membro removido',
		errorTitle: 'Erro ao remover membro'
	});

	const handleAdicionarUnidade = makeEnhanceHandler({
		setPending,
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
		pendingCrud = true;
		const formData = new FormData(formRemoverSeccionalPendente);
		try {
			const res = await fetch(formRemoverSeccionalPendente.action, {
				method: 'POST',
				body: formData,
				headers: csrfHeaders()
			});
			if (res.ok) {
				dialogRemoverSeccionalAberto = false;
				await invalidate('gise:detail');
				toaster.success({ title: 'Seccional removida' });
			} else {
				const data = (await res.json().catch(() => ({}))) as { error?: string };
				toaster.error({ title: String(data?.error || 'Erro ao remover') });
			}
		} catch {
			toaster.error({ title: 'Erro ao remover seccional' });
		} finally {
			pendingCrud = false;
			formRemoverSeccionalPendente = null;
		}
	}

	/**
	 * Factory de `loadOptions` para `<SearchableSelect>`. Filtra por cargo
	 * (DPC/OIP) e somente admins para a busca de membro adicional.
	 */
	function buscarPorCargo(cargo: 'DPC' | 'OIP') {
		return async (query: string, signal: AbortSignal) => {
			const params = new URLSearchParams({ cargo, limit: '50' });
			if (query) params.set('q', query);
			const res = await fetch(`/api/policiais/search?${params}`, { signal });
			if (!res.ok) {
				const err = await res.json().catch(() => ({ error: 'Erro na busca' }));
				throw new Error(err.error ?? 'Erro na busca');
			}
			const data = (await res.json()) as {
				policiais: { id: number; nome: string; matricula: string }[];
			};
			return data.policiais.map((p) => ({
				value: p.id,
				label: `${p.nome} (${p.matricula})`
			}));
		};
	}

	return {
		get pendingCrud() {
			return pendingCrud;
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
		handleAdicionarMembro,
		handleRemoverMembro,
		handleAdicionarUnidade,
		handleRemoverSeccionalForm,
		confirmarRemoverSeccional,
		buscarPorCargo
	};
}
