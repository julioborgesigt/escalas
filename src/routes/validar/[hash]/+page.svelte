<script lang="ts">
	import icon from '$lib/assets/logo.png';
	const { data } = $props();
	
	function formatarDataHora(dateStr: string | null) {
		if (!dateStr) return 'Não informada';
		const d = new Date(dateStr);
		return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
	}

	function formatarData(dateStr: string) {
		if (!dateStr) return '-';
		const [y, m, d] = dateStr.split('-');
		return `${d}/${m}/${y}`;
	}
</script>

<svelte:head>
	<title>Validação de Documento - Escalas PC-CE</title>
</svelte:head>

<div class="min-h-screen bg-surface-50 dark:bg-surface-900 flex flex-col items-center justify-center p-4">
	<div class="card p-8 w-full max-w-2xl bg-white dark:bg-surface-800 shadow-xl border border-primary-500/20 rounded-3xl overflow-hidden">
		
		<div class="flex flex-col items-center mb-10">
			<img src={icon} alt="Logo PC-CE" class="w-20 mb-4 drop-shadow-md" />
			<h1 class="text-2xl font-black text-primary-600 dark:text-primary-400 uppercase tracking-tighter">Autenticidade Confirmada</h1>
			<p class="text-surface-500 font-medium">Este documento é autêntico e foi assinado digitalmente</p>
		</div>

		<div class="space-y-8">
			<!-- Detalhes da Escala -->
			<section class="p-6 bg-surface-100 dark:bg-surface-700/50 rounded-2xl border border-surface-200 dark:border-white/5">
				<h2 class="text-xs font-bold text-surface-500 uppercase tracking-widest mb-4">Informações do Documento</h2>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
					<div>
						<span class="block text-[10px] uppercase font-bold text-surface-400">Título / Tipo</span>
						<span class="text-lg font-bold text-surface-800 dark:text-white leading-tight">{data.escala.titulo}</span>
					</div>
					<div>
						<span class="block text-[10px] uppercase font-bold text-surface-400">Unidade / Cidade</span>
						<span class="text-lg font-bold text-surface-800 dark:text-white leading-tight">{data.escala.lotacao} - {data.escala.cidade}</span>
					</div>
					<div>
						<span class="block text-[10px] uppercase font-bold text-surface-400">Período</span>
						<span class="text-lg font-bold text-surface-800 dark:text-white">
							{formatarData(data.escala.data_inicio)} a {formatarData(data.escala.data_fim)}
						</span>
					</div>
				</div>
			</section>

			<!-- Detalhes da Assinatura -->
			<section class="p-6 border-l-4 border-primary-500 bg-primary-50/30 dark:bg-primary-500/10 rounded-r-2xl">
				<h2 class="text-xs font-bold text-primary-600 dark:text-primary-400 uppercase tracking-widest mb-4">Informações da Assinatura</h2>
				<div class="space-y-4">
					<div class="flex items-start gap-4">
						<div class="w-10 h-10 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-500">
							<svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
						</div>
						<div>
							<span class="block text-[10px] uppercase font-bold text-surface-400">Assinado por</span>
							<span class="text-xl font-black text-surface-900 dark:text-white uppercase leading-none">{data.documento.assinante_nome}</span>
							{#if data.documento.assinante_cpf}
								<span class="block text-xs text-surface-500 mt-1">CPF: ***.{data.documento.assinante_cpf.slice(4,7)}.***-**</span>
							{/if}
						</div>
					</div>
					<div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
						<span>Data e Hora: <strong>{formatarDataHora(data.documento.created_at)}</strong></span>
					</div>
				</div>
			</section>
		</div>

		<footer class="mt-12 pt-8 border-t border-surface-200 dark:border-white/5 text-center">
			<p class="text-[10px] text-surface-400 uppercase font-black tracking-widest">Ponto de Preservação Digital - PC-CE</p>
			<p class="text-[9px] text-surface-400 mt-2 max-w-md mx-auto leading-relaxed">
				Esta conferência confirma que o arquivo digital carregado corresponde integralmente ao teor da escala gerenciada pelo sistema oficial em {formatarDataHora(data.documento.created_at)}.
			</p>
		</footer>
	</div>
	
	<p class="mt-8 text-xs text-surface-500/50">SISTEMA GERENCIADOR DE ESCALAS © 2026</p>
</div>
