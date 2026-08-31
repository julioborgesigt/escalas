<script lang="ts">
	/**
	 * O Anexo II na tela, antes de virar PDF.
	 *
	 * Mostra exatamente o que o documento vai imprimir — os dois blocos por
	 * categoria e o total geral — porque é a conferência que o Admin Geral faz
	 * antes de emitir. Os números vêm PRONTOS do servidor (`custoDoPlano`), a
	 * mesma chamada que o gerador do PDF usa: recalcular aqui abriria a porta
	 * para a tela dizer um total e o documento outro.
	 *
	 * As duas listas de problema têm pesos diferentes e por isso aparecem
	 * separadas:
	 *
	 * - **pendências** impedem a emissão (servidor sem classe em equipe COM
	 *   custo). É bloqueio, e o botão do PDF fica desabilitado;
	 * - **avisos** não impedem nada hoje (o mesmo problema em equipe SEM custo),
	 *   mas impediriam no instante em que a equipe mudasse de tipo de custo. É
	 *   "corrija agora, ainda dá tempo".
	 */
	import { formatarBRL } from '$lib/planos/rotulos';
	import { ROTULO_CATEGORIA } from '$lib/planos/faixa-custo';
	import { TITULO_DRO, TITULO_DIARIAS } from '$lib/planos/rotulos';
	import type { CustoPlano } from '$lib/planos/custo';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Info from '@lucide/svelte/icons/info';

	const {
		custo,
		versaoValores
	}: {
		custo: CustoPlano;
		/** A versão de valores aplicada — o que torna o total auditável. */
		versaoValores: { id: number; vigente_desde: string } | null;
	} = $props();
</script>

<!-- Quadro estático (ver `card-quadro` em app.css): o mesmo contorno das
     equipes, sem o `hover:shadow-md` — este painel não abre nada. -->
<section class="card-quadro rounded-2xl p-5 space-y-4">
	<div>
		<h2 class="text-base font-semibold text-surface-900 dark:text-white">
			Anexo II — consolidado financeiro
		</h2>
		<p class="text-xs text-surface-600 dark:text-surface-400">
			É o que o documento imprime. Confira antes de emitir.
		</p>
	</div>

	{#if custo.pendencias.length > 0}
		<div
			class="rounded-xl border border-error-500/40 bg-error-500/10 p-3 space-y-1.5 text-sm text-error-700 dark:text-error-300"
		>
			<p class="flex gap-2 font-medium">
				<TriangleAlert class="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
				<span>
					{custo.pendencias.length}
					{custo.pendencias.length === 1 ? 'servidor impede' : 'servidores impedem'} a emissão
				</span>
			</p>
			<ul class="space-y-0.5 pl-6 text-xs">
				{#each custo.pendencias as p (p.policial_id)}
					<li><strong>{p.nome}</strong> ({p.equipe}) — {p.motivo}</li>
				{/each}
			</ul>
			<p class="pl-6 text-xs">
				Corrija a classe no cadastro do servidor e use <strong
					>Reaplicar cargo/classe do cadastro</strong
				> acima. O total abaixo está parcial.
			</p>
		</div>
	{/if}

	{#if custo.avisos.length > 0}
		<div
			class="rounded-xl border border-warning-500/30 bg-warning-500/10 p-3 space-y-1.5 text-sm text-warning-700 dark:text-warning-300"
		>
			<p class="flex gap-2 font-medium">
				<Info class="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
				<span>{custo.avisos.length} servidor(es) sem classe em equipe sem custo</span>
			</p>
			<ul class="space-y-0.5 pl-6 text-xs">
				{#each custo.avisos as a (a.policial_id)}
					<li><strong>{a.nome}</strong> ({a.equipe}) — {a.motivo}</li>
				{/each}
			</ul>
			<p class="pl-6 text-xs">
				Não bloqueia hoje. Mas se essa equipe passar a ter custo — a operação escorregar para um
				sábado, por exemplo —, passa a bloquear.
			</p>
		</div>
	{/if}

	<!-- ---- DRO ---- -->
	<div class="space-y-2">
		<h3
			class="text-xs font-semibold uppercase tracking-wide text-surface-700 dark:text-surface-200"
		>
			{TITULO_DRO}
		</h3>
		{#if custo.consolidado.dro.length === 0}
			<p class="text-xs text-surface-600 dark:text-surface-400">Nenhuma equipe em hora extra.</p>
		{:else}
			<div class="table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th>Categoria</th>
							<th class="text-right">Quantidade</th>
							<th class="text-right">Custo total</th>
						</tr>
					</thead>
					<tbody>
						{#each custo.consolidado.dro as l (l.categoria)}
							<tr>
								<td>{ROTULO_CATEGORIA[l.categoria]}</td>
								<td class="text-right">{l.quantidade}</td>
								<td class="text-right">{formatarBRL(l.total)}</td>
							</tr>
						{/each}
						<tr class="font-semibold">
							<td>TOTAL</td>
							<td class="text-right"
								>{custo.consolidado.dro.reduce((s, l) => s + l.quantidade, 0)}</td
							>
							<td class="text-right">{formatarBRL(custo.consolidado.droTotal)}</td>
						</tr>
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<!-- ---- Diárias ---- -->
	<div class="space-y-2">
		<h3
			class="text-xs font-semibold uppercase tracking-wide text-surface-700 dark:text-surface-200"
		>
			{TITULO_DIARIAS}
		</h3>
		{#if custo.consolidado.diarias.length === 0}
			<p class="text-xs text-surface-600 dark:text-surface-400">Nenhuma equipe em diária.</p>
		{:else}
			<div class="table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th>Categoria</th>
							<th class="text-right">Quantidade</th>
							<th class="text-right">Custo total</th>
						</tr>
					</thead>
					<tbody>
						{#each custo.consolidado.diarias as l (l.categoria)}
							<tr>
								<td>{ROTULO_CATEGORIA[l.categoria]}</td>
								<td class="text-right">{l.quantidade}</td>
								<td class="text-right">{formatarBRL(l.total)}</td>
							</tr>
						{/each}
						<tr class="font-semibold">
							<td>TOTAL</td>
							<td class="text-right"
								>{custo.consolidado.diarias.reduce((s, l) => s + l.quantidade, 0)}</td
							>
							<td class="text-right">{formatarBRL(custo.consolidado.diariasTotal)}</td>
						</tr>
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<div
		class="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-surface-200 dark:border-white/10 p-3"
	>
		<span class="text-sm font-semibold text-surface-800 dark:text-surface-100">TOTAL GERAL</span>
		<span class="text-lg font-bold text-surface-900 dark:text-white">
			{formatarBRL(custo.consolidado.totalGeral)}
		</span>
	</div>

	<p class="text-xs text-surface-600 dark:text-surface-400">
		* Valores estimados.
		{#if versaoValores}
			Tabela de valores #{versaoValores.id}, vigente desde {versaoValores.vigente_desde}.
		{:else}
			<strong class="text-warning-700 dark:text-warning-400"
				>Nenhuma tabela de valores gravada — os totais saem zerados.</strong
			>
		{/if}
	</p>
</section>
