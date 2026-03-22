<script lang="ts">
	import { page } from '$app/state';
	import { toaster } from '$lib/toast';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import type { Escala, Policial, EscalaPolicialComDados } from '$lib/types';
	import { initWebPKI, listarCertificados, assinarHash, type WebPKICertificate } from '$lib/webpki';

	const horas = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));

	let escala = $state<Escala | null>(null);
	let policiaisEscala = $state<EscalaPolicialComDados[]>([]);
	let todosOsPoliciais = $state<Policial[]>([]);
	let loading = $state(true);

	let cargoBusca = $state<'DPC' | 'OIP' | ''>('');
	let policialId = $state('');
	let dataPlantao = $state('');
	let adding = $state(false);

	const policialsFiltrados = $derived(
		cargoBusca
			? todosOsPoliciais.filter(p => p.cargo === cargoBusca).sort((a, b) => a.nome.localeCompare(b.nome))
			: []
	);

	let dialogOpen = $state(false);
	let policialParaRemover = $state<{itemId: number, nome: string} | null>(null);

	let editingId = $state<number | null>(null);
	let editDataEntrada = $state('');
	let editDataSaida = $state('');
	let editEntrada = $state('');
	let editSaida = $state('');

	function formatarData(dateStr: string): string {
		if (!dateStr) return '';
		const [year, month, day] = dateStr.split('-');
		return `${day}/${month}/${year}`;
	}

	function proximoDia(dateStr: string): string {
		const d = new Date(dateStr + 'T00:00:00');
		d.setDate(d.getDate() + 1);
		return d.toISOString().split('T')[0];
	}

	function getHoraEntrada(p: EscalaPolicialComDados): string {
		return p.hora_entrada || escala?.hora_entrada || '08';
	}

	function getHoraSaida(p: EscalaPolicialComDados): string {
		return p.hora_saida || escala?.hora_saida || '08';
	}

	function getDataSaida(p: EscalaPolicialComDados): string {
		if (p.data_saida) return p.data_saida;
		const he = Number(getHoraEntrada(p));
		const hs = Number(getHoraSaida(p));
		if (hs <= he) return proximoDia(p.data_plantao);
		return p.data_plantao;
	}

	function formatarHorario(p: EscalaPolicialComDados): string {
		return `${getHoraEntrada(p)}H A ${getHoraSaida(p)}H`;
	}

	function formatarDataPlantao(p: EscalaPolicialComDados): string {
		const dataEntrada = formatarData(p.data_plantao);
		const dataSaida = getDataSaida(p);
		if (dataSaida !== p.data_plantao) {
			return `${dataEntrada} à ${formatarData(dataSaida)}`;
		}
		return dataEntrada;
	}

	function datasDoPlantao(escala: Escala): string[] {
		const datas: string[] = [];
		const inicio = new Date(escala.data_inicio + 'T00:00:00');
		const fim = new Date(escala.data_fim + 'T00:00:00');
		const current = new Date(inicio);
		while (current <= fim) {
			datas.push(current.toISOString().split('T')[0]);
			current.setDate(current.getDate() + 1);
		}
		return datas;
	}

	function calcularDataSaidaInicial(dataEntrada: string, horaEntrada: string, horaSaida: string): string {
		const he = Number(horaEntrada);
		const hs = Number(horaSaida);
		if (hs <= he) return proximoDia(dataEntrada);
		return dataEntrada;
	}

	async function carregar() {
		const id = page.params.id;
		loading = true;

		const [escalaRes, policiaisRes, todosRes] = await Promise.all([
			fetch(`/api/escalas`).then(r => r.json()),
			fetch(`/api/escalas/${id}/policiais`).then(r => r.json()),
			fetch('/api/policiais?todos=1').then(r => r.json())
		]);

		escala = (escalaRes as Escala[]).find((e: Escala) => e.id === Number(id)) || null;
		policiaisEscala = policiaisRes;
		todosOsPoliciais = todosRes;

		if (escala && !dataPlantao) {
			dataPlantao = escala.data_inicio;
		}
		loading = false;
	}

	async function recarregarPoliciais() {
		const id = page.params.id;
		const res = await fetch(`/api/escalas/${id}/policiais`);
		policiaisEscala = await res.json();
	}

	async function adicionar(e: Event) {
		e.preventDefault();
		if (!policialId || !dataPlantao) return;
		adding = true;

		const he = escala?.hora_entrada || '08';
		const hs = escala?.hora_saida || '08';
		const ds = calcularDataSaidaInicial(dataPlantao, he, hs);

		const res = await fetch(`/api/escalas/${page.params.id}/policiais`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				policial_id: Number(policialId),
				data_plantao: dataPlantao,
				data_saida: ds,
				hora_entrada: he,
				hora_saida: hs
			})
		});

		if (res.ok) {
			toaster.create({ title: 'Policial adicionado à escala', type: 'success' });
			cargoBusca = '';
			policialId = '';
			await recarregarPoliciais();
		} else {
			toaster.create({ title: 'Erro ao adicionar', type: 'error' });
		}
		adding = false;
	}

	function startEdit(p: EscalaPolicialComDados) {
		editingId = p.id;
		editDataEntrada = p.data_plantao;
		editDataSaida = getDataSaida(p);
		editEntrada = getHoraEntrada(p);
		editSaida = getHoraSaida(p);
	}

	function editPreviewData(): string {
		if (!editDataEntrada) return '';
		const de = formatarData(editDataEntrada);
		if (editDataSaida && editDataSaida !== editDataEntrada) {
			return `${de} à ${formatarData(editDataSaida)}`;
		}
		return de;
	}

	async function salvarEdicao(itemId: number) {
		const res = await fetch(`/api/escalas/${page.params.id}/policiais`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				item_id: itemId,
				data_plantao: editDataEntrada,
				data_saida: editDataSaida,
				hora_entrada: editEntrada,
				hora_saida: editSaida
			})
		});

		if (res.ok) {
			editingId = null;
			await recarregarPoliciais();
		}
	}

	function cancelEdit() {
		editingId = null;
	}

	function solicitarRemocao(itemId: number, nome: string) {
		policialParaRemover = { itemId, nome };
		dialogOpen = true;
	}

	async function confirmarRemocao() {
		if (!policialParaRemover) return;
		
		const itemId = policialParaRemover.itemId;
		const nome = policialParaRemover.nome;
		dialogOpen = false;

		const res = await fetch(`/api/escalas/${page.params.id}/policiais?item_id=${itemId}`, { method: 'DELETE' });
		if (res.ok) {
			toaster.create({ title: `${nome} removido da escala`, type: 'success' });
			await recarregarPoliciais();
		}
		policialParaRemover = null;
	}

	function download(format: string) {
		window.open(`/api/escalas/${page.params.id}/download?format=${format}`, '_blank');
	}

	// === Assinatura Digital ===
	let assinando = $state(false);
	let etapaAssinatura = $state('');
	let certificados = $state<WebPKICertificate[]>([]);
	let certSelecionado = $state('');
	let mostrarCerts = $state(false);

	async function assinarDigitalmente() {
		if (certificados.length === 0) {
			// Primeiro clique: inicializar Web PKI e listar certificados
			assinando = true;
			etapaAssinatura = 'Inicializando Web PKI...';
			try {
				const pki = await initWebPKI();
				etapaAssinatura = 'Listando certificados...';
				certificados = await listarCertificados(pki);
				if (certificados.length === 0) {
					toaster.create({ title: 'Nenhum certificado digital encontrado. Conecte seu eToken USB.', type: 'error' });
					assinando = false;
					etapaAssinatura = '';
					return;
				}
				if (certificados.length === 1) {
					certSelecionado = certificados[0].thumbprint;
					await executarAssinatura(pki, certificados[0].thumbprint);
				} else {
					mostrarCerts = true;
					assinando = false;
					etapaAssinatura = '';
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Erro ao inicializar Web PKI';
				toaster.create({ title: msg, type: 'error' });
				assinando = false;
				etapaAssinatura = '';
			}
			return;
		}

		// Já tem certificados listados, usar o selecionado
		if (!certSelecionado) {
			toaster.create({ title: 'Selecione um certificado', type: 'error' });
			return;
		}
		assinando = true;
		try {
			const pki = await initWebPKI();
			await executarAssinatura(pki, certSelecionado);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Erro na assinatura';
			toaster.create({ title: msg, type: 'error' });
			assinando = false;
			etapaAssinatura = '';
		}
	}

	async function executarAssinatura(pki: Awaited<ReturnType<typeof initWebPKI>>, thumbprint: string) {
		assinando = true;

		// 1. Preparar PDF no servidor
		etapaAssinatura = 'Gerando PDF e preparando assinatura...';
		const prepRes = await fetch(`/api/escalas/${page.params.id}/preparar-assinatura`, { method: 'POST' });
		if (!prepRes.ok) {
			const err = await prepRes.json();
			throw new Error(err.error || 'Erro ao preparar PDF');
		}
		const { hashHex, preparedPdf } = await prepRes.json();

		// 2. Assinar hash com eToken (janela de PIN aparece aqui)
		etapaAssinatura = 'Aguardando assinatura no eToken (digite o PIN)...';
		const pkcs7 = await assinarHash(pki, thumbprint, hashHex);

		// 3. Finalizar assinatura no servidor
		etapaAssinatura = 'Finalizando PDF assinado...';
		const finRes = await fetch(`/api/escalas/${page.params.id}/finalizar-assinatura`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ preparedPdf, pkcs7 })
		});

		if (!finRes.ok) {
			const err = await finRes.json();
			throw new Error(err.error || 'Erro ao finalizar assinatura');
		}

		// 4. Download do PDF assinado
		etapaAssinatura = 'Baixando PDF assinado...';
		const blob = await finRes.blob();
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = finRes.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'escala_assinada.pdf';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);

		toaster.create({ title: 'PDF assinado com sucesso!', type: 'success' });
		assinando = false;
		etapaAssinatura = '';
		mostrarCerts = false;
	}

	function agruparPorData(items: EscalaPolicialComDados[]): Map<string, EscalaPolicialComDados[]> {
		const map = new Map<string, EscalaPolicialComDados[]>();
		for (const item of items) {
			const list = map.get(item.data_plantao) || [];
			list.push(item);
			map.set(item.data_plantao, list);
		}
		return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
	}

	$effect(() => { carregar(); });
</script>

{#if loading}
	<p class="text-center py-12 text-surface-500">Carregando...</p>
{:else if !escala}
	<div class="text-center py-12 text-surface-500"><p>Escala não encontrada.</p></div>
{:else}
	<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-6">
		<div>
			<h1 class="h1 text-lg sm:text-xl font-bold">{escala.titulo}</h1>
			<p class="text-surface-500 text-sm mt-1">
				{escala.cidade} &bull; {formatarData(escala.data_inicio)} a {formatarData(escala.data_fim)} &bull; {escala.hora_entrada || '08'}H a {escala.hora_saida || '08'}H
			</p>
		</div>
		<a href="/escalas" class="btn preset-outlined-primary-500 shrink-0">Voltar</a>
	</div>

	<Dialog open={dialogOpen} onOpenChange={(e) => dialogOpen = e.open}>
		<Dialog.Content class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm">
			<div class="card p-6 max-w-sm w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10">
				<Dialog.Title class="h3 font-bold mb-2">Remover Policial?</Dialog.Title>
				<Dialog.Description class="text-surface-600 dark:text-surface-400 mb-6">
					Tem certeza que deseja remover o policial "{policialParaRemover?.nome}" desta escala?
				</Dialog.Description>
				<div class="flex justify-end gap-3">
					<Dialog.CloseTrigger class="btn preset-outlined-surface">Cancelar</Dialog.CloseTrigger>
					<button class="btn preset-filled-error-500" onclick={confirmarRemocao}>Remover</button>
				</div>
			</div>
		</Dialog.Content>
	</Dialog>

	<!-- Export buttons -->
	{#if policiaisEscala.length > 0}
		<div class="p-4 mb-4 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20">
			<h3 class="font-semibold text-sm mb-3">Exportar Escala</h3>
			<div class="flex gap-2 flex-wrap">
				<button class="btn btn-sm preset-filled-primary-500" onclick={() => download('docx')}>Word (.docx)</button>
				<button class="btn btn-sm preset-filled-primary-500" onclick={() => download('odt')}>ODT (.odt)</button>
				<button class="btn btn-sm preset-filled-primary-500" onclick={() => download('xlsx')}>Excel (.xlsx)</button>
				<button class="btn btn-sm preset-filled-primary-500" onclick={() => download('ods')}>ODS (.ods)</button>
				<button class="btn btn-sm preset-filled-primary-500" onclick={() => download('pdf')}>PDF (.pdf)</button>
			</div>

			<hr class="my-3 border-surface-200 dark:border-white/10" />
			<h3 class="font-semibold text-sm mb-3">Assinatura Digital (eToken USB)</h3>

			{#if mostrarCerts && certificados.length > 1}
				<div class="flex gap-2 flex-wrap items-end mb-3">
					<label class="label flex-1 min-w-[200px]">
						<span class="label-text text-xs">Certificado</span>
						<select class="select" bind:value={certSelecionado}>
							<option value="">Selecione o certificado...</option>
							{#each certificados as cert (cert.thumbprint)}
								<option value={cert.thumbprint}>
									{cert.subjectName}{cert.cpf ? ` (CPF: ${cert.cpf})` : ''}
								</option>
							{/each}
						</select>
					</label>
				</div>
			{/if}

			<div class="flex gap-2 items-center flex-wrap">
				<button
					class="btn btn-sm preset-filled-success-500"
					onclick={assinarDigitalmente}
					disabled={assinando}
				>
					{#if assinando}
						<span class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
						{etapaAssinatura}
					{:else}
						Assinar Digitalmente
					{/if}
				</button>
				{#if certificados.length > 0 && !assinando}
					<button class="btn btn-sm preset-outlined-surface" onclick={() => { certificados = []; certSelecionado = ''; mostrarCerts = false; }}>
						Trocar certificado
					</button>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Add form -->
	<div class="p-4 sm:p-6 mb-4 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20">
		<h3 class="font-semibold text-sm mb-3">Adicionar DPC/OIP à Escala</h3>
		<form onsubmit={adicionar}>
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
				<label class="label">
					<span class="label-text">Cargo</span>
					<select class="select" bind:value={cargoBusca} onchange={() => { policialId = ''; }}>
						<option value="">Selecione...</option>
						<option value="DPC">DPC - Delegado de Polícia Civil</option>
						<option value="OIP">OIP - Oficial Investigador de Polícia</option>
					</select>
				</label>
				<label class="label">
					<span class="label-text">Servidor</span>
					<select class="select" bind:value={policialId} disabled={!cargoBusca}>
						<option value="">Selecione...</option>
						{#each policialsFiltrados as p (p.id)}
							<option value={String(p.id)}>{p.nome}{p.lotacao ? ' — ' + p.lotacao : ''}</option>
						{/each}
					</select>
				</label>
				<label class="label">
					<span class="label-text">Data do plantão</span>
					<select class="select" bind:value={dataPlantao} required>
						{#each datasDoPlantao(escala) as d (d)}
							<option value={d}>{formatarData(d)}</option>
						{/each}
					</select>
				</label>
				<div>
					<button type="submit" class="btn preset-filled-primary-500 w-full sm:w-auto" disabled={adding || !policialId || !dataPlantao}>
						{adding ? 'Adicionando...' : 'Adicionar'}
					</button>
				</div>
			</div>
		</form>
	</div>

	<!-- Policiais list -->
	{#if policiaisEscala.length === 0}
		<div class="card p-8 text-center text-surface-500">
			<p>Nenhum policial na escala. Adicione policiais acima.</p>
		</div>
	{:else}
		{#each [...agruparPorData(policiaisEscala)] as [dataGrupo, policiais] (dataGrupo)}
			<!-- Desktop table -->
			<div class="p-4 overflow-hidden mb-6 hidden md:block rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border-2 border-surface-200 dark:border-white/15 shadow-xl shadow-black/5 dark:shadow-black/20">
				<div class="table-wrap">
					<table class="table">
						<thead>
							<tr>
								<th>Equipe de Plantão da DP</th>
								<th>Matrícula</th>
								<th>Cargo</th>
								<th>Telefone</th>
								<th>Lotação</th>
								<th>Data</th>
								<th>Horário</th>
								<th>Ações</th>
							</tr>
						</thead>
						<tbody>
							{#each policiais as p (p.id)}
								<tr>
									<td>{p.nome}</td>
									<td>{p.matricula}</td>
									<td>
										<span class="badge text-xs {p.cargo === 'DPC' ? 'preset-filled-primary-500' : 'preset-filled-warning-500'}">{p.cargo}</span>
									</td>
									<td>{p.telefone}</td>
									<td>{p.lotacao}</td>
									{#if editingId === p.id}
										<td colspan="2" class="bg-surface-200 dark:bg-surface-800 rounded-lg">
											<div class="flex flex-col gap-2 py-1">
												<div class="flex items-center gap-2">
													<span class="text-xs font-semibold text-surface-500 w-14">Entrada:</span>
													<input type="date" bind:value={editDataEntrada} class="input text-sm flex-1 min-w-[120px]" />
													<select bind:value={editEntrada} class="select text-sm w-16">
														{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
													</select>
												</div>
												<div class="flex items-center gap-2">
													<span class="text-xs font-semibold text-surface-500 w-14">Saída:</span>
													<input type="date" bind:value={editDataSaida} class="input text-sm flex-1 min-w-[120px]" />
													<select bind:value={editSaida} class="select text-sm w-16">
														{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
													</select>
												</div>
												<p class="text-xs text-surface-500 italic">{editPreviewData()} &bull; {editEntrada}H A {editSaida}H</p>
												<div class="flex gap-1">
													<button class="btn btn-sm preset-filled-primary-500" onclick={() => salvarEdicao(p.id)}>Salvar</button>
													<button class="btn btn-sm preset-outlined-primary-500" onclick={cancelEdit}>Cancelar</button>
												</div>
											</div>
										</td>
									{:else}
										<td>
											<button class="border border-dashed border-surface-300 rounded px-2 py-1 text-sm w-full text-center hover:border-primary-500 hover:bg-surface-100 transition-colors" onclick={() => startEdit(p)} title="Clique para editar">
												{formatarDataPlantao(p)}
											</button>
										</td>
										<td>
											<button class="border border-dashed border-surface-300 rounded px-2 py-1 text-sm w-full text-center hover:border-primary-500 hover:bg-surface-100 transition-colors" onclick={() => startEdit(p)} title="Clique para editar">
												{formatarHorario(p)}
											</button>
										</td>
									{/if}
									<td>
										<button class="btn btn-sm preset-filled-error-500" onclick={() => solicitarRemocao(p.id, p.nome)}>Remover</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>

			<!-- Mobile cards -->
			<div class="md:hidden space-y-3 mb-6">
				{#each policiais as p (p.id)}
				<div class="p-4 mb-4 rounded-2xl bg-surface-100/50 dark:bg-surface-800/50 border-2 border-surface-200 dark:border-white/15 hover:border-primary-500/40 transition-colors">
						<div class="flex items-center justify-between mb-2">
							<span class="font-semibold text-sm">{p.nome}</span>
							<span class="badge text-xs {p.cargo === 'DPC' ? 'preset-filled-primary-500' : 'preset-filled-warning-500'}">{p.cargo}</span>
						</div>
						<div class="space-y-1 text-sm text-surface-600 mb-3">
							<div class="flex justify-between">
								<span class="text-surface-500">Matrícula</span>
								<span>{p.matricula}</span>
							</div>
							<div class="flex justify-between">
								<span class="text-surface-500">Telefone</span>
								<span>{p.telefone}</span>
							</div>
							<div class="flex justify-between">
								<span class="text-surface-500">Lotação</span>
								<span>{p.lotacao}</span>
							</div>
						</div>

						{#if editingId === p.id}
							<div class="bg-surface-200 dark:bg-surface-800 rounded-lg p-3 space-y-2 mb-3">
								<div class="grid grid-cols-2 gap-2">
									<label class="label">
										<span class="label-text text-xs">Data entrada</span>
										<input type="date" bind:value={editDataEntrada} class="input text-sm" />
									</label>
									<label class="label">
										<span class="label-text text-xs">Hora entrada</span>
										<select bind:value={editEntrada} class="select text-sm">
											{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
										</select>
									</label>
								</div>
								<div class="grid grid-cols-2 gap-2">
									<label class="label">
										<span class="label-text text-xs">Data saída</span>
										<input type="date" bind:value={editDataSaida} class="input text-sm" />
									</label>
									<label class="label">
										<span class="label-text text-xs">Hora saída</span>
										<select bind:value={editSaida} class="select text-sm">
											{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
										</select>
									</label>
								</div>
								<p class="text-xs text-surface-500 italic">{editPreviewData()} &bull; {editEntrada}H A {editSaida}H</p>
								<div class="flex gap-2">
									<button class="btn btn-sm preset-filled-primary-500" onclick={() => salvarEdicao(p.id)}>Salvar</button>
									<button class="btn btn-sm preset-outlined-primary-500" onclick={cancelEdit}>Cancelar</button>
								</div>
							</div>
						{:else}
							<div class="flex gap-2 mb-3">
								<button class="flex-1 border border-dashed border-surface-300 rounded px-2 py-2 text-sm text-center hover:border-primary-500 transition-colors" onclick={() => startEdit(p)}>
									{formatarDataPlantao(p)}
								</button>
								<button class="flex-1 border border-dashed border-surface-300 rounded px-2 py-2 text-sm text-center hover:border-primary-500 transition-colors" onclick={() => startEdit(p)}>
									{formatarHorario(p)}
								</button>
							</div>
						{/if}

						<div class="flex justify-end">
							<button class="btn btn-sm preset-filled-error-500" onclick={() => solicitarRemocao(p.id, p.nome)}>Remover</button>
						</div>
					</div>
				{/each}
			</div>
		{/each}
	{/if}
{/if}
