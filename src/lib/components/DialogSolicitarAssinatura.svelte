<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { csrfHeaders } from '$lib/csrf';
	import { toaster } from '$lib/toast';
	import Spinner from '$lib/components/Spinner.svelte';

	/**
	 * Diálogo de solicitação de assinatura de escala a um DPC (unidade titular
	 * ou respondência com busca). Compartilhado pela lista `/escalas` e pelo
	 * `PainelAssinaturaDigital` (detalhe) — cada caller trata o sucesso no
	 * `onConfirmado` (invalidação segmentada, atualização de estado local etc.).
	 */
	let {
		open = $bindable(false),
		escalaId,
		onConfirmado
	}: {
		open: boolean;
		escalaId: number | string | null;
		onConfirmado: (solicitacao: {
			tipo: 'unidade' | 'respondencia';
			destinatario_id?: number;
		}) => void | Promise<void>;
	} = $props();

	let opcaoSolicitacao = $state<'unidade' | 'respondencia'>('unidade');
	let buscaDestinatario = $state('');
	let destinatarioSelecionado = $state<{ id: number; nome: string; lotacao: string } | null>(null);
	let resultadosBuscaDestinatario = $state<
		Array<{ id: number; nome: string; cargo: string; lotacao: string }>
	>([]);
	let buscandoDestinatario = $state(false);
	let enviandoSolicitacao = $state(false);
	let erroBuscaDestinatario = $state('');

	let buscaTimer: ReturnType<typeof setTimeout> | null = null;
	let buscaController: AbortController | null = null;

	$effect(() => {
		if (open) {
			opcaoSolicitacao = 'unidade';
			buscaDestinatario = '';
			destinatarioSelecionado = null;
			resultadosBuscaDestinatario = [];
			erroBuscaDestinatario = '';
		} else {
			if (buscaTimer) {
				clearTimeout(buscaTimer);
				buscaTimer = null;
			}
			buscaController?.abort();
			buscaController = null;
			buscandoDestinatario = false;
		}
	});

	async function buscarDestinatarios(q: string) {
		if (buscaTimer) clearTimeout(buscaTimer);
		// Cancela a busca em voo: evita resultado antigo chegando depois do novo
		buscaController?.abort();
		resultadosBuscaDestinatario = [];
		erroBuscaDestinatario = '';
		if (q.trim().length < 2) {
			buscandoDestinatario = false;
			return;
		}
		// Feedback imediato enquanto digita — antes o spinner só aparecia depois
		// do debounce + rede, e em conexão lenta parecia que nada acontecia.
		buscandoDestinatario = true;
		buscaTimer = setTimeout(async () => {
			const controller = new AbortController();
			buscaController = controller;
			try {
				const res = await fetch(
					`/api/policiais/search?cargo=DPC&somente_admins=true&q=${encodeURIComponent(q.trim())}&limit=8`,
					{ signal: controller.signal }
				);
				if (res.ok) {
					const json = await res.json();
					resultadosBuscaDestinatario = json.policiais ?? [];
					if (resultadosBuscaDestinatario.length === 0) {
						erroBuscaDestinatario = 'Nenhum delegado (DPC) administrador encontrado.';
					}
				} else {
					erroBuscaDestinatario = 'Erro ao buscar delegados. Tente novamente.';
				}
			} catch {
				if (controller.signal.aborted) return; // substituída por busca mais nova
				erroBuscaDestinatario = 'Erro de rede ao buscar delegados. Tente novamente.';
			} finally {
				if (!controller.signal.aborted) buscandoDestinatario = false;
			}
		}, 300);
	}

	async function confirmarSolicitacao() {
		if (!escalaId) return;
		if (opcaoSolicitacao === 'respondencia' && !destinatarioSelecionado) return;
		enviandoSolicitacao = true;
		try {
			const res = await fetch(`/api/escalas/${escalaId}/solicitar-assinatura`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
				body: JSON.stringify({
					tipo: opcaoSolicitacao,
					destinatario_id: destinatarioSelecionado?.id
				})
			});
			if (res.ok) {
				open = false;
				toaster.create({ title: 'Solicitação de assinatura enviada', type: 'success' });
				await onConfirmado({
					tipo: opcaoSolicitacao,
					destinatario_id: destinatarioSelecionado?.id
				});
			} else {
				const json = await res.json().catch(() => ({}));
				toaster.create({
					title: (json as { error?: string }).error || 'Erro ao enviar solicitação',
					type: 'error'
				});
			}
		} catch {
			toaster.create({ title: 'Erro de rede ao enviar solicitação', type: 'error' });
		} finally {
			enviandoSolicitacao = false;
		}
	}
</script>

<Dialog
	{open}
	onOpenChange={(e) => {
		if (!e.open) open = false;
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto"
	>
		<div
			class="card p-4 sm:p-6 max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto card-elevated shadow-2xl rounded-2xl"
		>
			<Dialog.Title class="h3 font-bold mb-1">Solicitar Assinatura</Dialog.Title>
			<Dialog.Description class="text-sm text-surface-500 dark:text-surface-400 mb-5">
				Quem deve assinar esta escala?
			</Dialog.Description>

			<div class="space-y-3 mb-5">
				<button
					type="button"
					class="w-full p-4 rounded-xl border-2 text-left transition-all {opcaoSolicitacao ===
					'unidade'
						? 'border-primary-500 bg-primary-500/10'
						: 'border-surface-300 dark:border-white/10 hover:border-primary-400/60'}"
					onclick={() => {
						opcaoSolicitacao = 'unidade';
						destinatarioSelecionado = null;
					}}
				>
					<div class="flex items-start gap-3">
						<div
							class="mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors {opcaoSolicitacao ===
							'unidade'
								? 'border-primary-500'
								: 'border-surface-400'}"
						>
							{#if opcaoSolicitacao === 'unidade'}
								<div class="w-2.5 h-2.5 rounded-full bg-primary-500"></div>
							{/if}
						</div>
						<div>
							<div class="font-semibold text-sm">Admin da Unidade</div>
							<div class="text-xs text-surface-500 mt-0.5">
								O delegado titular da unidade assina o documento
							</div>
						</div>
					</div>
				</button>

				<button
					type="button"
					class="w-full p-4 rounded-xl border-2 text-left transition-all {opcaoSolicitacao ===
					'respondencia'
						? 'border-tertiary-500 bg-tertiary-500/10'
						: 'border-surface-300 dark:border-white/10 hover:border-tertiary-400/60'}"
					onclick={() => {
						opcaoSolicitacao = 'respondencia';
					}}
				>
					<div class="flex items-start gap-3">
						<div
							class="mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors {opcaoSolicitacao ===
							'respondencia'
								? 'border-tertiary-500'
								: 'border-surface-400'}"
						>
							{#if opcaoSolicitacao === 'respondencia'}
								<div class="w-2.5 h-2.5 rounded-full bg-tertiary-500"></div>
							{/if}
						</div>
						<div>
							<div class="font-semibold text-sm">Admin em Respondência</div>
							<div class="text-xs text-surface-500 mt-0.5">
								Escolha um delegado de outra unidade para assinar
							</div>
						</div>
					</div>
				</button>

				{#if opcaoSolicitacao === 'respondencia'}
					<div class="pl-4 space-y-2 pt-1 animate-fade-in">
						{#if destinatarioSelecionado}
							<div
								class="flex items-center gap-3 p-3 rounded-xl bg-tertiary-500/10 border border-tertiary-500/30"
							>
								<div class="flex-1 min-w-0">
									<div class="text-sm font-semibold truncate">{destinatarioSelecionado.nome}</div>
									<div class="text-xs text-surface-500 truncate">
										{destinatarioSelecionado.lotacao}
									</div>
								</div>
								<button
									type="button"
									class="btn btn-sm preset-outlined-surface-500 shrink-0"
									onclick={() => {
										destinatarioSelecionado = null;
										buscaDestinatario = '';
										resultadosBuscaDestinatario = [];
									}}
								>
									Trocar
								</button>
							</div>
						{:else}
							<div class="relative">
								<input
									type="text"
									class="input w-full text-sm pr-8"
									placeholder="Buscar delegado (DPC) por nome ou matrícula…"
									bind:value={buscaDestinatario}
									oninput={(e) => buscarDestinatarios(e.currentTarget.value)}
								/>
								{#if buscandoDestinatario}
									<Spinner
										size="sm"
										class="absolute right-3 top-1/2 -translate-y-1/2 text-tertiary-500"
									/>
								{/if}
							</div>
							{#if buscandoDestinatario}
								<p
									class="text-xs text-surface-500 px-1 flex items-center gap-1.5"
									role="status"
									aria-live="polite"
								>
									<Spinner size="sm" class="text-tertiary-500" /> Buscando delegados…
								</p>
							{:else if resultadosBuscaDestinatario.length > 0}
								<div
									class="card rounded-xl border border-surface-200 dark:border-white/10 overflow-hidden max-h-44 overflow-y-auto shadow-md"
								>
									{#each resultadosBuscaDestinatario as p (p.id)}
										<button
											type="button"
											class="w-full text-left px-3 py-2.5 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors border-b border-surface-100 dark:border-white/5 last:border-0"
											onclick={() => {
												destinatarioSelecionado = p;
												resultadosBuscaDestinatario = [];
												buscaDestinatario = '';
											}}
										>
											<div class="text-sm font-medium">{p.nome}</div>
											<div class="text-xs text-surface-500">{p.lotacao}</div>
										</button>
									{/each}
								</div>
							{:else if erroBuscaDestinatario}
								<p class="text-xs text-surface-500 dark:text-surface-400 px-1">
									{erroBuscaDestinatario}
								</p>
							{/if}
						{/if}
					</div>
				{/if}
			</div>

			<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
				<button type="button" class="btn preset-outlined-surface-500" onclick={() => (open = false)}
					>Cancelar</button
				>
				<button
					type="button"
					class="btn preset-filled-primary-500 font-bold disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
					disabled={enviandoSolicitacao ||
						(opcaoSolicitacao === 'respondencia' && !destinatarioSelecionado)}
					onclick={confirmarSolicitacao}
				>
					{enviandoSolicitacao ? 'Enviando…' : 'Confirmar'}
				</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog>
