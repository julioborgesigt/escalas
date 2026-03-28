<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toaster } from '$lib/toast';
	import { page } from '$app/state';
	import SignaturePad from '$lib/components/SignaturePad.svelte';

	let { data } = $props();

	const usuario = $derived(page.data.usuario);
	const isAdminGeral = $derived(usuario?.tipo === 'admin');
	
	// --- Estado Admin: Modelo do Questionário ---
	let perguntas = $state<any[]>([]);
	let salvandoModelo = $state(false);

	$effect(() => {
		perguntas = data.modeloConteudo || [];
	});

	function adicionarPergunta() {
		perguntas = [...perguntas, { id: Date.now(), texto: '', tipo: 'texto', obrigatoria: true }];
	}

	function removerPergunta(id: number) {
		perguntas = perguntas.filter(p => p.id !== id);
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

	// --- Estado Policial: Responder ---
	let escalaSelecionada = $state<any>(null);
	let respostas = $state<Record<number, string>>({});
	let carregandoResposta = $state(false);
	let salvandoResposta = $state(false);

	async function selecionarEscala(escala: any) {
		escalaSelecionada = escala;
		carregandoResposta = true;
		respostas = {};
		try {
			const res = await fetch(`/api/gise/${escala.id}/resposta?dia=${escala.dia}`);
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
				body: JSON.stringify({ respostas, dia: escalaSelecionada.dia })
			});
			if (!res.ok) throw new Error('Erro ao salvar resposta');
			toaster.success({ title: 'Resultado enviado com sucesso' });
			escalaSelecionada = null;
			await invalidateAll();
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvandoResposta = false;
		}
	}

	function fmtDate(iso: string) {
		const [y, m, d] = iso.split('-');
		return `${d}/${m}/${y}`;
	}

	// --- Lógica de Horário ---
	function isHorarioLiberado(escala: any) {
		if (isAdminGeral) return true;
		const agora = new Date();
		const dataEscala = escala.dia === 'sabado' ? escala.data_inicio : escala.data_fim;
		const [h, min] = escala.horarioPrevisto.inicio.split(':');
		const dataInicioPrevista = new Date(dataEscala + 'T' + h.padStart(2, '0') + ':' + (min || '00') + ':00');
		
		return agora >= dataInicioPrevista;
	}

	let capturandoRubrica = $state(false);
	let salvandoPresenca = $state(false);

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
			// Re-seleciona para atualizar estado
			const atualizada = data.minhasEscalas.find((e: any) => e.id === escalaSelecionada.id && e.dia === escalaSelecionada.dia);
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
			const atualizada = data.minhasEscalas.find((e: any) => e.id === escalaSelecionada.id && e.dia === escalaSelecionada.dia);
			if (atualizada) escalaSelecionada = atualizada;
		} catch (e: any) {
			toaster.error({ title: 'Erro', description: e.message });
		} finally {
			salvandoPresenca = false;
		}
	}
</script>

<div class="space-y-6">
	<header class="flex flex-col md:flex-row md:items-center justify-between gap-4">
		<div>
			<h1 class="text-2xl font-extrabold text-surface-900 dark:text-surface-50">Resultados GISE</h1>
			<p class="text-sm text-surface-500 dark:text-surface-400">
				{isAdminGeral ? 'Gerenciar modelo do questionário de pronto-atendimento' : 'Responder relatório de produtividade GISE'}
			</p>
		</div>
	</header>

	{#if isAdminGeral}
		<section class="card p-6 bg-surface-100/50 dark:bg-surface-900/50 border border-surface-200 dark:border-surface-800 rounded-3xl space-y-6">
			<div class="flex items-center justify-between border-b border-surface-200 dark:border-surface-800 pb-4">
				<h2 class="text-lg font-bold">Configuração do Questionário</h2>
				<button class="btn preset-filled-primary-500 btn-sm rounded-xl" onclick={adicionarPergunta}>
					+ Nova Pergunta
				</button>
			</div>

			<div class="space-y-4">
				{#each perguntas as p, i (p.id)}
					<div class="p-4 bg-white dark:bg-surface-800 rounded-2xl border border-surface-200 dark:border-surface-700 flex flex-col md:flex-row gap-4 items-start md:items-end">
						<div class="flex-1 w-full">
							<label for="p-texto-{p.id}" class="text-xs font-bold text-surface-500 uppercase mb-1 block">Pergunta {i + 1}</label>
							<input id="p-texto-{p.id}" type="text" bind:value={p.texto} placeholder="Ex: Quantas ocorrências foram atendidas?" class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-sm" />
						</div>
						<div class="w-full md:w-40">
							<label for="p-tipo-{p.id}" class="text-xs font-bold text-surface-500 uppercase mb-1 block">Tipo</label>
							<select id="p-tipo-{p.id}" bind:value={p.tipo} class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-sm">
								<option value="texto">Texto</option>
								<option value="numero">Número</option>
								<option value="sim_nao">Sim / Não</option>
							</select>
						</div>
						<div class="flex items-center gap-2 pb-2">
							<label class="flex items-center gap-2 cursor-pointer">
								<input type="checkbox" bind:checked={p.obrigatoria} />
								<span class="text-xs font-medium">Obrigatória</span>
							</label>
							<button class="btn-icon btn-icon-sm preset-outlined-error-500 rounded-lg" onclick={() => removerPergunta(p.id)} title="Remover">
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
							</button>
						</div>
					</div>
				{/each}

				{#if perguntas.length === 0}
					<div class="text-center py-12 border-2 border-dashed border-surface-200 dark:border-surface-800 rounded-3xl">
						<p class="text-surface-500">Nenhuma pergunta configurada. Clique em "Nova Pergunta" para começar.</p>
					</div>
				{/if}
			</div>

			<div class="flex justify-end pt-4">
				<button class="btn preset-filled-primary-500 px-8 rounded-xl font-bold" onclick={salvarModelo} disabled={salvandoModelo}>
					{salvandoModelo ? 'Salvando...' : 'Salvar Questionário'}
				</button>
			</div>
		</section>
	{:else}
		<!-- Visão do Policial -->
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
						<p class="text-xs text-surface-500 mt-1 uppercase tracking-wider">{escala.status}</p>
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

						{#if escalaSelecionada.dia === 'domingo' && !escalaSelecionada.sabadoAssinado}
							<div class="p-8 text-center space-y-4">
								<div class="bg-warning-500/10 p-4 rounded-full w-16 h-16 mx-auto flex items-center justify-center">
									<svg class="w-8 h-8 text-warning-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m0 0v2m0-2h2m-2 0H10m11 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
								</div>
								<div>
									<h3 class="font-bold text-lg">Aguardando Supervisor</h3>
									<p class="text-sm text-surface-500">O formulário de Domingo será liberado assim que o relatório de Sábado for assinado pelo supervisor.</p>
								</div>
							</div>
						{:else if !isHorarioLiberado(escalaSelecionada)}
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
											{#if escalaSelecionada.equipeRespondida && !Object.keys(respostas).length}
												<div class="p-3 bg-primary-500/5 border border-primary-500/10 rounded-xl">
													<p class="text-[0.65rem] text-primary-600 dark:text-primary-400 italic">Um integrante da equipe já respondeu. Você pode visualizar ou retificar os dados abaixo.</p>
												</div>
											{/if}

											{#each data.modeloConteudo as p}
												<div class="space-y-2">
													<label for="resp-{p.id}" class="text-sm font-semibold text-surface-700 dark:text-surface-300">
														{p.texto} {#if p.obrigatoria}<span class="text-error-500">*</span>{/if}
													</label>
													
													{#if p.tipo === 'sim_nao'}
														<div class="flex gap-4">
															<label class="flex items-center gap-2 cursor-pointer bg-surface-50 dark:bg-surface-800 px-4 py-2 rounded-xl border border-surface-200 dark:border-surface-700">
																<input type="radio" value="Sim" bind:group={respostas[p.id]} disabled={escalaSelecionada.dia === 'sabado' ? escalaSelecionada.sabadoAssinado : escalaSelecionada.domingoAssinado} />
																<span class="text-sm">Sim</span>
															</label>
															<label class="flex items-center gap-2 cursor-pointer bg-surface-50 dark:bg-surface-800 px-4 py-2 rounded-xl border border-surface-200 dark:border-surface-700">
																<input type="radio" value="Não" bind:group={respostas[p.id]} disabled={escalaSelecionada.dia === 'sabado' ? escalaSelecionada.sabadoAssinado : escalaSelecionada.domingoAssinado} />
																<span class="text-sm">Não</span>
															</label>
														</div>
													{:else if p.tipo === 'numero'}
														<input id="resp-{p.id}" type="number" bind:value={respostas[p.id]} class="w-full px-4 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950" disabled={escalaSelecionada.dia === 'sabado' ? escalaSelecionada.sabadoAssinado : escalaSelecionada.domingoAssinado} />
													{:else}
														<textarea id="resp-{p.id}" bind:value={respostas[p.id]} rows="3" class="w-full px-4 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-sm" disabled={escalaSelecionada.dia === 'sabado' ? escalaSelecionada.sabadoAssinado : escalaSelecionada.domingoAssinado}></textarea>
													{/if}
												</div>
											{/each}

											{#if !(escalaSelecionada.dia === 'sabado' ? escalaSelecionada.sabadoAssinado : escalaSelecionada.domingoAssinado)}
												<button class="btn preset-filled-primary-500 w-full py-3 rounded-xl font-bold text-lg shadow-lg shadow-primary-500/20" onclick={salvarResposta} disabled={salvandoResposta || data.modeloConteudo.length === 0}>
													{salvandoResposta ? 'Processando...' : escalaSelecionada.equipeRespondida ? 'Retificar Resultados' : 'Enviar Resultados'}
												</button>
											{:else}
												<div class="bg-surface-100 dark:bg-surface-800 p-4 rounded-xl text-center border-2 border-dashed border-surface-300 dark:border-surface-700">
													<p class="text-xs font-bold text-surface-500 uppercase">Respostas Bloqueadas</p>
													<p class="text-[0.65rem] text-surface-400">O supervisor já assinou o relatório deste dia.</p>
												</div>
											{/if}
										</div>
									{/if}
								</div>

								<!-- Saída -->
								<div class="space-y-4 pt-4 border-t border-surface-200 dark:border-surface-800">
									<h3 class="font-bold uppercase text-sm tracking-wider">Término do Plantão</h3>
									
									{#if !escalaSelecionada.presenca?.saida_timestamp}
										{#if capturandoRubrica}
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
