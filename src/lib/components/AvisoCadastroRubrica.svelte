<script lang="ts">
	import ModalShell from './ModalShell.svelte';
	import { toaster } from '$lib/toast';
	import ModalCadastrarRubrica from './ModalCadastrarRubrica.svelte';
	import { PenLine } from '@lucide/svelte';

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

{#snippet descricaoAviso()}
	<span class="flex items-start gap-3">
		<span
			class="p-2.5 rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400 shrink-0"
		>
			<PenLine class="w-6 h-6" aria-hidden="true" />
		</span>
		<span>Você tem assinaturas pendentes e ainda não cadastrou sua rubrica.</span>
	</span>
{/snippet}

{#if !cadastrada}
	<ModalShell
		bind:open={avisoAberto}
		title="Cadastre sua rubrica"
		description={descricaoAviso}
		largura="md"
		camada="base"
		familia="escalas"
		cancelLabel="Deixar para depois"
		onOpenChange={(novoOpen) => {
			if (!novoOpen) adiar();
		}}
	>
		<div class="space-y-2.5 text-sm text-surface-600 dark:text-surface-300">
			<p>
				A rubrica é a sua assinatura gráfica: ela é carimbada nos documentos assinados digitalmente
				e permite <strong>conferência visual em cópias impressas</strong>, sem precisar acessar a
				página de validação.
			</p>
			<p>
				Ela também é obrigatória para assinar pelo computador com
				<strong>certificado digital (Token A3)</strong>.
			</p>
		</div>

		{#snippet footer()}
			<button
				type="button"
				class="btn preset-filled-primary-500 font-bold transition-all"
				onclick={cadastrarAgora}
			>
				Cadastrar rubrica
			</button>
		{/snippet}
	</ModalShell>

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
