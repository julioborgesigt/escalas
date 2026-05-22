<script lang="ts">
	import { slide } from 'svelte/transition';
	import { formatarData } from '$lib/utils';

	let {
		escalasParaAssinar,
		assinaturaTelaBloqueada,
		isMobile,
		onIniciarAssinaturaTela,
		onIniciarAssinaturaToken,
		onVoltar
	}: {
		escalasParaAssinar: Array<{
			id: number;
			titulo: string;
			cidade: string;
			data_inicio: string;
			data_fim: string;
			tipo: string;
			lotacao: string;
			is_assinada: boolean;
		}>;
		assinaturaTelaBloqueada: boolean;
		isMobile: boolean;
		onIniciarAssinaturaTela: (id: number) => void;
		onIniciarAssinaturaToken: (id: number) => void;
		onVoltar: () => void;
	} = $props();

	let menuExpandidoId = $state<number | null>(null);

	const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
</script>

<div class="flex flex-col gap-6">
	<div class="min-w-0 flex-1 space-y-3 pb-5 border-b border-surface-200/70 dark:border-surface-700/60">
		<button
			type="button"
			class="btn btn-sm preset-outlined-surface-500 hover:bg-surface-50 dark:hover:bg-surface-900 px-3 py-1.5 rounded-xl transition-all flex w-fit max-w-full items-center gap-2 group"
			onclick={onVoltar}
		>
			<svg
				class="w-4 h-4 shrink-0 transition-transform group-hover:-translate-x-1"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2.5"
					d="M10 19l-7-7m0 0l7-7m-7 7h18"
				/>
			</svg>
			<span class="text-sm font-bold uppercase tracking-wider">Voltar</span>
		</button>

		<div class="flex items-center gap-3">
			<h1 class="font-bold leading-tight text-surface-900 dark:text-surface-50 text-xl sm:text-2xl xl:text-3xl">
				Assinaturas Pendentes
			</h1>
			<span class="badge preset-filled-tertiary-500 text-white font-bold text-sm px-2">{escalasParaAssinar.length}</span>
		</div>
	</div>

	{#if escalasParaAssinar.length === 0}
		<div class="text-center py-16 text-surface-500">
			<svg class="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
			</svg>
			<p class="font-semibold">Nenhuma escala pendente de assinatura.</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			{#each escalasParaAssinar as esc (esc.id)}
				{@const dAss = new Date(esc.data_inicio + 'T00:00:00')}
				{@const isPlantao = esc.tipo === 'plantao'}
				{@const isExp = esc.tipo === 'expediente'}
				{@const accentBar = isPlantao ? 'bg-primary-500' : isExp ? 'bg-secondary-500' : 'bg-tertiary-500'}
				{@const tipoBadgeClass = isPlantao
					? 'bg-primary-500/10 text-primary-700 dark:text-primary-400'
					: isExp
						? 'bg-secondary-500/10 text-secondary-700 dark:text-secondary-400'
						: 'bg-tertiary-500/10 text-tertiary-700 dark:text-tertiary-400'}
				{@const tipoLabel = isPlantao ? 'Plantão' : isExp ? 'Expediente' : 'FDS'}
				{@const tituloPeriodo = esc.tipo !== 'fds'
					? `${MESES_PT[dAss.getMonth()]} ${dAss.getFullYear()}`
					: `${formatarData(esc.data_inicio)} – ${formatarData(esc.data_fim)}`}

				<div class="flex flex-col rounded-2xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-sm overflow-hidden hover:shadow-md hover:border-tertiary-500/40 dark:hover:border-tertiary-400/20 transition-all duration-200 group">
					<div class="h-1 {accentBar}"></div>

					<div class="flex flex-col gap-3 p-4 sm:p-5 flex-1">
						<div class="flex items-center gap-2 flex-wrap">
							<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-wide {tipoBadgeClass}">
								{tipoLabel}
							</span>
							<span class="inline-flex items-center gap-1 rounded-full bg-warning-500/15 px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-wide text-warning-700 dark:text-warning-400">
								<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
								</svg>
								Aguardando assinatura
							</span>
						</div>

						<div class="flex-1">
							<p class="text-base sm:text-lg font-bold text-surface-800 dark:text-surface-100 leading-tight group-hover:text-tertiary-600 dark:group-hover:text-tertiary-300 transition-colors">
								{tituloPeriodo}
							</p>
							<p class="text-sm font-medium text-surface-600 dark:text-surface-300 mt-1 truncate">{esc.lotacao}</p>
							<p class="text-xs text-surface-400 dark:text-surface-500 mt-0.5">
								{esc.cidade} · {formatarData(esc.data_inicio)} a {formatarData(esc.data_fim)}
							</p>
						</div>

						<div class="pt-3 border-t border-surface-100 dark:border-surface-700/50 flex flex-col gap-2">
							{#if isMobile}
								<button
									type="button"
									class="btn btn-sm {esc.is_assinada ? 'preset-filled-success-500 text-white' : 'preset-filled-warning-500'} font-bold text-xs px-3 py-2 w-full disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all flex items-center justify-center gap-1.5"
									disabled={assinaturaTelaBloqueada || esc.is_assinada}
									title={esc.is_assinada ? 'Já assinado' : (assinaturaTelaBloqueada ? 'Restrito a dispositivos móveis pelo administrador' : undefined)}
									onclick={() => onIniciarAssinaturaTela(esc.id)}
								>
									{#if esc.is_assinada}
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
										</svg>
									{:else}
										<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
									{/if}
									{esc.is_assinada ? 'Assinado' : 'Assinar (Tela)'}
								</button>
							{:else}
								<button
									type="button"
									class="btn btn-sm {esc.is_assinada ? 'preset-filled-success-500 text-white' : 'preset-filled-tertiary-500'} font-bold text-xs px-3 py-2 w-full active:scale-95 transition-all flex items-center justify-center gap-1.5"
									disabled={esc.is_assinada}
									onclick={() => onIniciarAssinaturaToken(esc.id)}
								>
									{#if esc.is_assinada}
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
										</svg>
									{:else}
										<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
									{/if}
									{esc.is_assinada ? 'Assinado' : 'Assinar (Token)'}
								</button>
							{/if}

							<button
								type="button"
								class="btn btn-sm {menuExpandidoId === esc.id
									? 'preset-filled-surface-500 text-white'
									: 'preset-outlined-surface-500'} text-xs px-3 py-1.5 transition-all font-bold w-full"
								onclick={() => (menuExpandidoId = menuExpandidoId === esc.id ? null : esc.id)}
							>
								{menuExpandidoId === esc.id ? 'Ocultar' : 'Ver PDF(s)'}
							</button>

							{#if menuExpandidoId === esc.id}
								<div class="flex flex-row gap-2 w-full mt-1" transition:slide={{ duration: 200 }}>
									<a
										class="btn flex-1 justify-center preset-filled-surface-100 dark:preset-filled-surface-800 text-[0.65rem] sm:text-[0.7rem] py-2 px-1 border border-surface-200 dark:border-surface-700 hover:preset-filled-primary-500 hover:text-white transition-all no-underline font-bold uppercase tracking-tight whitespace-nowrap shadow-sm"
										href="/api/escalas/{esc.id}/download?format=pdf"
										target="_blank"
									>PDF (conferência)</a>
									<a
										class="btn flex-1 justify-center preset-filled-surface-100 dark:preset-filled-surface-800 text-[0.65rem] sm:text-[0.7rem] py-2 px-1 border border-surface-200 dark:border-surface-700 hover:preset-filled-success-500 hover:text-white transition-all no-underline font-bold uppercase tracking-tight whitespace-nowrap shadow-sm {!esc.is_assinada ? 'opacity-50 pointer-events-none' : ''}"
										href="/api/escalas/{esc.id}/documento-assinado"
										target="_blank"
									>PDF assinado</a>
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
