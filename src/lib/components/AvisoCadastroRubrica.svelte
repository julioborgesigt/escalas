<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { toaster } from '$lib/toast';
	import ModalCadastrarRubrica from './ModalCadastrarRubrica.svelte';

	/**
	 * Aviso pós-login "Cadastre sua rubrica", exibido pelo layout para o
	 * policial SEM rubrica que tem pendência concreta de assinatura (vínculo
	 * com GISE ativa ou solicitação de assinatura dirigida a ele).
	 *
	 * Adiável: "Deixar para depois" silencia pela sessão do navegador
	 * (sessionStorage) — no próximo login o aviso reaparece até a rubrica ser
	 * cadastrada. Após salvar, o guard local `cadastrada` cobre a janela de
	 * staleness do cache de sessão (`temRubrica`, até 60s).
	 */

	const SNOOZE_KEY = 'aviso-rubrica-adiado';

	let avisoAberto = $state(
		typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(SNOOZE_KEY)
	);
	let cadastrandoRubrica = $state(false);
	let cadastrada = $state(false);

	function adiar() {
		try {
			sessionStorage.setItem(SNOOZE_KEY, '1');
		} catch {
			// storage indisponível (modo privado restrito) — só fecha nesta página
		}
		avisoAberto = false;
	}

	function cadastrarAgora() {
		avisoAberto = false;
		cadastrandoRubrica = true;
	}
</script>

{#if !cadastrada}
	<Dialog
		open={avisoAberto}
		onOpenChange={(e) => {
			if (!e.open) adiar();
		}}
	>
		<Dialog.Content
			class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
		>
			<div
				class="card p-5 sm:p-6 max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
			>
				<div class="flex items-start gap-3 mb-4">
					<div
						class="p-2.5 rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400 shrink-0"
					>
						<svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
							/>
						</svg>
					</div>
					<div>
						<Dialog.Title class="h3 font-bold leading-tight">Cadastre sua rubrica</Dialog.Title>
						<Dialog.Description class="text-sm text-surface-500 dark:text-surface-400 mt-1">
							Você tem assinaturas pendentes e ainda não cadastrou sua rubrica.
						</Dialog.Description>
					</div>
				</div>

				<div class="space-y-2.5 text-sm text-surface-600 dark:text-surface-300 mb-5">
					<p>
						A rubrica é a sua assinatura gráfica: ela é carimbada nos documentos assinados
						digitalmente e permite <strong>conferência visual em cópias impressas</strong>, sem
						precisar acessar a página de validação.
					</p>
					<p>
						Ela também é obrigatória para assinar pelo computador com
						<strong>certificado digital (Token A3)</strong>.
					</p>
				</div>

				<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
					<button type="button" class="btn preset-outlined-surface-500" onclick={adiar}>
						Deixar para depois
					</button>
					<button
						type="button"
						class="btn preset-filled-primary-500 font-bold active:scale-95 transition-all"
						onclick={cadastrarAgora}
					>
						Cadastrar rubrica
					</button>
				</div>
			</div>
		</Dialog.Content>
	</Dialog>

	<ModalCadastrarRubrica
		bind:open={cadastrandoRubrica}
		onSaved={(nova) => {
			if (nova) {
				cadastrada = true;
				toaster.create({ title: 'Rubrica cadastrada com sucesso', type: 'success' });
			}
		}}
	/>
{/if}
