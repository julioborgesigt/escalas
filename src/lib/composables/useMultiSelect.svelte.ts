/**
 * Hook para gerenciar seleção múltipla de itens (gráficos, cards, etc).
 *
 * @example
 * const { selected, toggle, selectAll, deselectAll, isSelected, count } = useMultiSelect();
 *
 * toggle('rank-prisoes');
 * selectAll(allIds);
 */
export function useMultiSelect<T = string | number>() {
	let selected = $state<T[]>([]);

	return {
		get selected() {
			return selected;
		},
		set selected(value: T[]) {
			selected = value;
		},
		toggle(id: T) {
			if (selected.includes(id)) {
				selected = selected.filter((i) => i !== id);
			} else {
				selected = [...selected, id];
			}
		},
		selectAll(ids: T[]) {
			if (selected.length >= ids.length) {
				selected = [];
			} else {
				selected = [...ids];
			}
		},
		deselectAll() {
			selected = [];
		},
		isSelected(id: T) {
			return selected.includes(id);
		},
		get count() {
			return selected.length;
		}
	};
}
