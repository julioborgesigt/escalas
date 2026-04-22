<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { BreveRelatorioEnv } from '$lib/gise/breve-relatorio';
	import {
		DEFAULT_BREVE_RELATORIO_TITULO,
		DEFAULT_BREVE_RELATORIO_TEXTO_SECCIONAL,
		DEFAULT_BREVE_RELATORIO_TEXTO_SUPERVISAO,
		resolveBreveRelatorioTitulo,
		resolveBreveRelatorioConteudoSeccional,
		resolveBreveRelatorioConteudoSupervisao
	} from '$lib/gise/breve-relatorio';

	interface GiseBreve {
		breve_relatorio_titulo: string | null;
		breve_relatorio_texto_seccional: string | null;
		breve_relatorio_texto_supervisao: string | null;
	}

	interface Props {
		open: boolean;
		gise: GiseBreve;
		/** Texto global (Config. GISE) + com as colunas desta GISE = texto em PDF. */
		global: BreveRelatorioEnv | null | undefined;
		pendingCrud: boolean;
		onClose: () => void;
		onSubmit: SubmitFunction;
	}

	let { open, gise, global, pendingCrud, onClose, onSubmit }: Props = $props();

	let titulo = $state('');
	let textoSeccional = $state('');
	let textoSupervisao = $state('');

	/** Só ao abrir — evita apagar o que o usuário está a editar se `gise` re-renderizar. */
	let wasOpen = $state(false);
	$effect(() => {
		if (open && !wasOpen) {
			// Valores resolvidos = os mesmos que entram no PDF (GISE → Config. GISE → padrão).
			titulo = resolveBreveRelatorioTitulo(gise, global);
			textoSeccional = resolveBreveRelatorioConteudoSeccional(gise, global);
			textoSupervisao = resolveBreveRelatorioConteudoSupervisao(gise, global);
		}
		wasOpen = open;
	});
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
		role="presentation"
		onclick={(e) => e.target === e.currentTarget && onClose()}
	>
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[min(90vh,720px)] flex flex-col p-6"
			role="dialog"
			aria-labelledby="br-modal-title"
			aria-modal="true"
			tabindex="-1"
		>
			<h2
				id="br-modal-title"
				class="text-lg font-bold text-surface-900 dark:text-surface-50 shrink-0 mb-1"
			>
				Texto "Breve relatório" (PDFs de extra)
			</h2>
			<p class="text-sm text-surface-600 dark:text-surface-400 mb-4 shrink-0">
				Deixe vazio para o que estiver em <strong>Config. GISE</strong> (texto global) ou, se também vazio, o
				texto padrão do sistema. Abaixo, pode definir o texto <strong>desta</strong> GISE.
			</p>

			<form
				method="POST"
				action="?/salvarBreveRelatorio"
				use:enhance={onSubmit}
				class="flex flex-col gap-3 min-h-0 flex-1 overflow-y-auto"
			>
				<div>
					<label class="block text-sm font-medium mb-1" for="br_modal_tit">Título (rótulo)</label>
					<input
						id="br_modal_tit"
						name="breve_relatorio_titulo"
						type="text"
						bind:value={titulo}
						class="w-full px-2 py-1.5 text-sm rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900"
						placeholder={DEFAULT_BREVE_RELATORIO_TITULO}
					/>
				</div>
				<div>
					<label class="block text-sm font-medium mb-1" for="br_modal_sec"
						>Parágrafo — extra por <strong>seccional</strong></label
					>
					<textarea
						id="br_modal_sec"
						name="breve_relatorio_texto_seccional"
						rows="3"
						bind:value={textoSeccional}
						class="w-full px-2 py-1.5 text-sm rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900"
						placeholder={DEFAULT_BREVE_RELATORIO_TEXTO_SECCIONAL}
					></textarea>
				</div>
				<div>
					<label class="block text-sm font-medium mb-1" for="br_modal_sup"
						>Parágrafo — extra de <strong>supervisão</strong></label
					>
					<textarea
						id="br_modal_sup"
						name="breve_relatorio_texto_supervisao"
						rows="3"
						bind:value={textoSupervisao}
						class="w-full px-2 py-1.5 text-sm rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900"
						placeholder={DEFAULT_BREVE_RELATORIO_TEXTO_SUPERVISAO}
					></textarea>
				</div>
				<div class="flex justify-end gap-3 pt-2 border-t border-surface-200 dark:border-surface-700 shrink-0">
					<button
						type="button"
						class="btn preset-outlined-surface text-sm px-4 py-2 rounded-xl"
						onclick={onClose}
						disabled={pendingCrud}
					>
						Cancelar
					</button>
					<button
						type="submit"
						class="btn preset-filled-primary-500 text-sm px-4 py-2 rounded-xl"
						disabled={pendingCrud}
					>
						{pendingCrud ? 'Salvando...' : 'Salvar textos do breve relatório'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
