<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import ModalShell from '$lib/components/ModalShell.svelte';
	import { toaster } from '$lib/toast';
	import CalendarioSelecaoDias from './CalendarioSelecaoDias.svelte';
	import type { EscalaPolicialComDados } from '$lib/types';
	import type { ActionResult } from '@sveltejs/kit';

	let {
		open = $bindable(false),
		ids,
		diasIniciais,
		horaEntradaInicial,
		horaSaidaInicial,
		observacoesIniciais,
		horas,
		minutos,
		onsalvo
	}: {
		open: boolean;
		ids: number[];
		diasIniciais: string[];
		horaEntradaInicial: string;
		horaSaidaInicial: string;
		observacoesIniciais: string;
		horas: string[];
		minutos: string[];
		onsalvo: (policiais: EscalaPolicialComDados[]) => void;
	} = $props();

	let selecionados = $state<string[]>([]);
	let editHoraEntrada = $state('');
	let editMinutoEntrada = $state('');
	let editHoraSaida = $state('');
	let editMinutoSaida = $state('');
	let editObservacoes = $state('');

	let calAno = $state(new Date().getFullYear());
	let calMes = $state(new Date().getMonth());
	let pending = $state(false);

	$effect(() => {
		if (open) {
			selecionados = [...diasIniciais];
			if (diasIniciais.length > 0) {
				const [y, m] = diasIniciais[0].split('-').map(Number);
				calAno = y;
				calMes = m - 1;
			}
			const [he = '08', me = '00'] = horaEntradaInicial.split(':');
			const [hs = '08', ms = '00'] = horaSaidaInicial.split(':');
			editHoraEntrada = he;
			editMinutoEntrada = me;
			editHoraSaida = hs;
			editMinutoSaida = ms;
			editObservacoes = observacoesIniciais;
		}
	});

	const ordenados = $derived([...selecionados].sort());
	const diasJson = $derived(JSON.stringify(ordenados));
	const idsJson = $derived(JSON.stringify(ids));

	function handleSalvar({ cancel }: { cancel: () => void }) {
		if (ordenados.length === 0) {
			toaster.create({ title: 'Selecione pelo menos um dia', type: 'error' });
			cancel();
			return;
		}
		pending = true;
		return async ({ result }: { result: ActionResult }) => {
			pending = false;
			if (result.type === 'success') {
				onsalvo(result.data?.policiais);
				open = false;
				toaster.create({ title: 'Alterações salvas!', type: 'success' });

				const conflitantes =
					(result.data?.conflitantes as { data: string; motivo: string }[] | undefined) ?? [];
				if (conflitantes.length > 0) {
					const datas = conflitantes.map((c) => c.data).join(', ');
					toaster.create({
						title: `Adicionado — ${conflitantes.length} dia(s) com choque ignorado(s)`,
						description: `Dias ignorados: ${datas}`,
						type: 'warning'
					});
				}

				await invalidateAll();
			} else if (result.type === 'error') {
				toaster.create({ title: 'Erro de conexão. Tente novamente.', type: 'error' });
			} else {
				const d =
					result.type === 'failure'
						? (result.data as Record<string, unknown> | undefined)
						: undefined;
				toaster.create({ title: String(d?.error || 'Erro ao salvar alterações'), type: 'error' });
			}
		};
	}
</script>

<ModalShell
	bind:open
	title="Editar Escala de Plantão"
	description="Selecione os dias, ajuste o horário e preencha a observação."
	{pending}
	cancelLabel="Cancelar"
>
	<div class="rounded-xl border border-primary-500/20 p-4 sm:p-5 space-y-4">
		<CalendarioSelecaoDias bind:selecionados bind:ano={calAno} bind:mes={calMes} cor="primary" />

		<!-- Horários e Obs -->
		<div class="space-y-3">
			<div class="flex gap-4">
				<label class="flex-1 min-w-0">
					<span class="label-text text-2xs mb-1 block">Entrada</span>
					<div class="flex gap-1">
						<select
							class="select text-xs h-8 py-0 rounded-lg px-1 flex-1"
							bind:value={editHoraEntrada}
						>
							{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
						</select>
						<select
							class="select text-xs h-8 py-0 rounded-lg px-1 flex-1"
							bind:value={editMinutoEntrada}
						>
							{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
						</select>
					</div>
				</label>
				<label class="flex-1 min-w-0">
					<span class="label-text text-2xs mb-1 block">Saída</span>
					<div class="flex gap-1">
						<select
							class="select text-xs h-8 py-0 rounded-lg px-1 flex-1"
							bind:value={editHoraSaida}
						>
							{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
						</select>
						<select
							class="select text-xs h-8 py-0 rounded-lg px-1 flex-1"
							bind:value={editMinutoSaida}
						>
							{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
						</select>
					</div>
				</label>
			</div>
			<label class="block">
				<span class="label-text text-2xs mb-1 block">Observações</span>
				<input
					type="text"
					class="input text-xs h-8 px-2 rounded-lg w-full"
					bind:value={editObservacoes}
					maxlength="500"
					placeholder="Informações complementares..."
				/>
			</label>
		</div>
	</div>

	{#snippet footer()}
		<form
			method="POST"
			action="?/editarPlantaoAgrupado"
			use:enhance={handleSalvar}
			class="contents"
		>
			<input type="hidden" name="ids" value={idsJson} />
			<input type="hidden" name="datas" value={diasJson} />
			<input type="hidden" name="hora_entrada" value="{editHoraEntrada}:{editMinutoEntrada}" />
			<input type="hidden" name="hora_saida" value="{editHoraSaida}:{editMinutoSaida}" />
			<input type="hidden" name="observacoes" value={editObservacoes} />
			<button
				type="submit"
				class="btn text-xs font-bold px-4 py-1.5 rounded-lg preset-filled-primary-500"
				disabled={pending || ordenados.length === 0}
			>
				{pending ? 'Salvando...' : 'Salvar Alterações'}
			</button>
		</form>
	{/snippet}
</ModalShell>
