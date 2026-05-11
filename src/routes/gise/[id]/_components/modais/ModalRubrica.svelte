<script lang="ts">
	import SignaturePad from '$lib/components/SignaturePad.svelte';
	import { useScrollLock } from '$lib/composables';

	interface Props {
		open: boolean;
		exigirFoto: boolean;
		exigirGps: boolean;
		exigirCodigoEmail: boolean;
		onConfirm: (
			dataUrl: string,
			lat?: number,
			lng?: number,
			selfie?: string | null,
			codigoValidação?: string,
			desafioId?: string
		) => void | Promise<void>;
		onCancel: () => void;
	}

	let { open, exigirFoto, exigirGps, exigirCodigoEmail, onConfirm, onCancel }: Props = $props();

	useScrollLock(() => open);
</script>

<svelte:window onkeydown={(e) => { if (open && e.key === 'Escape') onCancel(); }} />

{#if open}
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-md overflow-y-auto"
		role="presentation"
		onclick={(e) => e.target === e.currentTarget && onCancel()}
	>
		<div
			class="bg-surface-50 dark:bg-surface-900 rounded-3xl shadow-2xl w-full max-w-2xl p-4 sm:p-8 space-y-5 sm:space-y-6 border border-white/10 max-h-[calc(100dvh-1.5rem)] overflow-y-auto"
			role="dialog"
			aria-modal="true"
		>
			<div class="text-center space-y-2">
				<h2 class="text-xl sm:text-2xl font-bold text-surface-900 dark:text-surface-50">
					Rubrica do Supervisor
				</h2>
				<p class="text-sm text-surface-500">
					Desenhe sua rubrica no quadro abaixo para assinar a escala.
				</p>
			</div>

			<SignaturePad
				{onConfirm}
				{onCancel}
				{exigirFoto}
				{exigirGps}
				{exigirCodigoEmail}
			/>

			<p class="text-sm text-surface-400 text-center italic">
				Esta rubrica será anexada permanentemente ao documento PDF desta escala.
			</p>
		</div>
	</div>
{/if}
