<script lang="ts">
	import { untrack } from 'svelte';
	import Clock from '@lucide/svelte/icons/clock';

	const {
		emailMascarado = '',
		totalSeconds = 60,
		onReenviar = undefined
	}: {
		emailMascarado?: string;
		totalSeconds?: number;
		onReenviar?: () => Promise<void>;
	} = $props();

	// svelte-ignore state_referenced_locally
	let segundosRestantes = $state(totalSeconds);
	let reenviando = $state(false);

	$effect(() => {
		segundosRestantes = totalSeconds;
		const id = setInterval(() => {
			if (untrack(() => segundosRestantes) > 0) {
				segundosRestantes--;
			}
		}, 1000);
		return () => clearInterval(id);
	});

	const min = $derived(Math.floor(segundosRestantes / 60));
	const sec = $derived(segundosRestantes % 60);
	const podeReenviar = $derived(segundosRestantes === 0 && !reenviando);

	async function handleReenviar() {
		if (!onReenviar || !podeReenviar) return;
		reenviando = true;
		try {
			await onReenviar();
			segundosRestantes = totalSeconds;
		} catch (err) {
			console.error('[CodigoTimer] Erro ao reenviar código:', err);
		} finally {
			reenviando = false;
		}
	}
</script>

<div class="flex flex-col items-center gap-1.5 text-center">
	{#if emailMascarado}
		<p class="text-sm text-surface-600 dark:text-surface-400">
			Código enviado para<br />
			<span class="font-semibold text-surface-800 dark:text-surface-200">{emailMascarado}</span>
		</p>
	{/if}

	{#if segundosRestantes > 0}
		<div class="flex items-center gap-1.5 text-xs text-surface-600 dark:text-surface-400 mt-1">
			<Clock class="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
			<span>
				Reenviar disponível em
				<span class="font-bold tabular-nums text-surface-700 dark:text-surface-300">
					{min}:{String(sec).padStart(2, '0')}
				</span>
			</span>
		</div>
	{:else if onReenviar}
		<button
			type="button"
			class="text-sm font-semibold text-primary-600 dark:text-primary-400 underline underline-offset-2 decoration-primary-500/30 hover:decoration-primary-500 transition-all disabled:opacity-40"
			disabled={reenviando}
			onclick={handleReenviar}
		>
			{reenviando ? 'Reenviando...' : 'Reenviar código'}
		</button>
	{:else}
		<p class="text-xs text-surface-600 dark:text-surface-400">
			Não recebeu?
			<span class="font-medium">Volte ao login para solicitar um novo código.</span>
		</p>
	{/if}
</div>
