<!--
	Primitive compartilhada para diálogos: concentra a composição acessível do Skeleton
	e limita variações visuais a mapas explícitos observados nos domínios da aplicação.
-->
<script lang="ts">
	import { Dialog, Portal } from '@skeletonlabs/skeleton-svelte';
	import type { Snippet } from 'svelte';

	type Largura = 'sm' | 'md' | 'lg' | '2xl';
	type Camada = 'base' | 'empilhado' | 'duplo' | 'topo';
	type Padding = 'padrao' | 'compacto' | 'mobile';
	type Familia = 'escalas' | 'gise' | 'assinatura';
	type Role = 'dialog' | 'alertdialog';

	interface Props {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		largura?: Largura;
		camada?: Camada;
		padding?: Padding;
		familia?: Familia;
		portal?: boolean;
		pending?: boolean;
		scrollBackdrop?: boolean;
		role?: Role;
		title: string;
		description?: string | Snippet;
		header?: Snippet;
		children?: Snippet;
		footer?: Snippet;
		cancelLabel?: string | null;
	}

	const larguras: Record<Largura, string> = {
		sm: 'max-w-sm',
		md: 'max-w-md',
		lg: 'max-w-lg',
		'2xl': 'max-w-2xl'
	};

	const camadas: Record<Camada, { zIndex: string; blur: string }> = {
		base: { zIndex: 'z-50', blur: 'backdrop-blur-sm' },
		empilhado: { zIndex: 'z-[60]', blur: 'backdrop-blur-md' },
		duplo: { zIndex: 'z-[70]', blur: 'backdrop-blur-md' },
		topo: { zIndex: 'z-[100]', blur: 'backdrop-blur-sm' }
	};

	const paddings: Record<Padding, string> = {
		padrao: 'p-4',
		compacto: 'p-3 sm:p-4',
		mobile: 'p-2 sm:p-4'
	};

	const familias: Record<Familia, { painel: string; titulo: string; descricao: string }> = {
		escalas: {
			painel: 'card p-4 sm:p-6',
			titulo: 'h3 font-bold mb-2',
			descricao: 'text-surface-600 dark:text-surface-400 mb-6'
		},
		gise: {
			painel: 'card-elevated p-4 sm:p-6 space-y-4 border border-white/10',
			titulo: 'text-lg font-bold text-surface-900 dark:text-surface-50',
			descricao: 'text-sm text-surface-600 dark:text-surface-400'
		},
		assinatura: {
			painel: 'card-elevated p-5 sm:p-8 space-y-5 border border-white/10',
			titulo: 'text-xl sm:text-2xl font-bold text-center text-surface-900 dark:text-surface-50',
			descricao: 'text-sm text-center text-surface-600 dark:text-surface-400'
		}
	};

	let {
		open = $bindable(false),
		onOpenChange,
		largura = 'sm',
		camada = 'base',
		padding = 'padrao',
		familia = 'escalas',
		portal = false,
		pending = false,
		scrollBackdrop = true,
		role = 'dialog',
		title,
		description,
		header,
		children,
		footer,
		cancelLabel = null
	}: Props = $props();

	function handleOpenChange(event: { open: boolean }): void {
		if (!event.open && pending) return;

		open = event.open;
		onOpenChange?.(event.open);
	}
</script>

<Dialog
	{open}
	{role}
	closeOnEscape={!pending}
	closeOnInteractOutside={!pending}
	onOpenChange={handleOpenChange}
>
	<Portal disabled={!portal}>
		<!--
			Sem `onclick` aqui, de propósito. O `modal` do zag-js (padrão) bloqueia
			ponteiro: o `body` fica `pointer-events: none` e o backdrop nunca é alvo
			de clique — medido no Chromium, `elementFromPoint(4, 4)` devolve o
			`<html>` com o diálogo aberto. Quem fecha no clique fora é o
			`closeOnInteractOutside` → `onOpenChange`, que já respeita o `pending`.

			Um handler aqui não seria só código morto com cara de load-bearing: se
			algum dia passasse a receber o clique, fecharia também o `alertdialog`,
			que o zag-js deliberadamente NÃO dispensa por clique fora.
		-->
		<Dialog.Backdrop
			class={['fixed inset-0 bg-surface-950/80', camadas[camada].zIndex, camadas[camada].blur]}
		/>
		<Dialog.Positioner
			class={[
				'pointer-events-none fixed inset-0 flex items-center justify-center',
				camadas[camada].zIndex,
				paddings[padding],
				scrollBackdrop && 'overflow-y-auto'
			]}
		>
			<Dialog.Content
				class={[
					'pointer-events-auto w-full max-h-[calc(100dvh-2rem)] overflow-y-auto card-elevated shadow-2xl rounded-2xl',
					larguras[largura],
					familias[familia].painel
				]}
			>
				<Dialog.Title class={familias[familia].titulo}>{title}</Dialog.Title>

				{#if header}
					{@render header()}
				{/if}

				{#if description}
					<Dialog.Description class={familias[familia].descricao}>
						{#if typeof description === 'string'}
							{description}
						{:else}
							{@render description()}
						{/if}
					</Dialog.Description>
				{/if}

				{@render children?.()}

				{#if cancelLabel || footer}
					<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
						{#if cancelLabel}
							<Dialog.CloseTrigger
								type="button"
								class="btn preset-outlined-surface-500"
								disabled={pending}
							>
								{cancelLabel}
							</Dialog.CloseTrigger>
						{/if}
						{@render footer?.()}
					</div>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
