<script lang="ts">
	let { respostas = $bindable(), modelo = [] } = $props<{ respostas: any, modelo: any[] }>();


	function handleSimNao(key: string, val: string, q: any) {
		respostas[key] = val;
		// Inicializações automáticas para tipos sistêmicos
		if (val === 'Sim') {
			if (q.tipo === 'mandados_maiores' && !respostas.mandados_qtd) {
				respostas.mandados_qtd = 1;
				respostas.mandados_lista = [{nome: '', mandado: ''}];
			}
			if (q.tipo === 'prisoes_maiores' && !respostas.prisoes_qtd) {
				respostas.prisoes_qtd = 1;
				respostas.prisoes_lista = [{nome: '', mandado: ''}];
			}
			if (q.tipo === 'apreensoes_menores' && !respostas.apreensoes_qtd) {
				respostas.apreensoes_qtd = 1;
				respostas.apreensoes_lista = [{nome: '', mandado: ''}];
			}
			if (q.tipo === 'armas_complex' && (!respostas.armas_selecionadas || respostas.armas_selecionadas.length === 0)) {
				respostas.armas_selecionadas = [];
				respostas.armas_detalhe = {};
			}
			if (q.tipo === 'drogas_complex' && (!respostas.drogas_selecionadas || respostas.drogas_selecionadas.length === 0)) {
				respostas.drogas_selecionadas = [];
				respostas.drogas_detalhe = {};
			}
		}
	}
</script>

<div class="space-y-6">
	{#snippet renderCampo(q: any, level = 0)}
		{@const resKey = q.tipo === 'mandados_maiores' ? 'mandados_lista' : (q.tipo === 'prisoes_maiores' ? 'prisoes_lista' : 'apreensoes_lista')}
		{@const resQtdKey = q.tipo === 'mandados_maiores' ? 'mandados_qtd' : (q.tipo === 'prisoes_maiores' ? 'prisoes_qtd' : 'apreensoes_qtd')}
		
		<div class="card p-6 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-3xl shadow-sm space-y-4 animate-in fade-in slide-in-from-top-4 duration-500" style="margin-left: {level * 1.5}rem">
			<div class="space-y-1">
				<label for="q-{q.id}" class="text-sm font-bold text-surface-900 dark:text-surface-50 uppercase tracking-tight leading-tight block">
					{q.texto}
				</label>
			</div>

			<div class="mt-2">
				{#if q.tipo === 'vtr_placa'}
					<input 
						id="q-{q.id}"
						type="text" 
						placeholder="Ex: XXX-0000"
						class="w-full md:w-64 px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-sm font-black uppercase tracking-widest focus:ring-2 focus:ring-primary-500 transition-all shadow-inner"
						bind:value={respostas[q.key]}
					/>
				{:else if q.tipo === 'numero'}
					<input 
						id="q-{q.id}"
						type="number" 
						placeholder="0"
						class="w-full md:w-48 px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-sm font-bold focus:ring-2 focus:ring-primary-500 transition-all shadow-inner"
						bind:value={respostas[q.key]}
					/>
				{:else if q.tipo === 'select_99'}
					<select 
						id="q-{q.id}"
						class="w-full md:w-32 px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-sm font-bold focus:ring-2 focus:ring-primary-500 transition-all shadow-inner appearance-none"
						bind:value={respostas[q.key]}
					>
						<option value="">Selecione</option>
						{#each Array(100) as _, i}
							<option value={i}>{i}</option>
						{/each}
					</select>
				{:else if q.tipo === 'sim_nao'}
					<div class="flex gap-4">
						{#each ['Sim', 'Não'] as opt}
							<button 
								type="button"
								class="px-8 py-2.5 rounded-xl text-xs font-black uppercase border-2 transition-all {respostas[q.key] === opt ? 'bg-primary-500 text-white border-primary-500 shadow-lg shadow-primary-500/30' : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-700 text-surface-400 hover:border-primary-500/50 hover:text-surface-600'}"
								onclick={() => handleSimNao(q.key, opt, q)}
							>
								{opt}
							</button>
						{/each}
					</div>
				{:else if q.tipo === 'textarea'}
					<textarea 
						id="q-{q.id}"
						rows="4" 
						placeholder="Descreva detalhadamente..."
						class="w-full px-4 py-3 rounded-2xl border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-sm font-medium focus:ring-2 focus:ring-primary-500 transition-all shadow-inner"
						bind:value={respostas[q.key]}
					></textarea>
				{:else if q.tipo === 'mandados_maiores' || q.tipo === 'prisoes_maiores' || q.tipo === 'apreensoes_menores'}
					<div class="space-y-4">
						<div class="flex gap-4">
							{#each ['Sim', 'Não'] as opt}
								<button 
									type="button"
									class="px-8 py-2.5 rounded-xl text-xs font-black uppercase border-2 transition-all {respostas[q.key] === opt ? 'bg-primary-500 text-white border-primary-500 shadow-lg shadow-primary-500/30' : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-700 text-surface-400 hover:border-primary-500/50 hover:text-surface-600'}"
									onclick={() => handleSimNao(q.key, opt, q)}
								>
									{opt}
								</button>
							{/each}
						</div>

						{#if respostas[q.key] === 'Sim'}
							<div class="p-6 bg-surface-50 dark:bg-surface-950/40 rounded-3xl border border-surface-200 dark:border-surface-800 space-y-6 animate-in fade-in zoom-in-95 duration-500">
								<div class="flex items-center gap-4">
									<label class="block">
										<span class="text-[0.65rem] font-black text-surface-400 uppercase tracking-widest block">{q.subtexto_qtd || 'Quantidade:'}</span>
										<select class="w-24 px-4 py-2.5 rounded-xl border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 text-sm font-bold shadow-sm"
											bind:value={respostas[resQtdKey]}
											onchange={(e) => {
												const n = Number((e.currentTarget as HTMLSelectElement).value);
												if (!respostas[resKey]) respostas[resKey] = [];
												respostas[resKey] = Array(n).fill(0).map((_, idx) => (respostas[resKey] || [])[idx] || { nome: '', mandado: '' });
											}}
										>
											{#each Array(99).fill(0).map((_, idx) => idx + 1) as n}
												<option value={n}>{n}</option>
											{/each}
										</select>
									</label>
								</div>

								<div class="space-y-3">
									<span class="text-[0.65rem] font-black text-surface-400 uppercase tracking-widest block">{q.subtexto_lista || 'Nomes e Mandados/Processos:'}</span>
									{#each (respostas[resKey] || []) as item, i}
										<div class="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm transition-all hover:border-primary-500/30">
											<div class="space-y-1">
												<label class="text-[0.6rem] font-bold text-surface-400 uppercase" for="n-{q.id}-{i}">Nome</label>
												<input id="n-{q.id}-{i}" type="text" placeholder="Nome Completo" class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-medium" 
													bind:value={item.nome} />
											</div>
											<div class="space-y-1">
												<label class="text-[0.6rem] font-bold text-surface-400 uppercase" for="m-{q.id}-{i}">{q.tipo === 'prisoes_maiores' ? 'Procedimento' : 'Mandado/Processo'}</label>
												<input id="m-{q.id}-{i}" type="text" placeholder="Número" class="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-medium" 
													bind:value={item.mandado} />
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{:else if q.tipo === 'drogas_complex'}
					<div class="space-y-4">
						<div class="flex gap-4">
							{#each ['Sim', 'Não'] as opt}
								<button 
									type="button"
									class="px-8 py-2.5 rounded-xl text-xs font-black uppercase border-2 transition-all {respostas[q.key] === opt ? 'bg-primary-500 text-white border-primary-500 shadow-lg shadow-primary-500/30' : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-700 text-surface-400 hover:border-primary-500/50 hover:text-surface-600'}"
									onclick={() => handleSimNao(q.key, opt, q)}
								>
									{opt}
								</button>
							{/each}
						</div>

						{#if respostas[q.key] === 'Sim'}
							<div class="p-6 bg-surface-50 dark:bg-surface-950/40 rounded-3xl border border-surface-200 dark:border-surface-800 space-y-6 animate-in fade-in zoom-in-95 duration-500">
								<div class="space-y-3">
									<span class="text-[0.65rem] font-black text-surface-400 uppercase tracking-widest block">{q.subtexto_tipo || 'Tipos de Droga Apreendidos:'}</span>
									<div class="grid grid-cols-2 md:grid-cols-4 gap-2">
										{#each ['Maconha', 'Cocaína', 'Crack', 'Extase', 'LSD', 'Haxixe', 'Skunk', 'Outros'] as d}
											<button class="px-3 py-2 rounded-xl text-[0.6rem] font-black uppercase border-2 transition-all {(respostas.drogas_selecionadas || []).includes(d) ? 'bg-primary-500 text-white border-primary-500 shadow-md' : 'bg-white dark:bg-surface-900 text-surface-500 border-surface-100 dark:border-surface-800 hover:border-primary-500/50'}"
												onclick={() => {
													const current = respostas.drogas_selecionadas || [];
													if (current.includes(d)) {
														respostas.drogas_selecionadas = current.filter((x: string) => x !== d);
													} else {
														respostas.drogas_selecionadas = [...current, d];
													}
												}}
											>{d}</button>
										{/each}
									</div>
								</div>

								{#if (respostas.drogas_selecionadas || []).length > 0}
									<div class="space-y-4 pt-2 border-t border-surface-100 dark:border-surface-800 transition-all">
										<span class="text-[0.65rem] font-black text-surface-400 uppercase tracking-widest block">{q.subtexto_detalhe || 'Indique o Peso Aproximado e a Unidade:'}</span>
										{#each respostas.drogas_selecionadas as d}
											<div class="flex flex-col md:flex-row md:items-center gap-4 p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm animate-in slide-in-from-left-2 duration-300">
												<span class="text-xs font-black w-24 text-surface-600 dark:text-surface-400 uppercase tracking-tight shrink-0">{d}:</span>
												
												<div class="flex items-center gap-3 flex-1">
													<div class="relative flex-1 max-w-[150px]">
														<input 
															type="number" 
															step="0.001" 
															placeholder="0.000" 
															class="w-full pl-4 pr-4 py-2 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold focus:ring-2 focus:ring-primary-500 transition-all shadow-inner" 
															bind:value={respostas.drogas_detalhe[d]} 
														/>
													</div>

													<div class="flex p-1 bg-surface-100 dark:bg-surface-800 rounded-xl border border-surface-200 dark:border-surface-700">
														{#each ['g', 'kg'] as u}
															<button 
																type="button"
																class="px-3 py-1.5 rounded-lg text-[0.6rem] font-black uppercase transition-all {(respostas.drogas_unidade && respostas.drogas_unidade[d] === u) || (!respostas.drogas_unidade?.[d] && u === 'g') ? 'bg-white dark:bg-surface-700 text-primary-600 shadow-sm' : 'text-surface-400 hover:text-surface-600'}"
																onclick={() => (respostas.drogas_unidade = respostas.drogas_unidade || {})[d] = u}
															>
																{u}
															</button>
														{/each}
													</div>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{:else if q.tipo === 'armas_complex'}
					<div class="space-y-4">
						<div class="flex gap-4">
							{#each ['Sim', 'Não'] as opt}
								<button 
									type="button"
									class="px-8 py-2.5 rounded-xl text-xs font-black uppercase border-2 transition-all {respostas[q.key] === opt ? 'bg-primary-500 text-white border-primary-500 shadow-lg shadow-primary-500/30' : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-700 text-surface-400 hover:border-primary-500/50 hover:text-surface-600'}"
									onclick={() => handleSimNao(q.key, opt, q)}
								>
									{opt}
								</button>
							{/each}
						</div>

						{#if respostas[q.key] === 'Sim'}
							<div class="p-6 bg-surface-50 dark:bg-surface-950/40 rounded-3xl border border-surface-200 dark:border-surface-800 space-y-6 animate-in fade-in zoom-in-95 duration-500">
								<div class="space-y-3">
									<span class="text-[0.65rem] font-black text-surface-400 uppercase tracking-widest block">{q.subtexto_tipo || 'Tipos de Armas/Munições:'}</span>
									<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
										{#each ['Revolver', 'Pistola', 'Arma Longa', 'Arma Branca', 'Munição', 'Outros'] as a}
											<button class="px-3 py-2 rounded-xl text-[0.6rem] font-black uppercase border-2 transition-all {(respostas.armas_selecionadas || []).includes(a) ? 'bg-primary-500 text-white border-primary-500 shadow-md' : 'bg-white dark:bg-surface-900 text-surface-500 border-surface-100 dark:border-surface-800 hover:border-primary-500/50'}"
												onclick={() => {
													const current = respostas.armas_selecionadas || [];
													if (current.includes(a)) {
														respostas.armas_selecionadas = current.filter((x: string) => x !== a);
													} else {
														respostas.armas_selecionadas = [...current, a];
														if (!respostas.armas_detalhe) respostas.armas_detalhe = {};
														if (!respostas.armas_detalhe[a]) respostas.armas_detalhe[a] = 1;
													}
												}}
											>{a}</button>
										{/each}
									</div>
								</div>

								{#if (respostas.armas_selecionadas || []).length > 0}
									<div class="space-y-4 pt-2 border-t border-surface-100 dark:border-surface-800 transition-all">
										<span class="text-[0.65rem] font-black text-surface-400 uppercase tracking-widest block">{q.subtexto_detalhe || 'Indique a Quantidade:'}</span>
										{#each respostas.armas_selecionadas as a}
											<div class="flex items-center gap-4 p-4 bg-white dark:bg-surface-900 rounded-2xl border border-surface-100 dark:border-surface-800 shadow-sm animate-in slide-in-from-left-2 duration-300">
												<span class="text-xs font-black w-24 text-surface-600 dark:text-surface-400 uppercase tracking-tight shrink-0">{a}:</span>
												
												<select class="w-32 px-4 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 text-xs font-bold focus:ring-2 focus:ring-primary-500 transition-all"
													bind:value={respostas.armas_detalhe[a]}
												>
													{#each Array(100) as _, i}
														<option value={i}>{i}</option>
													{/each}
												</select>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{:else}
					<input 
						id="q-{q.id}"
						type="text" 
						placeholder="Digite aqui..."
						class="w-full px-4 py-3 rounded-xl border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-sm font-medium focus:ring-2 focus:ring-primary-500 transition-all shadow-inner"
						bind:value={respostas[q.key]}
					/>
				{/if}
			</div>

			<!-- RECURSIVIDADE PARA FILHOS -->
			{#if (q.tipo === 'sim_nao' || q.tipo === 'mandados_maiores' || q.tipo === 'prisoes_maiores' || q.tipo === 'apreensoes_menores' || q.tipo === 'drogas_complex' || q.tipo === 'armas_complex') && respostas[q.key] === 'Sim' && q.filhos && q.filhos.length > 0}
				<div class="mt-6 space-y-6 pt-6 border-l-4 border-primary-500/20">
					{#each q.filhos as filho (filho.id)}
						{@render renderCampo(filho, level + 1)}
					{/each}
				</div>
			{/if}
		</div>
	{/snippet}

	{#each modelo as q (q.id)}
		{@render renderCampo(q)}
	{/each}
</div>
