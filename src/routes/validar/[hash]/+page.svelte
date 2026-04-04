<script lang="ts">
	import icon from '$lib/assets/logo.png';
	import { formatarData, mascararNome, mascararCPF, mascararIP, mascararCoordenada } from '$lib/utils';

	interface DocumentoComAuditoria {
		assinante_nome: string;
		assinante_cpf?: string;
		created_at: string;
		tipo: string;
		ip_address?: string;
		user_agent?: string;
		latitude?: number;
		longitude?: number;
	}

	let { data }: { data: any } = $props();
	const documento = $derived(data.documento as DocumentoComAuditoria);

	function formatarDataHora(dateStr: string | null) {
		if (!dateStr) return 'Não informada';
		// SQLite datetime('now') retorna "YYYY-MM-DD HH:MM:SS" sem indicador de fuso.
		// Adicionamos " UTC" para forçar a interpretação como UTC antes de converter.
		const d = new Date(dateStr.includes('T') ? dateStr : dateStr + ' UTC');
		return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
	}


	let baixando = $state(false);

	async function handleDownload() {
		if (baixando) return;
		baixando = true;
		console.log('[Download] Iniciando requisição para:', `/api/validar/${data.hash}/download`);
		
		try {
			const res = await fetch(`/api/validar/${data.hash}/download`);
			console.log('[Download] Resposta Recebida:', {
				status: res.status,
				statusText: res.statusText,
				headers: Object.fromEntries(res.headers.entries())
			});

			if (!res.ok) {
				const errorText = await res.text();
				console.error('[Download] Erro no corpo da resposta:', errorText);
				alert(`Erro ao carregar o arquivo (Status ${res.status}). Verifique o console (F12) para detalhes técnicos.`);
				baixando = false;
				return;
			}

			const contentType = res.headers.get('content-type');
			if (contentType && contentType.includes('application/json')) {
				const errJson = await res.json();
				console.error('[Download] Erro do Servidor:', errJson);
				alert(`Erro do Servidor: ${errJson.error || 'Erro desconhecido'}`);
				baixando = false;
				return;
			}

			const blob = await res.blob();
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `relatorio_${data.hash}.pdf`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			window.URL.revokeObjectURL(url);
		} catch (err) {
			console.error('[Download] Erro:', err);
			alert('Falha na comunicação com o servidor.');
		} finally {
			baixando = false;
		}
	}
</script>

<svelte:head>
	<title>Validação de Documento - Escalas PC-CE</title>
</svelte:head>

<div class="min-h-screen bg-surface-50 dark:bg-surface-900 flex flex-col items-center justify-center p-3 sm:p-4">
	<div class="card w-full max-w-2xl bg-white dark:bg-surface-800 shadow-xl border rounded-2xl sm:rounded-3xl overflow-hidden p-4 sm:p-8
		{data.encontrado
			? 'border-primary-500/20'
			: 'border-error-500/20'}">

		{#if data.encontrado}
			<!-- ✅ DOCUMENTO VÁLIDO -->
			<div class="flex flex-col items-center mb-6 sm:mb-10">
				<img src={icon} alt="Logo PC-CE" class="w-14 sm:w-20 mb-3 sm:mb-4 drop-shadow-md" />
				<div class="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-success-500/10 flex items-center justify-center mb-3 sm:mb-4">
					<svg class="w-7 h-7 sm:w-9 sm:h-9 text-success-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
					</svg>
				</div>
				<h1 class="text-xl sm:text-2xl font-black text-success-600 dark:text-success-400 uppercase tracking-tighter text-center">Autenticidade Confirmada</h1>
				<p class="text-surface-500 font-medium text-center text-sm sm:text-base mt-1">Este documento é autêntico e foi assinado digitalmente</p>
			</div>

			<div class="space-y-4 sm:space-y-6">
				<!-- Informações do Documento -->
				<section class="p-4 sm:p-6 bg-surface-100 dark:bg-surface-700/50 rounded-xl sm:rounded-2xl border border-surface-200 dark:border-white/5">
					<h2 class="text-[10px] font-bold text-surface-500 uppercase tracking-widest mb-3 sm:mb-4">Informações do Documento</h2>
					<div class="grid grid-cols-1 gap-3 sm:gap-6">
						<div>
							<span class="block text-[10px] uppercase font-bold text-surface-400">Título / Tipo</span>
							<span class="text-base sm:text-lg font-bold text-surface-800 dark:text-white leading-tight">{data.escala.titulo}</span>
						</div>
						<div>
							<span class="block text-[10px] uppercase font-bold text-surface-400">Unidade / Cidade</span>
							<span class="text-base sm:text-lg font-bold text-surface-800 dark:text-white leading-tight">{data.escala.lotacao} — {data.escala.cidade}</span>
						</div>
						<div>
							<span class="block text-[10px] uppercase font-bold text-surface-400">Período</span>
							<span class="text-base sm:text-lg font-bold text-surface-800 dark:text-white">
								{formatarData(data.escala.data_inicio)} a {formatarData(data.escala.data_fim)}
							</span>
						</div>
					</div>
				</section>

				<!-- Informações da Assinatura (Supervisor) -->
				<section class="p-4 sm:p-6 border-l-4 border-primary-500 bg-primary-50/30 dark:bg-primary-500/10 rounded-r-xl sm:rounded-r-2xl">
					<h2 class="text-[10px] font-bold text-primary-600 dark:text-primary-400 uppercase tracking-widest mb-3 sm:mb-4">Assinatura Certificadora (Supervisor)</h2>
					<div class="space-y-3 sm:space-y-4">
						<div class="flex items-start gap-3 sm:gap-4">
							<div class="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-500 shrink-0">
								<svg class="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
								</svg>
							</div>
							<div class="min-w-0">
								<span class="block text-[10px] uppercase font-bold text-surface-400">Assinado Digitalmente por</span>
								<span class="text-lg sm:text-xl font-black text-surface-900 dark:text-white uppercase leading-none break-words">{mascararNome(documento.assinante_nome)}</span>
								{#if documento.assinante_cpf}
									<span class="block text-xs text-surface-500 mt-1">CPF: {mascararCPF(documento.assinante_cpf)}</span>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
							<svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
							</svg>
							<span>Data e Hora: <strong>{formatarDataHora(documento.created_at)}</strong></span>
						</div>
					</div>
				</section>

				<!-- Assinaturas da Equipe (GISE) -->
				{#if data.membros && data.membros.length > 0}
					<section class="space-y-3">
						<h2 class="text-[10px] font-bold text-surface-500 uppercase tracking-widest px-1">Confirmações de Presença (Equipe)</h2>
						<div class="grid grid-cols-1 gap-3">
							{#each data.membros as membro}
								<div class="p-4 bg-surface-100 dark:bg-surface-700/50 rounded-xl sm:rounded-2xl border border-surface-200 dark:border-white/5">
									<div class="flex items-center gap-3 mb-3">
										<div class="w-8 h-8 rounded-full bg-primary-500/10 flex items-center justify-center text-primary-500 shrink-0">
											<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
											</svg>
										</div>
										<div class="min-w-0">
											<span class="block text-[10px] uppercase font-bold text-surface-400 leading-none mb-1">Assinado por</span>
											<span class="text-sm font-black text-surface-900 dark:text-white uppercase truncate block">{mascararNome(membro.policial_nome)}</span>
											<span class="text-[9px] font-bold text-surface-500 uppercase">{membro.policial_cargo} • {membro.policial_matricula}</span>
										</div>
									</div>
									
									<div class="grid grid-cols-2 gap-4 pt-3 border-t border-surface-200 dark:border-white/5">
										<div class="flex flex-col">
											<span class="text-[8px] uppercase font-black text-surface-400 mb-0.5">Entrada</span>
											{#if membro.presenca?.entrada_timestamp}
												<span class="text-[10px] font-bold text-success-600 dark:text-success-400">
													{formatarDataHora(membro.presenca.entrada_timestamp)}
												</span>
											{:else}
												<span class="text-[10px] italic text-surface-400">Pendente</span>
											{/if}
										</div>
										<div class="flex flex-col">
											<span class="text-[8px] uppercase font-black text-surface-400 mb-0.5">Saída</span>
											{#if membro.presenca?.saida_timestamp}
												<span class="text-[10px] font-bold text-success-600 dark:text-success-400">
													{formatarDataHora(membro.presenca.saida_timestamp)}
												</span>
											{:else}
												<span class="text-[10px] italic text-surface-400">Pendente</span>
											{/if}
										</div>
									</div>
								</div>
							{/each}
						</div>
					</section>
				{/if}

				<!-- Download do Documento -->
				<section class="p-4 sm:p-6 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-700/30 rounded-xl sm:rounded-2xl">
					<h2 class="text-[10px] font-bold text-primary-700 dark:text-primary-400 uppercase tracking-widest mb-2 sm:mb-3">Documento Original</h2>
					<p class="text-sm text-surface-700 dark:text-surface-300 mb-3 sm:mb-4">
						Faça o download do documento digital assinado e compare com o documento impresso que você possui.
						As informações devem ser idênticas.
					</p>
					<button
						onclick={handleDownload}
						disabled={baixando}
						class="flex items-center justify-center gap-2 w-full sm:w-auto sm:inline-flex px-5 py-3 bg-primary-600 hover:bg-primary-700 active:bg-primary-800 disabled:bg-surface-400 text-white font-bold rounded-xl transition-colors text-sm touch-manipulation"
					>
						{#if baixando}
							<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
							<span>PROCESSANDO...</span>
						{:else}
							<svg class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
							</svg>
							<span>Baixar Documento Assinado (PDF)</span>
						{/if}
					</button>
				</section>

				<!-- Instrução de Comparação -->
				<div class="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/30 rounded-xl sm:rounded-2xl">
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

			<footer class="mt-6 sm:mt-10 pt-4 sm:pt-6 border-t border-surface-200 dark:border-white/5 text-center">
				<p class="text-[10px] text-surface-400 uppercase font-black tracking-widest">Ponto de Preservação Digital - PC-CE</p>
				<p class="text-[9px] text-surface-400 mt-2 max-w-md mx-auto leading-relaxed">
					Esta conferência confirma que o arquivo digital carregado corresponde integralmente ao teor da escala
					gerenciada pelo sistema oficial em {formatarDataHora(data.documento.created_at)}.
				</p>
			</footer>

		{:else}
			<!-- ❌ DOCUMENTO NÃO ENCONTRADO / ERRO -->
			{@const erroInterno = data.motivo === 'erro_db' || data.motivo === 'erro_consulta'}

			<div class="flex flex-col items-center mb-6 sm:mb-10">
				<img src={icon} alt="Logo PC-CE" class="w-14 sm:w-20 mb-3 sm:mb-4 drop-shadow-md" />
				<div class="w-12 h-12 sm:w-16 sm:h-16 rounded-full {erroInterno ? 'bg-warning-500/10' : 'bg-error-500/10'} flex items-center justify-center mb-3 sm:mb-4">
					{#if erroInterno}
						<svg class="w-7 h-7 sm:w-9 sm:h-9 text-warning-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					{:else}
						<svg class="w-7 h-7 sm:w-9 sm:h-9 text-error-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
						</svg>
					{/if}
				</div>
				<h1 class="text-xl sm:text-2xl font-black {erroInterno ? 'text-warning-600 dark:text-warning-400' : 'text-error-600 dark:text-error-400'} uppercase tracking-tighter text-center">
					{erroInterno ? 'Erro ao Consultar' : 'Documento Não Encontrado'}
				</h1>
				<p class="text-surface-500 font-medium text-center mt-2 text-sm sm:text-base">
					{#if erroInterno}
						Ocorreu um erro interno ao consultar o sistema. Tente novamente em alguns instantes.
					{:else}
						O código de verificação informado não corresponde a nenhum documento registrado no sistema.
					{/if}
				</p>
			</div>

			<div class="p-4 sm:p-6 {erroInterno ? 'bg-warning-50 dark:bg-warning-900/20 border-warning-200 dark:border-warning-700/30' : 'bg-error-50 dark:bg-error-900/20 border-error-200 dark:border-error-700/30'} border rounded-xl sm:rounded-2xl text-center space-y-3">
				{#if erroInterno}
					<p class="text-sm text-warning-800 dark:text-warning-300">
						Não foi possível verificar a autenticidade neste momento. Por favor, tente novamente ou contate o suporte.
					</p>
				{:else}
					<p class="text-sm text-error-800 dark:text-error-300">
						Este documento pode ser <strong>falso ou adulterado</strong>. Não utilize este documento.
					</p>
					<p class="text-xs text-surface-500">
						Se você acredita que há um erro, entre em contato com a unidade que emitiu o documento.
					</p>
				{/if}
			</div>

			<footer class="mt-6 sm:mt-10 pt-4 sm:pt-6 border-t border-surface-200 dark:border-white/5 text-center">
				<p class="text-[10px] text-surface-400 uppercase font-black tracking-widest">Ponto de Preservação Digital - PC-CE</p>
			</footer>
		{/if}
	</div>

	<p class="mt-6 text-xs text-surface-500/50">SISTEMA GERENCIADOR DE ESCALAS © 2026</p>
</div>
