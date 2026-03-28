<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toaster } from '$lib/toast';
	import RelatorioProdutividade from './RelatorioProdutividade.svelte';
	import { page } from '$app/state';
	import SignaturePad from '$lib/components/SignaturePad.svelte';

	let { data } = $props();
	const isAdminGeral = data.usuario?.tipo === 'admin';

	let activeTab = $state('relatorios'); // relatorios | configurador
	let perguntas = $state<any[]>(data.modeloConteudo || []);
	let salvandoModelo = $state(false);

	let escalaSelecionada = $state<any>(null);
	let respostas = $state<any>({});
	let carregandoResposta = $state(false);
	let salvandoResposta = $state(false);
	let exibirRelatorio = $state(false);

	let capturandoRubrica = $state(false);
	let salvandoPresenca = $state(false);

	$effect(() => {
		perguntas = data.modeloConteudo || [];
	});

	function adicionarPergunta() {
		const id = Date.now();
		perguntas = [...perguntas, { 
			id, 
			texto: '', 
			tipo: 'texto', 
			obrigatoria: false,
			key: `extra_${id}`,
			filhos: []
		}];
	}

	function adicionarSubPergunta(pai: any) {
		const id = Date.now();
		pai.filhos = [...(pai.filhos || []), {
			id,
			texto: '',
			tipo: 'texto',
			obrigatoria: false,
			key: `extra_${id}`,
			filhos: []
		}];
		perguntas = [...perguntas]; // Trigger reactivity
	}

	function removerPergunta(id: number, lista = perguntas) {
		const idx = lista.findIndex(p => p.id === id);
		if (idx > -1) {
			lista.splice(idx, 1);
			perguntas = [...perguntas];
			return true;
		}
		for (const p of lista) {
			if (p.filhos && removerPergunta(id, p.filhos)) return true;
		}
		return false;
	}

	async function salvarModelo() {
		salvandoModelo = true;
		try {
			const res = await fetch('/api/gise/modelo', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ config: perguntas })
			});
			if (!res.ok) throw new Error('Erro ao salvar modelo');
			toaster.success({ title: 'Modelo salvo com sucesso' });
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvandoModelo = false;
		}
	}

	async function selecionarEscala(escala: any) {
		escalaSelecionada = escala;
		carregandoResposta = true;
		respostas = {};
		exibirRelatorio = isAdminGeral || !escala.equipeRespondida;
		try {
			const url = `/api/gise/${escala.id}/resposta?dia=${escala.dia}${escala.equipe_id ? `&equipeId=${escala.equipe_id}` : ''}`;
			const res = await fetch(url);
			if (res.ok) {
				respostas = await res.json();
			}
		} catch (e) {
			console.error(e);
		} finally {
			carregandoResposta = false;
		}
	}

	async function salvarResposta() {
		if (!escalaSelecionada) return;
		salvandoResposta = true;
		try {
			const res = await fetch(`/api/gise/${escalaSelecionada.id}/resposta`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ 
					respostas, 
					dia: escalaSelecionada.dia,
					equipeId: escalaSelecionada.equipe_id
				})
			});
			if (!res.ok) throw new Error('Erro ao salvar resposta');
			toaster.success({ title: 'Relatório salvo com sucesso' });
			if (!isAdminGeral) exibirRelatorio = false;
			await invalidateAll();
			const atualizada = data.minhasEscalas?.find((e: any) => e.id === escalaSelecionada.id && e.dia === escalaSelecionada.dia);
			if (atualizada) escalaSelecionada = atualizada;
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvandoResposta = false;
		}
	}

	function fmtDate(iso: string) {
		if (!iso) return '';
		const [y, m, d] = iso.split('-');
		return `${d}/${m}/${y}`;
	}

	function isHorarioLiberado(escala: any) {
		if (isAdminGeral) return true;
		if (!escala?.horarioPrevisto?.inicio) return true;
		const agora = new Date();
		const dataEscala = (escala.dia === 'sabado' ? escala.data_inicio : (escala.data_fim || escala.data_inicio));
		const [h, min] = escala.horarioPrevisto.inicio.split(':');
		const dataInicioPrevista = new Date(dataEscala + 'T' + h.padStart(2, '0') + ':' + (min || '00') + ':00');
		return agora >= dataInicioPrevista;
	}

	async function salvarEntrada(rubrica: string) {
		if (!escalaSelecionada) return;
		salvandoPresenca = true;
		try {
			const res = await fetch(`/api/gise/${escalaSelecionada.id}/presenca/entrada`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ dia: escalaSelecionada.dia, rubrica })
			});
			if (!res.ok) throw new Error('Erro ao salvar entrada');
			toaster.success({ title: 'Entrada confirmada com sucesso' });
			capturandoRubrica = false;
			await invalidateAll();
			const atualizada = data.minhasEscalas?.find((e: any) => e.id === escalaSelecionada.id && e.dia === escalaSelecionada.dia);
			if (atualizada) escalaSelecionada = atualizada;
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvandoPresenca = false;
		}
	}

	async function salvarSaida(rubrica: string) {
		if (!escalaSelecionada) return;
		salvandoPresenca = true;
		try {
			const res = await fetch(`/api/gise/${escalaSelecionada.id}/presenca/saida`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ dia: escalaSelecionada.dia, rubrica })
			});
			if (!res.ok) throw new Error('Erro ao salvar saída');
			toaster.success({ title: 'Saída confirmada com sucesso' });
			capturandoRubrica = false;
			await invalidateAll();
			const atualizada = data.minhasEscalas?.find((e: any) => e.id === escalaSelecionada.id && e.dia === escalaSelecionada.dia);
			if (atualizada) escalaSelecionada = atualizada;
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvandoPresenca = false;
		}
	}
</script>

<div class="space-y-6">
	<header class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
		<div>
			<h1 class="text-4xl font-black text-surface-900 dark:text-surface-50 uppercase tracking-tighter">Relatórios GISE</h1>
			<p class="text-surface-500 font-medium">Gestão de produtividade e relatórios operacionais</p>
		</div>

		{#if isAdminGeral}
			<div class="bg-surface-100 dark:bg-surface-800 p-1.5 rounded-2xl flex gap-1 shadow-inner">
				<button 
					class="px-6 py-2.5 rounded-xl text-sm font-bold transition-all {activeTab === 'relatorios' ? 'bg-white dark:bg-surface-700 shadow-md text-primary-600' : 'text-surface-500 hover:text-surface-700'}"
					onclick={() => activeTab = 'relatorios'}
				>
					Relatórios
				</button>
				<button 
					class="px-6 py-2.5 rounded-xl text-sm font-bold transition-all {activeTab === 'configurador' ? 'bg-white dark:bg-surface-700 shadow-md text-primary-600' : 'text-surface-500 hover:text-surface-700'}"
					onclick={() => activeTab = 'configurador'}
				>
					Configurar Form
				</button>
			</div>
		{/if}
	</header>

	{#if isAdminGeral && activeTab === 'configurador'}
		<section class="card p-8 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-xl space-y-8 animate-in fade-in zoom-in-95 duration-500">
			<div class="flex items-center justify-between border-b border-surface-200 dark:border-surface-800 pb-6">
				<div>
					<h2 class="text-2xl font-black uppercase tracking-tight">Configurar Formulário</h2>
					<p class="text-sm text-surface-500 mt-1">Defina os textos e campos do relatório de produtividade oficial.</p>
				</div>
				<div class="flex items-center gap-3">
					<button class="btn preset-outlined-surface-500 px-4 py-2 rounded-xl text-xs font-bold" onclick={() => {
						if (confirm('Deseja restaurar o modelo oficial de 19 pontos? Isso substituirá as perguntas atuais.')) {
							perguntas = JSON.parse(JSON.stringify(data.modeloPadrao));
						}
					}} title="Restaurar Modelo Oficial">
						Restaurar 19 Pontos
					</button>
					<button class="btn preset-filled-primary-500 px-6 py-2 rounded-xl font-bold flex items-center gap-2 transition-transform hover:scale-105 active:scale-95 shadow-lg shadow-primary-500/30" onclick={adicionarPergunta} title="Adicionar Nova Pergunta">
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" /></svg>
						Nova Pergunta
					</button>
				</div>
			</div>
			
			<div class="grid grid-cols-1 gap-4 max-h-[70vh] overflow-y-auto pr-4 custom-scrollbar">
				{#snippet renderItem(p: any, level = 0)}
					<div class="group p-5 bg-surface-50 dark:bg-surface-950/40 rounded-2xl border border-surface-200 dark:border-surface-800 transition-all hover:border-primary-500/50 hover:shadow-lg" style="margin-left: {level * 2}rem">
						<div class="flex flex-col md:flex-row gap-5 items-start">
							<div class="w-8 h-8 flex items-center justify-center rounded-lg bg-surface-200 dark:bg-surface-800 text-[0.6rem] font-black text-surface-500 shrink-0">
								{#if level > 0}↳{:else}{perguntas.indexOf(p) + 1}{/if}
							</div>

							<div class="flex-1 w-full space-y-1.5">
								<div class="flex items-center justify-between">
									<label for="p-txt-{p.id}" class="text-[0.65rem] font-black text-surface-400 uppercase tracking-widest">Texto da Pergunta</label>
									<div class="flex items-center gap-2">
										{#if p.key?.startsWith('extra_')}
											<span class="badge preset-filled-secondary-500 text-[0.55rem] font-black uppercase">CAMPO ADICIONAL</span>
										{:else}
											<span class="badge bg-surface-200 dark:bg-surface-800 text-surface-600 text-[0.55rem] font-black uppercase">CAMPO SISTEMA</span>
										{/if}
									</div>
								</div>
								<textarea 
									id="p-txt-{p.id}"
									bind:value={p.texto} 
									placeholder="Ex: Qual foi a produtividade de..." 
									rows="2"
									class="w-full px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-sm font-medium focus:ring-2 focus:ring-primary-500 transition-all resize-none"
								></textarea>

								<!-- Rótulos Extras para Tipos Sistêmicos (Mantidos para compatibilidade mas agora customizáveis via filhos se fosse o caso) -->
								{#if p.tipo === 'mandados_maiores' || p.tipo === 'apreensoes_menores'}
									<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 p-3 bg-surface-100/50 dark:bg-surface-800/30 rounded-xl border border-dashed border-surface-300">
										<div class="space-y-1">
											<label for="subqtd-{p.id}" class="text-[0.6rem] font-bold text-surface-400 uppercase tracking-wider">Legenda Quantidade (ex: 5.1)</label>
											<input id="subqtd-{p.id}" type="text" bind:value={p.subtexto_qtd} class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold" />
										</div>
										<div class="space-y-1">
											<label for="sublst-{p.id}" class="text-[0.6rem] font-bold text-surface-400 uppercase tracking-wider">Legenda Lista (ex: 5.2)</label>
											<input id="sublst-{p.id}" type="text" bind:value={p.subtexto_lista} class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold" />
										</div>
									</div>
								{/if}
							</div>
							
							<div class="w-full md:w-56 space-y-1.5 shrink-0">
								<label for="p-tp-{p.id}" class="text-[0.65rem] font-black text-surface-400 uppercase tracking-widest">Tipo do Campo</label>
								<select 
									id="p-tp-{p.id}"
									bind:value={p.tipo} 
									class="w-full px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-sm font-bold focus:ring-2 focus:ring-primary-500 transition-all shadow-sm"
								>
									<optgroup label="Campos Básicos">
										<option value="texto">Texto Curto</option>
										<option value="textarea">Texto Longo</option>
										<option value="numero">Número</option>
										<option value="sim_nao">Sim / Não (Condicional)</option>
										<option value="select_99">Quantitativo (0-99)</option>
									</optgroup>
									<optgroup label="Campos Inteligentes (Sistemáticos)">
										<option value="vtr_placa">VTR e Placa (Inteligente)</option>
										<option value="mandados_maiores">Mandados Maiores (Auto-Listagem)</option>
										<option value="apreensoes_menores">Apreensões Menores (Auto-Listagem)</option>
										<option value="drogas_complex">Drogas Detalhado (Auto-Listagem)</option>
									</optgroup>
								</select>
							</div>

							<div class="flex gap-2 shrink-0">
								{#if p.tipo === 'sim_nao' || p.tipo === 'mandados_maiores' || p.tipo === 'apreensoes_menores' || p.tipo === 'drogas_complex'}
									<button class="p-3 text-primary-500 hover:bg-primary-500/10 rounded-xl transition-all" onclick={() => adicionarSubPergunta(p)} title="Adicionar Sub-pergunta (se SIM)">
										<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
									</button>
								{/if}
								<button class="p-3 text-error-500 hover:bg-error-500/10 rounded-xl transition-all" onclick={() => removerPergunta(p.id)} aria-label="Remover Pergunta">
									<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
								</button>
							</div>
						</div>

						<!-- Novos controles de sub-textos para QUALQUER pergunta que use os tipos inteligentes -->
						{#if ['mandados_maiores', 'apreensoes_menores', 'drogas_complex'].includes(p.tipo)}
							<div class="mt-4 p-4 bg-primary-500/5 dark:bg-primary-500/10 rounded-2xl border border-dashed border-primary-500/30 space-y-4">
								<div class="flex items-center gap-2 mb-2">
									<svg class="w-4 h-4 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
									<span class="text-[0.65rem] font-black text-primary-600 dark:text-primary-400 uppercase tracking-widest">Personalizar Rótulos do Campo Inteligente</span>
								</div>
								
								<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
									{#if p.tipo === 'mandados_maiores' || p.tipo === 'apreensoes_menores'}
										<div class="space-y-1">
											<label for="subqtd-{p.id}" class="text-[0.6rem] font-bold text-surface-400 uppercase">Quantidade:</label>
											<input id="subqtd-{p.id}" type="text" bind:value={p.subtexto_qtd} placeholder="Ex: 5.1 QUANTIDADE:" class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold" />
										</div>
										<div class="space-y-1">
											<label for="sublst-{p.id}" class="text-[0.6rem] font-bold text-surface-400 uppercase">Lista:</label>
											<input id="sublst-{p.id}" type="text" bind:value={p.subtexto_lista} placeholder="Ex: 5.2 INFORMAR NOMES:" class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold" />
										</div>
									{:else if p.tipo === 'drogas_complex'}
										<div class="space-y-1">
											<label for="subtp-{p.id}" class="text-[0.6rem] font-bold text-surface-400 uppercase">Lista de Tipos:</label>
											<input id="subtp-{p.id}" type="text" bind:value={p.subtexto_tipo} placeholder="Ex: 10.1 TIPO DE DROGA:" class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold" />
										</div>
										<div class="space-y-1">
											<label for="subdet-{p.id}" class="text-[0.6rem] font-bold text-surface-400 uppercase">Detalhamento Pesos:</label>
											<input id="subdet-{p.id}" type="text" bind:value={p.subtexto_detalhe} placeholder="Ex: 10.1.1 PESOS:" class="w-full px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 text-xs font-bold" />
										</div>
									{/if}
								</div>
							</div>
						{/if}

						{#if p.filhos && p.filhos.length > 0}
							<div class="mt-4 space-y-4 border-l-2 border-primary-500/20 pl-4 py-2">
								<div class="text-[0.6rem] font-bold text-primary-600 uppercase mb-2">Perguntas carregadas se a resposta for "SIM":</div>
								{#each p.filhos as filho (filho.id)}
									{@render renderItem(filho, level + 1)}
								{/each}
							</div>
						{/if}
					</div>
				{/snippet}

				{#each perguntas as p (p.id)}
					{@render renderItem(p)}
				{/each}
			</div>

			<div class="flex justify-end pt-6 border-t border-surface-200 dark:border-surface-800">
				<button class="btn preset-filled-primary-500 px-12 py-4 rounded-2xl font-black text-xl shadow-xl shadow-primary-500/30 transition-all hover:scale-105 active:scale-95" onclick={salvarModelo} disabled={salvandoModelo}>
					{salvandoModelo ? 'Salvando...' : 'Publicar Alterações'}
				</button>
			</div>
		</section>
	{:else if isAdminGeral && activeTab === 'relatorios'}
		<div class="grid grid-cols-1 md:grid-cols-4 gap-6">
			<div class="md:col-span-1 space-y-4">
				<div class="flex items-center justify-between px-2">
					<h2 class="text-sm font-bold uppercase tracking-widest text-surface-500">Escalas Ativas</h2>
					<span class="badge preset-filled-primary-500 text-[0.6rem]">{data.listaAdmin.length}</span>
				</div>
				
				<div class="space-y-2 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
					{#each data.listaAdmin as escala}
						<button 
							class="w-full text-left p-3 rounded-2xl border transition-all {escalaSelecionada?.equipe_id === escala.equipe_id && escalaSelecionada?.dia === escala.dia && escalaSelecionada?.id === escala.id ? 'border-primary-500 bg-primary-500/10 ring-1 ring-primary-500' : 'border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 hover:border-surface-300'}"
							onclick={() => selecionarEscala(escala)}
						>
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0">
									<p class="text-xs font-bold text-surface-900 dark:text-surface-100 truncate">{escala.seccional_nome}</p>
									<p class="text-[0.6rem] text-surface-500 mt-0.5">{fmtDate(escala.data_inicio)}</p>
								</div>
								<div class="flex flex-col items-end gap-1">
									<span class="text-[0.55rem] px-1.5 py-0.5 rounded font-black uppercase {escala.dia === 'sabado' ? 'bg-secondary-500/20 text-secondary-700' : 'bg-tertiary-500/20 text-tertiary-700'}">{escala.dia.slice(0,3)}</span>
									<span class="text-[0.55rem] px-1.5 py-0.5 rounded font-black uppercase {escala.equipe_tipo === 'operacional' ? 'bg-primary-500/20 text-primary-700' : 'bg-surface-500/20 text-surface-700'}">{escala.equipe_tipo}</span>
								</div>
							</div>
							
							<div class="mt-2 flex items-center gap-1.5">
								<div class="w-1.5 h-1.5 rounded-full {escala.equipeRespondida ? 'bg-success-500' : 'bg-warning-500'}"></div>
								<p class="text-[0.6rem] font-bold {escala.equipeRespondida ? 'text-success-600' : 'text-warning-600'} uppercase">
									{escala.equipeRespondida ? 'Relatório Pronto' : 'Pendente'}
								</p>
							</div>
						</button>
					{:else}
						<div class="p-8 text-center border-2 border-dashed border-surface-200 dark:border-surface-800 rounded-3xl">
							<p class="text-xs text-surface-500 italic">Nenhum relatório encontrado no período.</p>
						</div>
					{/each}
				</div>
			</div>

			<div class="md:col-span-3">
				{#if escalaSelecionada}
					<section class="card p-6 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm space-y-6">
						<div class="flex items-center justify-between border-b border-surface-200 dark:border-surface-800 pb-4">
							<div>
								<h2 class="text-xl font-black text-surface-900 dark:text-surface-50 uppercase tracking-tight">
									{escalaSelecionada.seccional_nome}
								</h2>
								<div class="flex items-center gap-2 mt-1">
									<span class="badge preset-filled-primary-500 text-[0.6rem]">{escalaSelecionada.equipe_tipo}</span>
									<span class="text-xs text-surface-500 font-medium">{escalaSelecionada.dia} — {fmtDate(escalaSelecionada.data_inicio)}</span>
								</div>
							</div>
						</div>

						{#if carregandoResposta}
							<div class="flex flex-col items-center justify-center py-24 gap-4">
								<span class="loading loading-spinner loading-lg text-primary-500"></span>
								<p class="text-sm font-bold text-surface-500 animate-pulse">CARREGANDO DADOS...</p>
							</div>
						{:else}
							<div class="space-y-6">
								<div class="p-4 bg-primary-500/5 border border-primary-500/10 rounded-2xl flex items-center gap-3">
									<div class="bg-primary-500/20 p-2 rounded-lg">
										<svg class="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
									</div>
									<p class="text-[0.65rem] md:text-xs font-medium text-primary-700 dark:text-primary-400 leading-relaxed">
										<strong>Modo Administrador:</strong> Você está visualizando o formulário de produtividade. Todas as alterações feitas aqui serão refletidas nos relatórios finais da seccional.
									</p>
								</div>

								<RelatorioProdutividade bind:respostas modelo={data.modeloConteudo} />

								<div class="flex justify-end pt-4 border-t border-surface-200 dark:border-surface-800">
									<button class="btn preset-filled-primary-500 px-12 py-3 rounded-2xl font-bold text-lg shadow-xl shadow-primary-500/20 transition-all hover:scale-105 active:scale-95" onclick={salvarResposta} disabled={salvandoResposta}>
										{salvandoResposta ? 'Salvando...' : 'Salvar Alterações'}
									</button>
								</div>
							</div>
						{/if}
					</section>
				{:else}
					<div class="h-[60vh] flex flex-col items-center justify-center text-center p-12 bg-surface-100/30 dark:bg-surface-900/10 border-2 border-dashed border-surface-200 dark:border-surface-800 rounded-3xl">
						<div class="bg-surface-200 dark:bg-surface-800 p-6 rounded-full mb-6">
							<svg class="w-12 h-12 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
						</div>
						<h3 class="text-xl font-bold text-surface-900 dark:text-surface-50 mb-2">Selecione um Relatório</h3>
						<p class="text-sm text-surface-500 max-w-xs">Escolha uma escala e equipe na lista lateral para visualizar ou editar os dados de produtividade.</p>
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
			<!-- Lista de Escalas -->
			<div class="md:col-span-1 space-y-4">
				<h2 class="text-lg font-bold px-2">Minhas Escalas GISE</h2>
				{#each data.minhasEscalas as escala}
					<button 
						class="w-full text-left p-4 rounded-2xl border transition-all {escalaSelecionada?.id === escala.id && escalaSelecionada?.dia === escala.dia ? 'border-primary-500 bg-primary-500/10' : 'border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900 hover:border-primary-500/50'}"
						onclick={() => selecionarEscala(escala)}
					>
						<div class="flex items-center justify-between">
							<p class="text-sm font-bold text-surface-900 dark:text-surface-100">{fmtDate(escala.data_inicio)} - {fmtDate(escala.data_fim)}</p>
							<span class="badge {escala.dia === 'sabado' ? 'preset-filled-secondary-500' : 'preset-filled-tertiary-500'} text-[0.6rem] uppercase font-bold">{escala.dia}</span>
						</div>
						<div class="flex items-center justify-between mt-1">
							<p class="text-xs uppercase tracking-wider {escala.assinada ? 'text-success-500 font-bold' : 'text-surface-500'}">
								{escala.assinada ? 'ASSINADA' : 'EM ABERTO'}
							</p>
						</div>
					</button>
				{:else}
					<p class="text-sm text-surface-500 italic px-2">Nenhuma escala gise encontrada para o seu perfil.</p>
				{/each}
			</div>

			<!-- Formulário de Resposta -->
			<div class="md:col-span-2">
				{#if escalaSelecionada}
					<section class="card p-6 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm space-y-6">
						<div class="border-b border-surface-200 dark:border-surface-800 pb-4">
							<h2 class="text-xl font-bold">Relatório de Serviço - <span class="text-primary-500 uppercase">{escalaSelecionada.dia}</span></h2>
							<p class="text-xs text-primary-500 font-medium">Período: {fmtDate(escalaSelecionada.data_inicio)} a {fmtDate(escalaSelecionada.data_fim)}</p>
						</div>

						<!-- Stepper Visual -->
						<div class="flex items-center justify-between px-4 mb-4">
							<div class="flex flex-col items-center gap-1 group">
								<div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold {escalaSelecionada.presenca?.entrada_timestamp ? 'bg-success-500 text-white' : 'bg-primary-500 text-white shadow-lg shadow-primary-500/30'}">
									{#if escalaSelecionada.presenca?.entrada_timestamp}✓{:else}1{/if}
								</div>
								<span class="text-[0.6rem] font-bold uppercase tracking-wider {escalaSelecionada.presenca?.entrada_timestamp ? 'text-success-600' : 'text-primary-500'}">Entrada</span>
							</div>
							<div class="flex-1 h-px bg-surface-200 dark:border-surface-800 mx-2 -mt-4"></div>
							<div class="flex flex-col items-center gap-1">
								<div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold {escalaSelecionada.equipeRespondida ? 'bg-success-500 text-white' : escalaSelecionada.presenca?.entrada_timestamp ? 'bg-primary-500 text-white' : 'bg-surface-200 text-surface-400'}">
									{#if escalaSelecionada.equipeRespondida}✓{:else}2{/if}
								</div>
								<span class="text-[0.6rem] font-bold uppercase tracking-wider {escalaSelecionada.equipeRespondida ? 'text-success-600' : 'text-surface-400'}">Produtividade</span>
							</div>
							<div class="flex-1 h-px bg-surface-200 dark:border-surface-800 mx-2 -mt-4"></div>
							<div class="flex flex-col items-center gap-1">
								<div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold {escalaSelecionada.presenca?.saida_timestamp ? 'bg-success-500 text-white' : escalaSelecionada.equipeRespondida ? 'bg-primary-500 text-white' : 'bg-surface-200 text-surface-400'}">
									{#if escalaSelecionada.presenca?.saida_timestamp}✓{:else}3{/if}
								</div>
								<span class="text-[0.6rem] font-bold uppercase tracking-wider {escalaSelecionada.presenca?.saida_timestamp ? 'text-success-600' : 'text-surface-400'}">Saída</span>
							</div>
						</div>

						{#if !isHorarioLiberado(escalaSelecionada)}
							<div class="p-8 text-center space-y-4">
								<div class="bg-primary-500/10 p-4 rounded-full w-16 h-16 mx-auto flex items-center justify-center">
									<svg class="w-8 h-8 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
								</div>
								<div>
									<h3 class="font-bold text-lg">Horário não atingido</h3>
									<p class="text-sm text-surface-500">O registro de entrada estará disponível às <span class="font-bold text-primary-500">{escalaSelecionada.horarioPrevisto.inicio}</span>.</p>
								</div>
							</div>
						{:else if !escalaSelecionada.presenca?.entrada_timestamp}
							<div class="p-8 text-center space-y-6">
								<div>
									<h3 class="font-bold text-xl uppercase">Confirmação de Entrada</h3>
									<p class="text-sm text-surface-500 mt-2">Confirme sua entrada no serviço com uma rubrica para liberar o formulário de produtividade.</p>
								</div>

								{#if capturandoRubrica}
									<div class="space-y-4">
										<div class="bg-surface-50 dark:bg-surface-950 p-4 rounded-3xl border border-surface-200 dark:border-surface-800">
											<p class="text-xs font-bold text-surface-500 uppercase mb-2">Assine na área abaixo:</p>
											<SignaturePad onConfirm={salvarEntrada} onCancel={() => capturandoRubrica = false} />
										</div>
									</div>
								{:else}
									<button class="btn preset-filled-primary-500 px-12 py-4 rounded-2xl font-bold text-lg shadow-xl shadow-primary-500/20" onclick={() => (capturandoRubrica = true)}>
										Assinar Entrada
									</button>
								{/if}
							</div>
						{:else}
							<!-- Fluxo Pós-Entrada -->
							<div class="space-y-8">
								<!-- Entrada Info -->
								<div class="flex items-center justify-between p-4 bg-success-500/10 border border-success-500/20 rounded-2xl">
									<div class="flex items-center gap-3">
										<div class="bg-success-500 p-2 rounded-full">
											<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
										</div>
										<div>
											<p class="text-xs font-bold text-success-700 dark:text-success-400 uppercase">Entrada Confirmada</p>
											<p class="text-[0.65rem] text-success-600 dark:text-success-500">{new Date(escalaSelecionada.presenca.entrada_timestamp).toLocaleString('pt-BR')}</p>
										</div>
									</div>
								</div>

								<!-- Formulário de Resultados -->
								<div class="space-y-4 pt-4 border-t border-surface-200 dark:border-surface-800">
									<div class="flex items-center justify-between">
										<h3 class="font-bold uppercase text-sm tracking-wider">Resultados do Serviço</h3>
										{#if escalaSelecionada.equipeRespondida}
											<span class="badge preset-filled-success-500 text-[0.6rem] uppercase">Já enviado</span>
										{/if}
									</div>

									{#if carregandoResposta}
										<div class="flex justify-center py-12">
											<span class="loading loading-spinner loading-lg text-primary-500"></span>
										</div>
									{:else}
										<div class="space-y-5">
											{#if escalaSelecionada.equipeRespondida && !exibirRelatorio}
												<div class="p-6 bg-success-500/5 border border-success-500/20 rounded-3xl text-center space-y-4 animate-in fade-in zoom-in-95 duration-500">
													<div class="bg-success-500/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
														<svg class="w-8 h-8 text-success-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
													</div>
													<div>
														<p class="font-bold text-success-700 dark:text-success-400">Relatório Entregue</p>
														<p class="text-xs text-success-600 dark:text-success-500">Os dados de produtividade foram registrados com sucesso.</p>
													</div>
													<button class="btn preset-outlined-primary-500 rounded-xl text-xs font-bold uppercase py-2" onclick={() => (exibirRelatorio = true)}>
														Atualizar / Retificar Dados
													</button>
												</div>
											{:else}
												{#if escalaSelecionada.equipeRespondida && !Object.keys(respostas).length}
													<div class="p-3 bg-primary-500/5 border border-primary-500/10 rounded-xl">
														<p class="text-[0.65rem] text-primary-600 dark:text-primary-400 italic">Um integrante da equipe já respondeu. Você pode visualizar ou retificar os dados abaixo.</p>
													</div>
												{/if}

												<div class="animate-in fade-in slide-in-from-top-4 duration-500">
													<RelatorioProdutividade bind:respostas modelo={data.modeloConteudo} />
												</div>

												<div class="flex gap-3">
													{#if escalaSelecionada.equipeRespondida}
														<button class="btn preset-tonal-surface rounded-2xl px-6 font-bold" onclick={() => (exibirRelatorio = false)}>
															Cancelar
														</button>
													{/if}
													<button class="btn preset-filled-primary-500 flex-1 py-4 rounded-2xl font-bold text-lg shadow-xl shadow-primary-500/20" onclick={salvarResposta} disabled={salvandoResposta}>
														{salvandoResposta ? 'Processando...' : escalaSelecionada.equipeRespondida ? 'Salvar Alterações' : 'Finalizar Entrega do Relatório'}
													</button>
												</div>
											{/if}
										</div>
									{/if}
								</div>

								<!-- Saída -->
								<div class="space-y-4 pt-4 border-t border-surface-200 dark:border-surface-800">
									<h3 class="font-bold uppercase text-sm tracking-wider">Término do Plantão</h3>
									
									{#if !escalaSelecionada.presenca?.saida_timestamp}
										{#if !escalaSelecionada.equipeRespondida}
											<div class="p-3 bg-warning-500/10 border border-warning-500/20 rounded-xl flex items-start gap-3">
												<svg class="w-4 h-4 text-warning-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
												<p class="text-[0.65rem] text-warning-700 dark:text-warning-400">Você deve preencher e enviar o <strong>Relatório de Produtividade</strong> (resultados do serviço) antes de confirmar a saída.</p>
											</div>
											<button class="btn preset-tonal-surface w-full py-4 rounded-2xl font-bold text-lg cursor-not-allowed opacity-50" disabled>
												Confirmar Saída
											</button>
										{:else if capturandoRubrica}
											<div class="bg-surface-50 dark:bg-surface-950 p-4 rounded-3xl border border-surface-200 dark:border-surface-800">
												<p class="text-xs font-bold text-surface-500 uppercase mb-2">Assine para confirmar saída:</p>
												<SignaturePad onConfirm={salvarSaida} onCancel={() => (capturandoRubrica = false)} />
											</div>
										{:else}
											<button class="btn preset-outlined-primary-500 w-full py-4 rounded-2xl font-bold text-lg" onclick={() => (capturandoRubrica = true)}>
												Confirmar Saída (Fim da Jornada)
											</button>
										{/if}
									{:else}
										<div class="flex items-center gap-3 p-4 bg-surface-500/10 border border-surface-500/20 rounded-2xl">
											<div class="bg-surface-500 p-2 rounded-full">
												<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
											</div>
											<div>
												<p class="text-xs font-bold text-surface-700 dark:text-surface-400 uppercase">Saída Confirmada</p>
												<p class="text-[0.65rem] text-surface-600 dark:text-surface-500">{new Date(escalaSelecionada.presenca.saida_timestamp).toLocaleString('pt-BR')}</p>
											</div>
										</div>
									{/if}
								</div>

								<div class="pt-6">
									<button class="btn btn-sm text-surface-500 hover:text-primary-500 transition-colors w-full" onclick={() => (escalaSelecionada = null)}>
										← Voltar para lista de escalas
									</button>
								</div>
							</div>
						{/if}
					</section>
				{:else}
					<div class="h-full flex flex-col items-center justify-center text-center p-12 bg-surface-100/30 dark:bg-surface-900/10 border-2 border-dashed border-surface-200 dark:border-surface-800 rounded-3xl">
						<div class="bg-surface-200 dark:bg-surface-800 p-4 rounded-full mb-4">
							<svg class="w-8 h-8 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
						</div>
						<p class="text-surface-500">Selecione uma escala à esquerda para preencher o formulário de resultados.</p>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
