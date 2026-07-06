import { toaster } from '$lib/toast';
import type { ActionResult } from '@sveltejs/kit';
import type { EscalaPolicialComDados } from '$lib/types';
import type { criarHelpersHorario } from './escala-horarios';

/**
 * Estado + handlers da edição inline de um servidor da escala (linha vira
 * formulário da action `?/editar`). Compartilhado por `ListaFds` e
 * `TabelaServidores`, que antes duplicavam os 9 estados, o `startEdit` e o
 * pós-processamento do submit.
 */
export function useEdicaoInlineServidor(deps: {
	helpers: Pick<
		ReturnType<typeof criarHelpersHorario>,
		'getDataSaida' | 'getHoraEntrada' | 'getHoraSaida'
	>;
	aplicarPoliciais: (policiais: EscalaPolicialComDados[]) => void;
}) {
	let editingId = $state<number | null>(null);
	let dataEntrada = $state('');
	let dataSaida = $state('');
	let horaEntrada = $state('');
	let minutoEntrada = $state('');
	let horaSaida = $state('');
	let minutoSaida = $state('');
	let observacoes = $state('');
	let pending = $state(false);

	function startEdit(p: EscalaPolicialComDados) {
		editingId = p.id;
		dataEntrada = p.data_plantao;
		dataSaida = deps.helpers.getDataSaida(p);
		const [he, me = '00'] = deps.helpers.getHoraEntrada(p).split(':');
		horaEntrada = he;
		minutoEntrada = me;
		const [hs, ms = '00'] = deps.helpers.getHoraSaida(p).split(':');
		horaSaida = hs;
		minutoSaida = ms;
		observacoes = p.observacoes || '';
	}

	function handleEditar() {
		pending = true;
		return async ({ result }: { result: ActionResult }) => {
			pending = false;
			if (result.type === 'success') {
				deps.aplicarPoliciais(result.data?.policiais);
				editingId = null;
				toaster.create({ title: 'Dados salvos', type: 'success' });
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao salvar'), type: 'error' });
			}
		};
	}

	return {
		get editingId() {
			return editingId;
		},
		set editingId(v) {
			editingId = v;
		},
		get dataEntrada() {
			return dataEntrada;
		},
		set dataEntrada(v) {
			dataEntrada = v;
		},
		get dataSaida() {
			return dataSaida;
		},
		set dataSaida(v) {
			dataSaida = v;
		},
		get horaEntrada() {
			return horaEntrada;
		},
		set horaEntrada(v) {
			horaEntrada = v;
		},
		get minutoEntrada() {
			return minutoEntrada;
		},
		set minutoEntrada(v) {
			minutoEntrada = v;
		},
		get horaSaida() {
			return horaSaida;
		},
		set horaSaida(v) {
			horaSaida = v;
		},
		get minutoSaida() {
			return minutoSaida;
		},
		set minutoSaida(v) {
			minutoSaida = v;
		},
		get observacoes() {
			return observacoes;
		},
		set observacoes(v) {
			observacoes = v;
		},
		get pending() {
			return pending;
		},
		startEdit,
		handleEditar
	};
}
