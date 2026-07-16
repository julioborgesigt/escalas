/**
 * Factory de `loadOptions` do `<SearchableSelect>` para `/api/policiais/search`.
 *
 * O mesmo fetch+map existia copiado em 5 lugares (formulários de escala,
 * ListaFds, tela e composable da GISE), variando apenas o formato do rótulo
 * e o tipo do `value` — aqui os dois viram parâmetros:
 *  - `rotulo`: `'lotacao'` → `Nome — Lotação` (escalas); `'matricula'` →
 *    `Nome (MATRÍCULA)` (GISE).
 *  - `valorNumerico`: os selects da GISE fazem bind em `number`; os das
 *    escalas serializam em form field e usam `string`.
 *
 * `cargo` aceita função para casos em que o cargo é estado do componente
 * (select de cargo ao lado da busca); string vazia devolve lista vazia sem
 * bater na API.
 */

import { apiFetch } from '$lib/api-fetch';

export interface OpcaoPolicial<V extends string | number = string | number> {
	value: V;
	label: string;
}

// Overloads: o tipo de `value` acompanha `valorNumerico`, casando com o
// `bind:value` de cada caller (number na GISE, string nos forms de escala).
export function buscarPoliciaisOptions(opts: {
	cargo: string | (() => string);
	rotulo?: 'lotacao' | 'matricula';
	valorNumerico: true;
}): (query: string, signal: AbortSignal) => Promise<OpcaoPolicial<number>[]>;
export function buscarPoliciaisOptions(opts: {
	cargo: string | (() => string);
	rotulo?: 'lotacao' | 'matricula';
	valorNumerico?: false;
}): (query: string, signal: AbortSignal) => Promise<OpcaoPolicial<string>[]>;
export function buscarPoliciaisOptions(opts: {
	cargo: string | (() => string);
	rotulo?: 'lotacao' | 'matricula';
	valorNumerico?: boolean;
}): (query: string, signal: AbortSignal) => Promise<OpcaoPolicial[]> {
	const { rotulo = 'lotacao', valorNumerico = false } = opts;
	return async (query, signal) => {
		const cargo = typeof opts.cargo === 'function' ? opts.cargo() : opts.cargo;
		if (!cargo) return [];
		const params = new URLSearchParams({ cargo, limit: '50' });
		if (query) params.set('q', query);
		const json = await apiFetch<{
			policiais: { id: number; nome: string; matricula: string; lotacao: string }[];
		}>(`/api/policiais/search?${params}`, { signal });
		return json.policiais.map((p) => ({
			value: valorNumerico ? p.id : String(p.id),
			label:
				rotulo === 'matricula'
					? `${p.nome} (${p.matricula})`
					: `${p.nome}${p.lotacao ? ' — ' + p.lotacao : ''}`
		}));
	};
}
