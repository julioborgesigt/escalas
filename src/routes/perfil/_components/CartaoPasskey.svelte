<script lang="ts">
	/**
	 * Cadastro da chave de assinatura (passkey) do próprio titular.
	 *
	 * Fica ao lado da rubrica porque a pergunta do usuário é a mesma — "o que eu
	 * preciso ter cadastrado para assinar?" —, mas as duas provam coisas
	 * diferentes e a tela não pode embaralhar: a rubrica é o desenho que aparece
	 * no documento; a passkey é a chave, guardada no aparelho, que prova que foi
	 * o titular quem assinou.
	 *
	 * Três estados, e o primeiro é o que evita a pior experiência: aparelho SEM
	 * biometria/PIN configurado não consegue registrar. Descobrir isso aqui, com
	 * instrução do que fazer, é muito melhor que descobrir com a escala pronta e
	 * o prazo correndo.
	 *
	 * O texto NUNCA promete mais do que o sistema verifica. iOS e Android
	 * sincronizam passkeys por padrão: quando isso acontece, a credencial prova
	 * a conta do titular, não aquele aparelho — e é isso que `vinculo` diz, com
	 * a mesma frase que vai ao manifesto do PDF.
	 */
	import { onMount, untrack } from 'svelte';
	import { toaster } from '$lib/toast';
	import { loading } from '$lib/loading.svelte';
	import { passkeyDisponivel, registrarPasskey, revogarPasskey } from '$lib/webauthn-cliente';

	const {
		credencialAtual
	}: {
		credencialAtual: { criadoEm: string; vinculo: string } | null;
	} = $props();

	// Semente do `load`, depois vida própria: registrar e revogar atualizam o
	// cartão sem recarregar a página. `untrack` é o mesmo padrão da rubrica em
	// `perfil/+page.svelte` — sem ele, o Svelte avisa que a referência captura
	// só o valor inicial, que é exatamente a intenção aqui.
	let atual = $state(untrack(() => credencialAtual));
	let disponivel = $state<boolean | null>(null);
	let confirmarRevogacao = $state(false);

	onMount(async () => {
		disponivel = await passkeyDisponivel();
	});

	async function registrar() {
		loading.show('Aguardando confirmação no aparelho...');
		try {
			const r = await registrarPasskey();
			atual = { criadoEm: new Date().toISOString(), vinculo: r.vinculo };
			toaster.create({ title: 'Chave de assinatura registrada.', type: 'success' });
		} catch (e: unknown) {
			// `NotAllowedError` é o que o navegador manda tanto para "cancelou"
			// quanto para "expirou o tempo": a mensagem genérica da plataforma não
			// ajuda ninguém, então traduzimos.
			const msg =
				e instanceof DOMException && e.name === 'NotAllowedError'
					? 'Cadastro cancelado ou tempo esgotado no aparelho.'
					: e instanceof Error
						? e.message
						: 'Erro ao registrar a chave.';
			toaster.create({ title: msg, type: 'error' });
		} finally {
			loading.hide();
		}
	}

	async function revogar() {
		loading.show('Revogando...');
		try {
			await revogarPasskey();
			atual = null;
			confirmarRevogacao = false;
			toaster.create({ title: 'Chave de assinatura revogada.', type: 'info' });
		} catch (e: unknown) {
			toaster.create({
				title: e instanceof Error ? e.message : 'Erro ao revogar.',
				type: 'error'
			});
		} finally {
			loading.hide();
		}
	}

	const dataFormatada = $derived(atual ? new Date(atual.criadoEm).toLocaleDateString('pt-BR') : '');
</script>

<section class="card-elevated rounded-2xl p-4 sm:p-6">
	<h2
		class="font-semibold text-sm uppercase tracking-wider text-surface-600 dark:text-surface-400 mb-1"
	>
		Chave de assinatura
	</h2>
	<p class="text-xs text-surface-600 dark:text-surface-400 mb-4">
		Chave criada e guardada pelo seu celular, liberada pela sua biometria ou PIN a cada assinatura.
		Diferente da rubrica: a rubrica é o desenho que aparece no documento; a chave é o que prova que
		foi você quem assinou.
	</p>

	{#if disponivel === false}
		<div class="p-3 rounded-xl bg-warning-500/5 border border-warning-500/20">
			<p class="text-sm text-surface-700 dark:text-surface-300">
				Este aparelho não oferece o cadastro. Verifique se há <strong
					>bloqueio de tela com biometria ou PIN</strong
				> configurado e, se estiver usando computador, refaça o cadastro pelo celular.
			</p>
		</div>
	{:else if atual}
		<div class="flex flex-col gap-3">
			<div class="p-3 rounded-xl bg-success-500/5 border border-success-500/20">
				<p class="text-sm font-semibold text-surface-900 dark:text-white">
					Chave registrada em {dataFormatada}
				</p>
				<p class="text-xs text-surface-600 dark:text-surface-400 mt-0.5">
					Credencial {atual.vinculo}.
				</p>
			</div>
			{#if confirmarRevogacao}
				<div class="p-3 rounded-xl bg-error-500/5 border border-error-500/20 flex flex-col gap-2">
					<p class="text-xs text-surface-700 dark:text-surface-300">
						Revogar impede assinar com esta chave até você registrar outra. Os documentos já
						assinados continuam válidos.
					</p>
					<div class="flex gap-2">
						<button
							type="button"
							class="btn btn-sm preset-filled-error-500 flex-1"
							onclick={revogar}
						>
							Confirmar revogação
						</button>
						<button
							type="button"
							class="btn btn-sm preset-outlined-surface-500 flex-1"
							onclick={() => (confirmarRevogacao = false)}
						>
							Cancelar
						</button>
					</div>
				</div>
			{:else}
				<div class="flex gap-2">
					<button
						type="button"
						class="btn btn-sm preset-outlined-primary-500 flex-1"
						onclick={registrar}
						disabled={disponivel === null}
					>
						Registrar neste aparelho
					</button>
					<button
						type="button"
						class="btn btn-sm preset-outlined-error-500 flex-1"
						onclick={() => (confirmarRevogacao = true)}
					>
						Revogar
					</button>
				</div>
				<p class="text-3xs text-surface-600 dark:text-surface-400 italic">
					Registrar de novo substitui a chave atual — é o caminho de quem trocou de celular.
				</p>
			{/if}
		</div>
	{:else}
		<div class="flex flex-col gap-3">
			<p class="text-sm text-surface-600 dark:text-surface-400">
				Você ainda não registrou uma chave de assinatura. Ela só é exigida quando a administração
				ativa esse reforço; registrar antes evita ficar sem assinar no dia em que for exigida.
			</p>
			<button
				type="button"
				class="btn btn-sm preset-filled-primary-500 font-bold w-full"
				onclick={registrar}
				disabled={disponivel === null}
			>
				Registrar neste aparelho
			</button>
		</div>
	{/if}
</section>
