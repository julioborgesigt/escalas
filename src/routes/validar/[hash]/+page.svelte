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
	<div class="card p-8 w-full max-w-2xl bg-white dark:bg-surface-800 shadow-xl border rounded-3xl overflow-hidden
		{data.encontrado
			? 'border-primary-500/20'
			: 'border-error-500/20'}">

		{#if data.encontrado}
			<!-- ✅ DOCUMENTO VÁLIDO -->
			<div class="flex flex-col items-center mb-10">
				<img src={icon} alt="Logo PC-CE" class="w-20 mb-4 drop-shadow-md" />
				<div class="w-16 h-16 rounded-full bg-success-500/10 flex items-center justify-center mb-4">
					<svg class="w-9 h-9 text-success-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
					</svg>
				</div>
				<h1 class="text-2xl font-black text-success-600 dark:text-success-400 uppercase tracking-tighter">Autenticidade Confirmada</h1>
				<p class="text-surface-500 font-medium text-center">Este documento é autêntico e foi assinado digitalmente</p>
			</div>

			<div class="space-y-6">
				<!-- Informações do Documento -->
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

				<!-- Informações da Assinatura -->
				<section class="p-6 border-l-4 border-primary-500 bg-primary-50/30 dark:bg-primary-500/10 rounded-r-2xl">
					<h2 class="text-xs font-bold text-primary-600 dark:text-primary-400 uppercase tracking-widest mb-4">Informações da Assinatura</h2>
					<div class="space-y-4">
						<div class="flex items-start gap-4">
							<div class="w-10 h-10 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-500 shrink-0">
								<svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
								</svg>
							</div>
							<div>
								<span class="block text-[10px] uppercase font-bold text-surface-400">Assinado por</span>
								<span class="text-xl font-black text-surface-900 dark:text-white uppercase leading-none">{data.documento.assinante_nome}</span>
								{#if data.documento.assinante_cpf}
									<span class="block text-xs text-surface-500 mt-1">CPF: ***.{data.documento.assinante_cpf.slice(4, 7)}.***-**</span>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
							<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
							</svg>
							<span>Data e Hora: <strong>{formatarDataHora(data.documento.created_at)}</strong></span>
						</div>
					</div>
				</section>

				<!-- Download do Documento -->
				<section class="p-6 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-700/30 rounded-2xl">
					<h2 class="text-xs font-bold text-primary-700 dark:text-primary-400 uppercase tracking-widest mb-3">Documento Original</h2>
					<p class="text-sm text-surface-700 dark:text-surface-300 mb-4">
						Faça o download do documento digital assinado e compare com o documento impresso que você possui.
						As informações devem ser idênticas.
					</p>
					<a
						href="/api/validar/{data.hash}/download"
						download
						class="inline-flex items-center gap-2 px-5 py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl transition-colors text-sm"
					>
						<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
						</svg>
						Baixar Documento Assinado (PDF)
					</a>
				</section>

				<!-- Instrução de Comparação -->
				<div class="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/30 rounded-2xl">
					<svg class="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<p class="text-sm text-amber-800 dark:text-amber-300">
						<strong>Como verificar:</strong> Baixe o documento digital acima e compare seu conteúdo com o documento impresso.
						Verifique se os nomes, períodos, datas e demais informações são idênticos.
						Qualquer divergência deve ser comunicada à unidade responsável.
					</p>
				</div>
			</div>

			<footer class="mt-10 pt-6 border-t border-surface-200 dark:border-white/5 text-center">
				<p class="text-[10px] text-surface-400 uppercase font-black tracking-widest">Ponto de Preservação Digital - PC-CE</p>
				<p class="text-[9px] text-surface-400 mt-2 max-w-md mx-auto leading-relaxed">
					Esta conferência confirma que o arquivo digital carregado corresponde integralmente ao teor da escala
					gerenciada pelo sistema oficial em {formatarDataHora(data.documento.created_at)}.
				</p>
			</footer>

		{:else}
			<!-- ❌ DOCUMENTO NÃO ENCONTRADO -->
			<div class="flex flex-col items-center mb-10">
				<img src={icon} alt="Logo PC-CE" class="w-20 mb-4 drop-shadow-md" />
				<div class="w-16 h-16 rounded-full bg-error-500/10 flex items-center justify-center mb-4">
					<svg class="w-9 h-9 text-error-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
					</svg>
				</div>
				<h1 class="text-2xl font-black text-error-600 dark:text-error-400 uppercase tracking-tighter">Documento Não Encontrado</h1>
				<p class="text-surface-500 font-medium text-center mt-2">
					O código de verificação informado não corresponde a nenhum documento registrado no sistema.
				</p>
			</div>

			<div class="p-6 bg-error-50 dark:bg-error-900/20 border border-error-200 dark:border-error-700/30 rounded-2xl text-center space-y-3">
				<p class="text-sm text-error-800 dark:text-error-300">
					Este documento pode ser <strong>falso ou adulterado</strong>. Não utilize este documento.
				</p>
				<p class="text-xs text-surface-500">
					Se você acredita que há um erro, entre em contato com a unidade que emitiu o documento.
				</p>
			</div>

			<footer class="mt-10 pt-6 border-t border-surface-200 dark:border-white/5 text-center">
				<p class="text-[10px] text-surface-400 uppercase font-black tracking-widest">Ponto de Preservação Digital - PC-CE</p>
			</footer>
		{/if}
	</div>

	<p class="mt-8 text-xs text-surface-500/50">SISTEMA GERENCIADOR DE ESCALAS © 2026</p>
</div>
