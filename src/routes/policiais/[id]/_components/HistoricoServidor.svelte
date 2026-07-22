<script lang="ts">
	import type { PolicialHistorico } from '$lib/types';
	import { formatarData } from '$lib/utils';
	import { LABEL_SUBTIPO_AFASTAMENTO } from '$lib/schemas/policial-historico';
	import {
		ArrowRightLeft,
		CalendarOff,
		UserMinus,
		Pencil,
		ShieldCheck,
		FileText,
		History,
		CircleDot
	} from 'lucide-svelte';

	interface Props {
		historico: PolicialHistorico[];
		afastamentoVigenteId: number | null;
	}

	const { historico, afastamentoVigenteId }: Props = $props();

	const META: Record<
		string,
		{ label: string; icon: typeof CircleDot; cor: string; ponto: string }
	> = {
		movimentacao: {
			label: 'Movimentação',
			icon: ArrowRightLeft,
			cor: 'text-primary-500',
			ponto: 'bg-primary-500'
		},
		afastamento: {
			label: 'Afastamento',
			icon: CalendarOff,
			cor: 'text-warning-500',
			ponto: 'bg-warning-500'
		},
		desvinculacao: {
			label: 'Desvinculação',
			icon: UserMinus,
			cor: 'text-error-500',
			ponto: 'bg-error-500'
		},
		edicao: {
			label: 'Edição cadastral',
			icon: Pencil,
			cor: 'text-surface-500',
			ponto: 'bg-surface-400'
		},
		papel: {
			label: 'Mudança de papel',
			icon: ShieldCheck,
			cor: 'text-tertiary-500',
			ponto: 'bg-tertiary-500'
		}
	};

	function meta(tipo: string) {
		return (
			META[tipo] ?? {
				label: tipo,
				icon: CircleDot,
				cor: 'text-surface-500',
				ponto: 'bg-surface-400'
			}
		);
	}

	/** "2026-07-22 14:30:05" → "22/07/2026 14:30". */
	function dataHora(ts: string): string {
		if (!ts) return '';
		const [dia, hora] = ts.split(/[ T]/);
		return `${formatarData(dia)}${hora ? ' ' + hora.slice(0, 5) : ''}`;
	}

	const LABEL_CAMPO: Record<string, string> = {
		nome: 'Nome',
		matricula: 'Matrícula',
		cargo: 'Cargo',
		telefone: 'Telefone',
		lotacao: 'Lotação',
		regime: 'Regime',
		classe: 'Classe',
		email: 'E-mail',
		email_pessoal: 'E-mail pessoal',
		papel: 'Papel',
		papel_unidade_id: 'Unidade do papel',
		ativo: 'Ativo'
	};

	function parseDiff(json: string | null): Record<string, unknown> {
		if (!json) return {};
		try {
			return JSON.parse(json) as Record<string, unknown>;
		} catch {
			return {};
		}
	}

	function mostrarValor(v: unknown): string {
		if (v === null || v === undefined || v === '') return '—';
		return String(v);
	}

	function diffLinhas(antes: string | null, depois: string | null) {
		const a = parseDiff(antes);
		const d = parseDiff(depois);
		const chaves = new Set([...Object.keys(a), ...Object.keys(d)]);
		return [...chaves].map((c) => ({
			campo: LABEL_CAMPO[c] ?? c,
			antes: mostrarValor(a[c]),
			depois: mostrarValor(d[c])
		}));
	}
</script>

<div class="card-glass p-3 sm:p-4 rounded-xl mt-4">
	<h2
		class="text-base font-bold mb-3 text-surface-700 dark:text-surface-300 flex items-center gap-2"
	>
		<History size={18} /> Histórico do Servidor
	</h2>

	{#if historico.length === 0}
		<p class="text-sm text-surface-500 italic py-4 text-center">
			Nenhum registro no histórico ainda.
		</p>
	{:else}
		<ol class="relative border-s-2 border-surface-200 dark:border-surface-700 ml-2 space-y-4">
			{#each historico as ev (ev.id)}
				{@const m = meta(ev.tipo)}
				{@const Icone = m.icon}
				<li class="ms-5">
					<span
						class="absolute -start-[7px] mt-1.5 h-3 w-3 rounded-full ring-4 ring-surface-50 dark:ring-surface-900 {m.ponto}"
					></span>
					<div
						class="rounded-xl bg-surface-100/50 dark:bg-surface-800/40 border border-surface-200 dark:border-white/10 p-3"
					>
						<div class="flex items-start justify-between gap-2 flex-wrap">
							<div class="flex items-center gap-2 font-semibold text-sm {m.cor}">
								<Icone size={16} />
								<span>{m.label}</span>
								{#if ev.tipo === 'afastamento' && ev.id === afastamentoVigenteId}
									<span class="badge preset-filled-warning-500 text-3xs">Vigente</span>
								{/if}
							</div>
							<span class="text-3xs text-surface-500 tabular-nums">{dataHora(ev.created_at)}</span>
						</div>

						<div class="mt-2 text-sm text-surface-700 dark:text-surface-200 space-y-1">
							{#if ev.tipo === 'movimentacao'}
								<p class="flex items-center gap-1.5 flex-wrap">
									<span class="text-surface-500">{ev.unidade_origem || '—'}</span>
									<ArrowRightLeft size={14} class="text-primary-500" />
									<span class="font-medium">{ev.unidade_destino}</span>
								</p>
								{#if ev.data_evento}<p class="text-xs text-surface-500">
										Data: {formatarData(ev.data_evento)}
									</p>{/if}
							{:else if ev.tipo === 'afastamento'}
								<p class="font-medium">
									{LABEL_SUBTIPO_AFASTAMENTO[
										ev.subtipo as keyof typeof LABEL_SUBTIPO_AFASTAMENTO
									] ?? ev.subtipo}
								</p>
								{#if ev.descricao}<p class="text-xs">{ev.descricao}</p>{/if}
								<p class="text-xs text-surface-500">
									{formatarData(ev.data_inicio ?? '')} a {formatarData(ev.data_fim ?? '')}
									{#if ev.qtd_dias}· {ev.qtd_dias} dia(s){/if}
								</p>
							{:else if ev.tipo === 'desvinculacao'}
								<p>
									Destino: <span class="font-medium">{ev.descricao || ev.unidade_destino}</span>
								</p>
								{#if ev.data_evento}<p class="text-xs text-surface-500">
										Data: {formatarData(ev.data_evento)}
									</p>{/if}
							{:else if ev.tipo === 'edicao' || ev.tipo === 'papel'}
								<div class="space-y-0.5">
									{#each diffLinhas(ev.dados_antes, ev.dados_depois) as l (l.campo)}
										<p class="text-xs">
											<span class="font-medium">{l.campo}:</span>
											<span class="text-surface-500 line-through">{l.antes}</span>
											<span class="mx-1">→</span>
											<span>{l.depois}</span>
										</p>
									{/each}
								</div>
							{/if}

							{#if ev.nup}
								<p class="text-3xs text-surface-500 font-mono">NUP: {ev.nup}</p>
							{/if}
						</div>

						<div class="mt-2 flex items-center justify-between gap-2 flex-wrap">
							{#if ev.registrado_por_nome}
								<span class="text-3xs text-surface-400">por {ev.registrado_por_nome}</span>
							{:else}
								<span></span>
							{/if}
							{#if ev.documento_r2_key}
								<a
									href="/api/policiais/historico/{ev.id}/documento"
									target="_blank"
									rel="noopener"
									class="btn btn-sm preset-outlined-primary-500 flex items-center gap-1.5 text-xs"
								>
									<FileText size={14} /> Documento
								</a>
							{/if}
						</div>
					</div>
				</li>
			{/each}
		</ol>
	{/if}
</div>
