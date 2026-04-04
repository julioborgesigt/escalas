<script lang="ts">
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import { toaster } from "$lib/toast";
	import { Dialog } from "@skeletonlabs/skeleton-svelte";
	import type { Escala, Policial, EscalaPolicialComDados } from "$lib/types";
	import { formatarData, proximoDia } from "$lib/utils";
	import PainelAssinaturaEscala from "$lib/components/PainelAssinaturaEscala.svelte";
	import Spinner from "$lib/components/Spinner.svelte";
	import { csrfHeaders } from "$lib/csrf";

	const horas = Array.from({ length: 24 }, (_, i) =>
		String(i).padStart(2, "0"),
	);
	const minutos = Array.from({ length: 60 }, (_, i) =>
		String(i).padStart(2, "0"),
	);

	let escala = $state<Escala | null>(null);
	let policiaisEscala = $state<EscalaPolicialComDados[]>([]);
	let todosOsPoliciais = $state<Policial[]>([]);
	let documentoAssinadoInfo = $state<{
		existe: boolean;
		assinante_nome?: string;
		assinante_cpf?: string;
		data?: string;
	} | null>(null);
	let loading = $state(true);

	let cargoBusca = $state<"DPC" | "OIP" | "">("");
	let policialId = $state("");
	let dataPlantao = $state("");
	let addHoraEntrada = $state("08");
	let addMinutoEntrada = $state("00");
	let addHoraSaida = $state("08");
	let addMinutoSaida = $state("00");
	let adding = $state(false);
	let adicionandoTodos = $state(false);
	let gerandoProximoMes = $state(false);

	let addEquipe = $state('1');
	let addTipoEscala = $state<'1x3' | '2x6'>('1x3');
	let addPrimeiroPlantao = $state('');
	let addDatasSelecionadas = $state<string[]>([]);

	const policialsFiltrados = $derived(
		cargoBusca
			? todosOsPoliciais
					.filter((p) => p.cargo === cargoBusca)
					.sort((a, b) => a.nome.localeCompare(b.nome))
			: [],
	);

	let dialogOpen = $state(false);
	let policialParaRemover = $state<{ itemId: number; nome: string } | null>(
		null,
	);
	let salvandoEdicao = $state(false);
	let removendo = $state(false);

	let editingId = $state<number | null>(null);
	let editDataEntrada = $state("");
	let editDataSaida = $state("");
	let editHoraEntrada = $state("");
	let editMinutoEntrada = $state("");
	let editHoraSaida = $state("");
	let editMinutoSaida = $state("");
	let editObservacoes = $state("");

	function getHoraEntrada(p: EscalaPolicialComDados): string {
		return p.hora_entrada || escala?.hora_entrada || "08";
	}

	function getHoraSaida(p: EscalaPolicialComDados): string {
		return p.hora_saida || escala?.hora_saida || "08";
	}

	function getDataSaida(p: EscalaPolicialComDados): string {
		if (p.data_saida) return p.data_saida;
		const he = Number(getHoraEntrada(p).split(":")[0]);
		const hs = Number(getHoraSaida(p).split(":")[0]);
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
		const inicio = new Date(escala.data_inicio + "T00:00:00");
		const fim = new Date(escala.data_fim + "T00:00:00");
		const current = new Date(inicio);
		while (current <= fim) {
			datas.push(current.toISOString().split("T")[0]);
			current.setDate(current.getDate() + 1);
		}
		return datas;
	}

	function calcularDataSaidaInicial(
		dataEntrada: string,
		horaEntrada: string,
		horaSaida: string,
	): string {
		const he = Number(horaEntrada.split(":")[0]);
		const hs = Number(horaSaida.split(":")[0]);
		if (hs <= he) return proximoDia(dataEntrada);
		return dataEntrada;
	}

	async function carregar() {
		const id = page.params.id;
		loading = true;

		const [escalaRes, policiaisRes, todosRes, infoRes] = await Promise.all([
			fetch(`/api/escalas`).then((r) => r.json()),
			fetch(`/api/escalas/${id}/policiais`).then((r) => r.json()),
			fetch("/api/policiais?todos=1").then((r) => r.json()),
			fetch(`/api/escalas/${id}/documento-assinado/info`)
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null),
		]);

		escala =
			(escalaRes as Escala[]).find((e: Escala) => e.id === Number(id)) ||
			null;
		policiaisEscala = policiaisRes;
		todosOsPoliciais = todosRes;

		if (escala) {
			addHoraEntrada = "08";
			addMinutoEntrada = "00";
			addHoraSaida = "08";
			addMinutoSaida = "00";
		}

		if (infoRes && infoRes.existe) {
			documentoAssinadoInfo = infoRes;
		}

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
		try {
			const he = escala?.hora_entrada || "08";
			const hs = escala?.hora_saida || "08";
			const ds = calcularDataSaidaInicial(dataPlantao, he, hs);

			const res = await fetch(`/api/escalas/${page.params.id}/policiais`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...csrfHeaders() },
				body: JSON.stringify({
					policial_id: Number(policialId),
					data_plantao: dataPlantao,
					data_saida: ds,
					hora_entrada: `${addHoraEntrada}:${addMinutoEntrada}`,
					hora_saida: `${addHoraSaida}:${addMinutoSaida}`,
				}),
			});

			if (res.ok) {
				const data = await res.json();
				if (data.policiais) policiaisEscala = data.policiais;
				toaster.create({ title: "Policial adicionado à escala", type: "success" });
				cargoBusca = "";
				policialId = "";
			} else {
				toaster.create({ title: "Erro ao adicionar", type: "error" });
			}
		} catch {
			toaster.create({ title: "Erro de conexão", type: "error" });
		} finally {
			adding = false;
		}
	}

	async function adicionarTodos() {
		if (!escala || adicionandoTodos) return;
		adicionandoTodos = true;
		try {
			const he = escala.hora_entrada || "08:00";
			const hs = escala.hora_saida || "08:00";
			const ds = calcularDataSaidaInicial(escala.data_inicio, he, hs);

			const res = await fetch(`/api/escalas/${page.params.id}/policiais`, {
				method: "PUT",
				headers: { "Content-Type": "application/json", ...csrfHeaders() },
				body: JSON.stringify({
					data_plantao: escala.data_inicio,
					data_saida: ds,
					hora_entrada: he,
					hora_saida: hs,
				}),
			});

			if (res.ok) {
				const data = await res.json();
				if (data.policiais) policiaisEscala = data.policiais;
				if (data.quantidade === 0) {
					toaster.create({ title: "Todos os servidores já estão na escala", type: "warning" });
				} else {
					toaster.create({ title: `${data.quantidade} servidor(es) adicionado(s) à escala`, type: "success" });
				}
			} else {
				toaster.create({ title: "Erro ao adicionar servidores", type: "error" });
			}
		} catch {
			toaster.create({ title: "Erro de conexão", type: "error" });
		} finally {
			adicionandoTodos = false;
		}
	}

	async function gerarProximoMes() {
		if (!escala || gerandoProximoMes) return;
		gerandoProximoMes = true;

		const res = await fetch(`/api/escalas/${page.params.id}/proximo-mes`, {
			method: "POST",
			headers: csrfHeaders()
		});

		const data = await res.json();

		if (res.ok) {
			const tipo = escala.tipo === 'plantao' ? 'Plantão' : 'Expediente';
			if (data.nao_processados?.length > 0) {
				const nomes = data.nao_processados.map((p: { nome: string }) => p.nome).join(', ');
				toaster.create({
					title: `Escala gerada! ${data.adicionados} servidor(es) adicionado(s).`,
					description: `Não processados (rotação não identificada): ${nomes}. Adicione-os manualmente.`,
					type: "warning",
				});
			} else {
				toaster.create({
					title: `Escala de ${tipo} do próximo mês criada com sucesso!`,
					description: `${data.adicionados} servidor(es) adicionado(s).`,
					type: "success",
				});
			}
			goto(`/escalas/${data.escala_id}`);
		} else if (res.status === 409 && data.escala_id) {
			// Já existe — redireciona para a escala existente
			toaster.create({
				title: data.error,
				description: "Redirecionando para a escala existente...",
				type: "warning",
			});
			goto(`/escalas/${data.escala_id}`);
		} else {
			toaster.create({ title: data.error || "Erro ao gerar próximo mês", type: "error" });
		}

		gerandoProximoMes = false;
	}

	function startEdit(p: EscalaPolicialComDados) {
		editingId = p.id;
		editDataEntrada = p.data_plantao;
		editDataSaida = getDataSaida(p);
		const [he, me = "00"] = getHoraEntrada(p).split(":");
		editHoraEntrada = he;
		editMinutoEntrada = me;
		const [hs, ms = "00"] = getHoraSaida(p).split(":");
		editHoraSaida = hs;
		editMinutoSaida = ms;
		editObservacoes = p.observacoes || "";
	}

	function editPreviewData(): string {
		if (!editDataEntrada) return "";
		const de = formatarData(editDataEntrada);
		if (editDataSaida && editDataSaida !== editDataEntrada) {
			return `${de} à ${formatarData(editDataSaida)}`;
		}
		return de;
	}

	async function salvarEdicao(itemId: number) {
		salvandoEdicao = true;
		try {
			const res = await fetch(`/api/escalas/${page.params.id}/policiais`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json", ...csrfHeaders() },
				body: JSON.stringify({
					item_id: itemId,
					data_plantao: editDataEntrada,
					data_saida: editDataSaida,
					hora_entrada: `${editHoraEntrada}:${editMinutoEntrada}`,
					hora_saida: `${editHoraSaida}:${editMinutoSaida}`,
					observacoes: editObservacoes,
				}),
			});
			if (res.ok) {
				const data = await res.json();
				if (data.policiais) policiaisEscala = data.policiais;
				editingId = null;
			} else {
				toaster.create({ title: 'Erro ao salvar alterações', type: 'error' });
			}
		} catch {
			toaster.create({ title: 'Erro de conexão', type: 'error' });
		} finally {
			salvandoEdicao = false;
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
		removendo = true;
		try {
			const res = await fetch(
				`/api/escalas/${page.params.id}/policiais?item_id=${itemId}`,
				{ method: "DELETE", headers: csrfHeaders() },
			);
			if (res.ok) {
				const data = await res.json();
				if (data.policiais) policiaisEscala = data.policiais;
				toaster.create({ title: `${nome} removido da escala`, type: "success" });
				dialogOpen = false;
				policialParaRemover = null;
			} else {
				toaster.create({ title: 'Erro ao remover policial', type: 'error' });
			}
		} catch {
			toaster.create({ title: 'Erro de conexão', type: 'error' });
		} finally {
			removendo = false;
		}
	}


	function agruparPorData(
		items: EscalaPolicialComDados[],
	): Map<string, EscalaPolicialComDados[]> {
		const map = new Map<string, EscalaPolicialComDados[]>();
		for (const item of items) {
			const list = map.get(item.data_plantao) || [];
			list.push(item);
			map.set(item.data_plantao, list);
		}
		return new Map(
			[...map.entries()].sort(([a], [b]) => a.localeCompare(b)),
		);
	}

	// Detecta se a escala é de Final de Semana
	const isFDS = $derived(escala?.tipo === 'fds');



	function calcularDatasPlantao(primeiroPlantao: string, tipo: '1x3' | '2x6'): string[] {
		if (!primeiroPlantao || !escala) return [];
		const datas: string[] = [];
		const inicio = new Date(escala.data_inicio + 'T00:00:00');
		const fim = new Date(escala.data_fim + 'T00:00:00');
		let d = new Date(primeiroPlantao + 'T00:00:00');
		if (tipo === '1x3') {
			while (d <= fim) {
				if (d >= inicio) datas.push(d.toISOString().split('T')[0]);
				d.setDate(d.getDate() + 4);
			}
		} else {
			while (d <= fim) {
				if (d >= inicio) datas.push(d.toISOString().split('T')[0]);
				
				// Adiciona o segundo dia do plantão (2x6)
				const d2 = new Date(d);
				d2.setDate(d2.getDate() + 1);
				if (d2 <= fim && d2 >= inicio) {
					datas.push(d2.toISOString().split('T')[0]);
				}
				
				d.setDate(d.getDate() + 8);
			}
		}
		return datas;
	}

	function toggleDataPlantao(data: string) {
		const idx = addDatasSelecionadas.indexOf(data);
		if (idx >= 0) {
			addDatasSelecionadas = addDatasSelecionadas.filter((d) => d !== data);
		} else {
			addDatasSelecionadas = [...addDatasSelecionadas, data].sort();
		}
	}

	function agruparPorEquipe(
		items: EscalaPolicialComDados[],
	): Map<string, EscalaPolicialComDados[]> {
		const map = new Map<string, EscalaPolicialComDados[]>();
		for (const item of items) {
			const equipe = item.equipe || '';
			const list = map.get(equipe) || [];
			list.push(item);
			map.set(equipe, list);
		}
		for (const list of map.values()) {
			list.sort((a, b) => {
				if (a.cargo !== b.cargo) return a.cargo === 'DPC' ? -1 : 1;
				if (a.nome !== b.nome) return a.nome.localeCompare(b.nome);
				return a.data_plantao.localeCompare(b.data_plantao);
			});
		}
		return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
	}

	async function adicionarPlantao(e: Event) {
		e.preventDefault();
		if (!policialId || addDatasSelecionadas.length === 0) return;
		adding = true;
		
		const he = `${addHoraEntrada}:${addMinutoEntrada}`;
		const hs = `${addHoraSaida}:${addMinutoSaida}`;
		
		const datas = addDatasSelecionadas.map((d) => {
			const ds = calcularDataSaidaInicial(d, he, hs);
			return { data_plantao: d, data_saida: ds };
		});
		const res = await fetch(`/api/escalas/${page.params.id}/policiais`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
			body: JSON.stringify({
				policial_id: Number(policialId),
				datas,
				hora_entrada: he,
				hora_saida: hs,
				equipe: addEquipe,
			}),
		});
		if (res.ok) {
			const data = await res.json();
			if (data.policiais) policiaisEscala = data.policiais;
			toaster.create({ title: 'Servidor adicionado à escala de plantão', type: 'success' });
			cargoBusca = '';
			policialId = '';
			addPrimeiroPlantao = '';
			addEquipe = '1';
			addDatasSelecionadas = [];
		} else {
			const err = await res.json().catch(() => ({}));
			toaster.create({ title: (err as { error?: string }).error || 'Erro ao adicionar', type: 'error' });
		}
		adding = false;
	}

	let servidoresExpandidos = $state(new Set<number>());

	function toggleExpandirServidor(id: number) {
		if (servidoresExpandidos.has(id)) {
			servidoresExpandidos.delete(id);
		} else {
			servidoresExpandidos.add(id);
		}
		servidoresExpandidos = new Set(servidoresExpandidos);
	}

	function agruparPorServidor(items: EscalaPolicialComDados[]) {
		const grupos = new Map<number, {
			policial_id: number;
			nome: string;
			matricula: string;
			cargo: string;
			telefone: string;
			lotacao: string;
			classe?: string;
			equipe: string;
			itens: EscalaPolicialComDados[];
		}>();

		for (const item of items) {
			if (!grupos.has(item.policial_id)) {
				grupos.set(item.policial_id, {
					policial_id: item.policial_id,
					nome: item.nome,
					matricula: item.matricula,
					cargo: item.cargo,
					telefone: item.telefone || '',
					lotacao: item.lotacao || '',
					classe: item.classe,
					equipe: item.equipe || '',
					itens: []
				});
			}
			grupos.get(item.policial_id)!.itens.push(item);
		}
		
		for (const g of grupos.values()) {
			g.itens.sort((a, b) => a.data_plantao.localeCompare(b.data_plantao));
		}

		return Array.from(grupos.values());
	}

	async function toggleDiaServidor(grupo: any, dataISO: string) {
		const itemExistente = grupo.itens.find((i: any) => i.data_plantao === dataISO);

		if (itemExistente) {
			const res = await fetch(`/api/escalas/${page.params.id}/policiais?item_id=${itemExistente.id}`, { 
				method: 'DELETE',
				headers: csrfHeaders()
			});
			if (res.ok) {
				const data = await res.json();
				if (data.policiais) policiaisEscala = data.policiais;
			}
		} else {
			const template = grupo.itens[0] || {};
			const he = template.hora_entrada || escala?.hora_entrada || "08:00";
			const hs = template.hora_saida || escala?.hora_saida || "08:00";
			const ds = calcularDataSaidaInicial(dataISO, he, hs);

			const res = await fetch(`/api/escalas/${page.params.id}/policiais`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
				body: JSON.stringify({
					policial_id: grupo.policial_id,
					data_plantao: dataISO,
					data_saida: ds,
					hora_entrada: he,
					hora_saida: hs,
					equipe: grupo.equipe
				}),
			});
			if (res.ok) {
				const data = await res.json();
				if (data.policiais) policiaisEscala = data.policiais;
			}
		}
	}

	$effect(() => {
		addDatasSelecionadas = calcularDatasPlantao(addPrimeiroPlantao, addTipoEscala);
	});

	$effect(() => {
		carregar();
	});
</script>

{#if loading}
	<div class="flex flex-col items-center justify-center py-16 gap-3 text-surface-400 dark:text-surface-500">
		<Spinner size="xl" />
		<span class="text-sm">Carregando...</span>
	</div>
{:else if !escala}
	<div class="text-center py-12 text-surface-500">
		<p>Escala não encontrada.</p>
	</div>
{:else}
	<div
		class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-6"
	>
		<div>
			<h1 class="h1 text-lg sm:text-xl font-bold">{escala.titulo}</h1>
			<p class="text-surface-500 text-sm mt-1">
				{formatarData(escala.data_inicio)} a {formatarData(
					escala.data_fim,
				)} &bull; {escala.hora_entrada || "08:00"}H a {escala.hora_saida ||
					"08:00"}H
			</p>
		</div>
		<a href="/escalas" class="btn preset-outlined-primary-500 shrink-0"
			>Voltar</a
		>
	</div>


	<PainelAssinaturaEscala
		escalaId={page.params.id || ""}
		{isFDS}
		policiaisCount={policiaisEscala.length}
		usuario={page.data.usuario}
		bind:documentoAssinadoInfo
	/>

	<Dialog open={dialogOpen} onOpenChange={(e) => (dialogOpen = e.open)}>
		<Dialog.Content
			class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
		>
			<div
				class="card p-6 max-w-sm w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
			>
				<Dialog.Title class="h3 font-bold mb-2"
					>Remover Policial?</Dialog.Title
				>
				<Dialog.Description
					class="text-surface-600 dark:text-surface-400 mb-6"
				>
					Tem certeza que deseja remover o policial "{policialParaRemover?.nome}"
					desta escala?
				</Dialog.Description>
				<div class="flex justify-end gap-3">
					<Dialog.CloseTrigger class="btn preset-outlined-surface" disabled={removendo}
						>Cancelar</Dialog.CloseTrigger
					>
					<button
						class="btn preset-filled-error-500"
						disabled={removendo}
						onclick={confirmarRemocao}>
						{#if removendo}<Spinner size="sm" />{/if}
						{removendo ? 'Removendo...' : 'Remover'}
					</button>
				</div>
			</div>
		</Dialog.Content>
	</Dialog>


	<!-- Adicionar todos (apenas para escalas mensais de plantão ou expediente) -->
	{#if escala.tipo === 'expediente'}
		<div
			class="p-4 sm:p-5 mb-4 rounded-3xl bg-primary-500/8 border border-primary-500/25 backdrop-blur-md shadow-xl shadow-black/5 dark:shadow-black/20"
		>
			<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
				<div>
					<h3 class="font-semibold text-sm text-primary-700 dark:text-primary-400">
						Adicionar Todos os Servidores do Expediente
					</h3>
					<p class="text-xs text-surface-500 mt-1">
						Adiciona automaticamente todos os servidores cadastrados com regime de expediente (ou ambos) da {escala.lotacao} que ainda não estão na escala.
					</p>
				</div>
				<button
					class="btn preset-filled-primary-500 shrink-0 font-semibold flex items-center gap-2"
					onclick={adicionarTodos}
					disabled={adicionandoTodos}
				>
					{#if adicionandoTodos}<Spinner size="md" />{/if}
					{adicionandoTodos ? 'Adicionando...' : '+ Adicionar Todos'}
				</button>
			</div>
		</div>
	{/if}

	<!-- Gerar próximo mês (apenas para escalas mensais de plantão ou expediente) -->
	{#if escala.tipo === 'plantao' || escala.tipo === 'expediente'}
		<div
			class="p-4 sm:p-5 mb-4 rounded-3xl bg-surface-100/80 dark:bg-surface-800/60 backdrop-blur-md border border-surface-200 dark:border-white/10 shadow-xl shadow-black/5 dark:shadow-black/20"
		>
			<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
				<div>
					<h3 class="font-semibold text-sm text-surface-700 dark:text-surface-300">
						Gerar Escala do Próximo Mês
					</h3>
					<p class="text-xs text-surface-500 mt-1 max-w-lg">
						{#if escala.tipo === 'plantao'}
							Cria a escala de plantão do próximo mês calculando automaticamente os dias de cada servidor pela rotação detectada (1x3 ou 2x6) a partir desta escala.
						{:else}
							Cria a escala de expediente do próximo mês com os mesmos servidores desta escala.
						{/if}
					</p>
				</div>
				<button
					class="btn preset-outlined-primary-500 shrink-0 font-semibold flex items-center gap-2"
					onclick={gerarProximoMes}
					disabled={gerandoProximoMes}
				>
					{#if gerandoProximoMes}<Spinner size="md" />{/if}
					{gerandoProximoMes ? 'Gerando...' : 'Gerar Próximo Mês →'}
				</button>
			</div>
		</div>
	{/if}

	<!-- Add form -->
	{#if !documentoAssinadoInfo}
	<div
		class="p-4 sm:p-6 mb-4 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20"
	>

		<h3 class="font-semibold text-sm mb-3">Adicionar DPC/OIP à Escala</h3>
		{#if escala.tipo === 'plantao'}
			<!-- Plantão: form com cálculo automático de datas -->
			<form onsubmit={adicionarPlantao}>
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
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
								<option value={String(p.id)}>{p.nome}{p.lotacao ? " — " + p.lotacao : ""}</option>
							{/each}
						</select>
					</label>
					<label class="label">
						<span class="label-text">Equipe</span>
						<select class="select" bind:value={addEquipe}>
							<option value="1">Equipe 1</option>
							<option value="2">Equipe 2</option>
							<option value="3">Equipe 3</option>
							<option value="4">Equipe 4</option>
							<option value="5">Equipe 5</option>
						</select>
					</label>
					<label class="label">
						<span class="label-text">Tipo de Escala</span>
						<select class="select" bind:value={addTipoEscala}>
							<option value="1x3">1×3 — 24h serviço, 3 dias folga</option>
							<option value="2x6">2×6 — 48h serviço, 6 dias folga</option>
						</select>
					</label>
				</div>
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
					<label class="label">
						<span class="label-text">Primeiro plantão do mês</span>
						<input type="date" class="input" bind:value={addPrimeiroPlantao} min={escala.data_inicio} max={escala.data_fim} required />
					</label>
					<div class="flex flex-col gap-1">
						<span class="label-text text-xs">Hora Entrada</span>
						<div class="flex gap-1">
							<select class="select flex-1" bind:value={addHoraEntrada}>
								{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
							</select>
							<select class="select flex-1" bind:value={addMinutoEntrada}>
								{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
							</select>
						</div>
					</div>
					<div class="flex flex-col gap-1">
						<span class="label-text text-xs">Hora Saída</span>
						<div class="flex gap-1">
							<select class="select flex-1" bind:value={addHoraSaida}>
								{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
							</select>
							<select class="select flex-1" bind:value={addMinutoSaida}>
								{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
							</select>
						</div>
					</div>
				</div>
				{#if addPrimeiroPlantao}
					{@const datasCalc = calcularDatasPlantao(addPrimeiroPlantao, addTipoEscala)}
					<div class="mb-4">
						<p class="text-xs font-semibold text-surface-600 dark:text-surface-400 mb-2">
							Dias de plantão calculados ({addDatasSelecionadas.length} selecionados — desmarque para férias/licença):
						</p>
						<div class="flex flex-wrap gap-2">
							{#each datasCalc as d (d)}
								{@const dia = d.split('-')[2]}
								{@const selecionada = addDatasSelecionadas.includes(d)}
								<button
									type="button"
									class="px-3 py-1.5 rounded-lg text-sm font-semibold border-2 transition-all {selecionada ? 'bg-primary-500 text-white border-primary-500' : 'bg-surface-100 dark:bg-surface-800 text-surface-400 border-surface-200 line-through'}"
									onclick={() => toggleDataPlantao(d)}
								>
									{dia}
								</button>
							{/each}
						</div>
					</div>
				{/if}
				<button
					type="submit"
					class="btn preset-filled-primary-500"
					disabled={adding || !policialId || addDatasSelecionadas.length === 0}
				>
					{#if adding}<Spinner size="sm" />{/if}
					{adding ? 'Adicionando...' : '+ Adicionar à Escala de Plantão'}
				</button>
			</form>
		{:else}
			<!-- Expediente / FDS: form com data única -->
			<form onsubmit={adicionar}>
				<div
					class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end"
				>
					<label class="label">
						<span class="label-text">Cargo</span>
						<select
							class="select"
							bind:value={cargoBusca}
							onchange={() => {
								policialId = "";
							}}
						>
							<option value="">Selecione...</option>
							<option value="DPC"
								>DPC - Delegado de Polícia Civil</option
							>
							<option value="OIP"
								>OIP - Oficial Investigador de Polícia</option
							>
						</select>
					</label>
					<label class="label">
						<span class="label-text">Servidor</span>
						<select
							class="select"
							bind:value={policialId}
							disabled={!cargoBusca}
						>
							<option value="">Selecione...</option>
							{#each policialsFiltrados as p (p.id)}
								<option value={String(p.id)}
									>{p.nome}{p.lotacao
										? " — " + p.lotacao
										: ""}</option
								>
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
					<div class="flex flex-col gap-1">
						<span class="label-text text-xs">Entrada</span>
						<div class="flex gap-1">
							<select class="select flex-1" bind:value={addHoraEntrada}>
								{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
							</select>
							<select class="select flex-1" bind:value={addMinutoEntrada}>
								{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
							</select>
						</div>
					</div>
					<div class="flex flex-col gap-1">
						<span class="label-text text-xs">Saída</span>
						<div class="flex gap-1">
							<select class="select flex-1" bind:value={addHoraSaida}>
								{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
							</select>
							<select class="select flex-1" bind:value={addMinutoSaida}>
								{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
							</select>
						</div>
					</div>
					<div class="lg:col-span-1">
						<button
							type="submit"
							class="btn preset-filled-primary-500 w-full"
							disabled={adding || !policialId || !dataPlantao}
						>
							{#if adding}<Spinner size="sm" />{/if}
							{adding ? "Adicionando..." : "Adicionar"}
						</button>
					</div>
				</div>
			</form>
		{/if}
	</div>
	{/if}

	<!-- Policiais list -->
	{#if policiaisEscala.length === 0}
		<div class="card p-8 text-center text-surface-500">
			<p>Nenhum policial na escala. Adicione policiais acima.</p>
		</div>
	{:else if escala.tipo === 'plantao'}
		<!-- Plantão: agrupado por equipe -->
		{#each [...agruparPorEquipe(policiaisEscala)] as [equipe, itens] (equipe)}
			<div
				class="p-4 overflow-hidden mb-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border-2 border-primary-500/20 shadow-xl shadow-black/5 dark:shadow-black/20"
			>
				<h4 class="font-bold text-primary-700 dark:text-primary-400 text-sm mb-3 uppercase tracking-wide">
					{equipe ? `Equipe ${equipe}` : 'Sem Equipe Definida'}
				</h4>
				<!-- Desktop table -->
				<div class="table-wrap hidden md:block">
					<table class="table">
						<thead>
							<tr>
								<th>Nome</th>
								<th>Matrícula</th>
								<th>Cargo</th>
								<th>Telefone</th>
								<th class="text-center">Dias de Plantão</th>
								<th class="text-right">Ações</th>
							</tr>
						</thead>
						<tbody>
							{#each agruparPorServidor(itens) as g (g.policial_id)}
								{@const expandido = servidoresExpandidos.has(g.policial_id)}
								<tr class={expandido ? 'bg-surface-50 dark:bg-surface-800/30' : ''}>
									<td class="font-semibold">{g.nome}</td>
									<td>{g.matricula}</td>
									<td>
										<span class="badge text-xs {g.cargo === 'DPC' ? 'preset-filled-primary-500' : 'preset-filled-warning-500'}">{g.cargo}</span>
									</td>
									<td>{g.telefone}</td>
									<td>
										<div class="flex flex-wrap gap-1 justify-center max-w-[400px] mx-auto">
											{#each datasDoPlantao(escala) as dataISO}
												{@const item = g.itens.find(i => i.data_plantao === dataISO)}
												{@const dia = dataISO.split('-')[2]}
												<button
													class="w-7 h-7 flex items-center justify-center rounded-md text-[10px] font-bold transition-all border {item ? 'bg-primary-500 text-white border-primary-500' : 'bg-surface-100 dark:bg-surface-800 text-surface-400 border-surface-200'}"
													onclick={() => toggleDiaServidor(g, dataISO)}
													title={item ? `Remover dia ${dia}` : `Adicionar dia ${dia}`}
												>
													{dia}
												</button>
											{/each}
										</div>
									</td>
									<td class="text-right">
										<button 
											class="btn btn-sm {expandido ? 'preset-filled-surface' : 'preset-outlined-primary-500'}" 
											onclick={() => toggleExpandirServidor(g.policial_id)}
										>
											{expandido ? 'Recolher' : 'Ver Detalhes'}
										</button>
									</td>
								</tr>
								{#if expandido}
									{#each g.itens as p (p.id)}
										<tr class="bg-surface-100/50 dark:bg-surface-800/20 border-l-4 border-l-primary-500">
											<td colspan="5" class="pl-8 py-3">
												<div class="flex flex-wrap items-center gap-6 text-sm">
													<div class="flex items-center gap-2">
														<span class="font-bold text-surface-500">DATA:</span>
														<span class="bg-surface-200 dark:bg-surface-700 px-2 py-0.5 rounded font-mono">{formatarData(p.data_plantao)}</span>
													</div>
													<div class="flex items-center gap-2">
														<span class="font-bold text-surface-500">HORÁRIO:</span>
														<span>{formatarHorario(p)}</span>
													</div>
													{#if p.observacoes}
														<div class="flex items-center gap-2 flex-1">
															<span class="font-bold text-surface-500">OBS:</span>
															<span class="italic text-surface-600 dark:text-surface-400 truncate max-w-md">{p.observacoes}</span>
														</div>
													{/if}
												</div>
											</td>
											<td class="text-right">
												<div class="flex justify-end gap-2">
													<button class="btn btn-sm btn-icon preset-outlined-primary-500" onclick={() => startEdit(p)} title="Editar" aria-label="Editar">
														<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
													</button>
													<button class="btn btn-sm btn-icon preset-filled-error-500" onclick={() => solicitarRemocao(p.id, p.nome)} title="Remover" aria-label="Remover">
														<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
													</button>
												</div>
											</td>
										</tr>
										{#if editingId === p.id}
											<tr class="bg-surface-200 dark:bg-surface-700">
												<td colspan="6" class="p-4">
													<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
														<div class="space-y-2">
															<label class="label"><span class="label-text text-xs">Entrada</span>
																<div class="flex gap-1"><input type="date" bind:value={editDataEntrada} class="input text-sm flex-1" /><select bind:value={editHoraEntrada} class="select text-sm w-16">{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select><select bind:value={editMinutoEntrada} class="select text-sm w-16">{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}</select></div>
															</label>
														</div>
														<div class="space-y-2">
															<label class="label"><span class="label-text text-xs">Saída</span>
																<div class="flex gap-1"><input type="date" bind:value={editDataSaida} class="input text-sm flex-1" /><select bind:value={editHoraSaida} class="select text-sm w-16">{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select><select bind:value={editMinutoSaida} class="select text-sm w-16">{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}</select></div>
															</label>
														</div>
														<div class="space-y-2">
															<label class="label"><span class="label-text text-xs">Observações</span><textarea bind:value={editObservacoes} class="input text-sm w-full" rows="2"></textarea></label>
															<div class="flex justify-end gap-2">
																<button class="btn btn-sm preset-filled-primary-500" disabled={salvandoEdicao} onclick={() => salvarEdicao(p.id)}>{#if salvandoEdicao}<Spinner size="xs" />{/if}{salvandoEdicao ? 'Salvando...' : 'Salvar'}</button>
																<button class="btn btn-sm preset-outlined-primary-500" disabled={salvandoEdicao} onclick={cancelEdit}>Cancelar</button>
															</div>
														</div>
													</div>
												</td>
											</tr>
										{/if}
									{/each}
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
				<!-- Mobile cards -->
				<div class="md:hidden space-y-4">
					{#each agruparPorServidor(itens) as g (g.policial_id)}
						{@const expandido = servidoresExpandidos.has(g.policial_id)}
						<div class="p-4 rounded-3xl bg-white/90 dark:bg-surface-900 border-2 {expandido ? 'border-primary-500' : 'border-surface-200/50 dark:border-white/10'} shadow-lg transition-all">
							<div class="flex items-center justify-between mb-4">
								<div>
									<span class="font-bold text-base block text-surface-900 dark:text-white">{g.nome}</span>
									<span class="text-xs text-surface-500 font-medium">{g.matricula} &bull; {g.cargo}</span>
								</div>
								<button 
									class="btn btn-sm btn-icon {expandido ? 'preset-filled-surface' : 'preset-outlined-primary-500'} rounded-full" 
									onclick={() => toggleExpandirServidor(g.policial_id)}
								>
									{#if expandido}
										<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg>
									{:else}
										<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
									{/if}
								</button>
							</div>
							
							<div class="flex flex-wrap gap-1.5 mb-2">
								{#each datasDoPlantao(escala) as dataISO}
									{@const item = g.itens.find(i => i.data_plantao === dataISO)}
									{@const dia = dataISO.split('-')[2]}
									<button
										class="w-8 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all border {item ? 'bg-primary-500 text-white border-primary-500' : 'bg-surface-100 dark:bg-surface-800 text-surface-400 border-surface-200'}"
										onclick={() => toggleDiaServidor(g, dataISO)}
									>
										{dia}
									</button>
								{/each}
							</div>
							<p class="text-[10px] text-surface-400 mb-4 italic text-center">Toque nos dias para adicionar ou remover da escala</p>

							{#if expandido}
								<div class="mt-4 pt-4 border-t border-surface-200 dark:border-white/10 space-y-4">
									<h5 class="text-xs font-bold text-surface-500 uppercase tracking-widest px-1">Detalhamento dos Plantões</h5>
									{#each g.itens as p (p.id)}
										<div class="bg-surface-100/50 dark:bg-surface-800/40 p-4 rounded-2xl border border-surface-200 dark:border-white/5 space-y-3">
											<div class="flex justify-between items-center">
												<span class="font-bold text-primary-600 dark:text-primary-400">{formatarData(p.data_plantao)}</span>
												<div class="flex gap-2">
													<button class="btn btn-sm btn-icon preset-outlined-primary-500 rounded-lg" onclick={() => startEdit(p)} title="Editar" aria-label="Editar">
														<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
													</button>
													<button class="btn btn-sm btn-icon preset-filled-error-500 rounded-lg" onclick={() => solicitarRemocao(p.id, p.nome)} title="Remover" aria-label="Remover">
														<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
													</button>
												</div>
											</div>
											<div class="grid grid-cols-1 gap-1 text-sm">
												<div class="flex items-center gap-2"><span class="text-surface-500 font-semibold w-20">Horário:</span><span>{formatarHorario(p)}</span></div>
												{#if p.observacoes}
													<div class="flex items-start gap-2"><span class="text-surface-500 font-semibold w-20">Obs:</span><span class="italic text-surface-600 dark:text-surface-400 flex-1">{p.observacoes}</span></div>
												{/if}
											</div>
											{#if editingId === p.id}
												<div class="mt-4 p-4 bg-surface-200 dark:bg-surface-700 rounded-xl space-y-4">
													<label class="label"><span class="label-text text-xs">Entrada</span><div class="flex gap-1"><input type="date" bind:value={editDataEntrada} class="input text-sm flex-1" /><select bind:value={editHoraEntrada} class="select text-sm w-16">{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select><select bind:value={editMinutoEntrada} class="select text-sm w-16">{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}</select></div></label>
													<label class="label"><span class="label-text text-xs">Saída</span><div class="flex gap-1"><input type="date" bind:value={editDataSaida} class="input text-sm flex-1" /><select bind:value={editHoraSaida} class="select text-sm w-16">{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select><select bind:value={editMinutoSaida} class="select text-sm w-16">{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}</select></div></label>
													<label class="label"><span class="label-text text-xs">Observações</span><textarea bind:value={editObservacoes} class="input text-sm w-full" rows="2"></textarea></label>
													<div class="flex justify-end gap-2"><button class="btn btn-sm preset-filled-primary-500" disabled={salvandoEdicao} onclick={() => salvarEdicao(p.id)}>{#if salvandoEdicao}<Spinner size="xs" />{/if}{salvandoEdicao ? 'Salvando...' : 'Salvar'}</button><button class="btn btn-sm preset-outlined-primary-500" disabled={salvandoEdicao} onclick={cancelEdit}>Cancelar</button></div>
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/each}
	{:else}
		<!-- Expediente / FDS: agrupado por data -->
		{#each [...agruparPorData(policiaisEscala)] as [dataGrupo, policiais] (dataGrupo)}
			<!-- Desktop table -->
			<div
				class="p-4 overflow-hidden mb-6 hidden md:block rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border-2 border-surface-200 dark:border-white/15 shadow-xl shadow-black/5 dark:shadow-black/20"
			>
				<div class="table-wrap">
					<table class="table">
						<thead>
							<tr>
								<th>Nome</th>
								<th>Matrícula</th>
								<th>Cargo</th>
								<th>Telefone</th>
								<th>Classe</th>
								<th>Lotação</th>
								<th>Data</th>
								<th>Horário</th>
								<th>Observações</th>
								<th>Ações</th>
							</tr>
						</thead>
						<tbody>
							{#each policiais as p (p.id)}
								<tr>
									<td>{p.nome}</td>
									<td>{p.matricula}</td>
									<td>
										<span
											class="badge text-xs {p.cargo === 'DPC'
												? 'preset-filled-primary-500'
												: 'preset-filled-warning-500'}"
										>
											{p.cargo}
										</span>
									</td>
									<td>{p.telefone}</td>
									<td class="text-xs text-surface-500">{p.classe || '—'}</td>
									<td>{p.lotacao}</td>
									{#if editingId === p.id}
										<td
											colspan="3"
											class="bg-surface-200 dark:bg-surface-800 rounded-lg"
										>
											<div class="flex flex-col gap-2 py-1">
												<div class="flex items-center gap-2">
													<span class="text-xs font-semibold text-surface-500 w-14">Entrada:</span>
													<input type="date" bind:value={editDataEntrada} class="input text-sm flex-1 min-w-[120px]" />
													<div class="flex gap-1">
														<select bind:value={editHoraEntrada} class="select text-sm w-16">
															{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
														</select>
														<select bind:value={editMinutoEntrada} class="select text-sm w-16">
															{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
														</select>
													</div>
												</div>
												<div class="flex items-center gap-2">
													<span class="text-xs font-semibold text-surface-500 w-14">Saída:</span>
													<input type="date" bind:value={editDataSaida} class="input text-sm flex-1 min-w-[120px]" />
													<div class="flex gap-1">
														<select bind:value={editHoraSaida} class="select text-sm w-16">
															{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
														</select>
														<select bind:value={editMinutoSaida} class="select text-sm w-16">
															{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
														</select>
													</div>
												</div>
												<p class="text-xs text-surface-500 italic">
													{editPreviewData()} &bull; {editHoraEntrada}:{editMinutoEntrada}H A {editHoraSaida}:{editMinutoSaida}H
												</p>
												<div>
													<span class="text-xs font-semibold text-surface-500">Observações:</span>
													<textarea bind:value={editObservacoes} class="input text-sm w-full mt-1 min-h-[48px] resize-y" placeholder="Férias, licenças, dispensas..." rows="2"></textarea>
												</div>
												<div class="flex gap-1">
													<button class="btn btn-sm preset-filled-primary-500" disabled={salvandoEdicao} onclick={() => salvarEdicao(p.id)}>{#if salvandoEdicao}<Spinner size="xs" />{/if}{salvandoEdicao ? 'Salvando...' : 'Salvar'}</button>
													<button class="btn btn-sm preset-outlined-primary-500" disabled={salvandoEdicao} onclick={cancelEdit}>Cancelar</button>
												</div>
											</div>
										</td>
									{:else}
										<td>
											<button
												class="border border-dashed border-surface-300 rounded px-2 py-1 text-sm w-full text-center hover:border-primary-500 hover:bg-surface-100 transition-colors"
												onclick={() => startEdit(p)}
												title="Clique para editar"
											>
												{formatarDataPlantao(p)}
											</button>
										</td>
										<td>
											<button
												class="border border-dashed border-surface-300 rounded px-2 py-1 text-sm w-full text-center hover:border-primary-500 hover:bg-surface-100 transition-colors"
												onclick={() => startEdit(p)}
												title="Clique para editar"
											>
												{formatarHorario(p)}
											</button>
										</td>
										<td>
											<button
												class="border border-dashed border-surface-300 rounded px-2 py-1 text-sm w-full text-left hover:border-primary-500 hover:bg-surface-100 transition-colors text-xs"
												onclick={() => startEdit(p)}
												title="Clique para editar"
											>
												{p.observacoes || '-'}
											</button>
										</td>
									{/if}
									<td>
										<button
											class="btn btn-sm preset-filled-error-500"
											onclick={() => solicitarRemocao(p.id, p.nome)}
										>
											Remover
										</button>
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
					<div
						class="p-4 mb-4 rounded-2xl bg-surface-100/50 dark:bg-surface-800/50 border-2 border-surface-200 dark:border-white/15 hover:border-primary-500/40 transition-colors"
					>
						<div class="flex items-center justify-between mb-2">
							<span class="font-semibold text-sm">{p.nome}</span>
							<span
								class="badge text-xs {p.cargo === 'DPC'
									? 'preset-filled-primary-500'
									: 'preset-filled-warning-500'}"
								>{p.cargo}</span
							>
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
								<span class="text-surface-500">Classe</span>
								<span class="text-xs text-surface-500">{p.classe || '—'}</span>
							</div>
							<div class="flex justify-between">
								<span class="text-surface-500">Lotação</span>
								<span>{p.lotacao}</span>
							</div>
						</div>

						{#if editingId === p.id}
							<div
								class="bg-surface-200 dark:bg-surface-800 rounded-lg p-3 space-y-2 mb-3"
							>
								<div class="grid grid-cols-2 gap-2">
									<label class="label">
										<span class="label-text text-xs"
											>Data entrada</span
										>
										<input
											type="date"
											bind:value={editDataEntrada}
											class="input text-sm"
										/>
									</label>
									<label class="label">
										<span class="label-text text-xs"
											>Hora entrada</span
										>
										<div class="flex gap-1">
											<select
												bind:value={editHoraEntrada}
												class="select text-sm flex-1"
											>
												{#each horas as h (h)}<option
														value={h}>{h}h</option
													>{/each}
											</select>
											<select
												bind:value={editMinutoEntrada}
												class="select text-sm flex-1"
											>
												{#each minutos as m (m)}<option
														value={m}>{m}m</option
													>{/each}
											</select>
										</div>
									</label>
								</div>
								<div class="grid grid-cols-2 gap-2">
									<label class="label">
										<span class="label-text text-xs"
											>Data saída</span
										>
										<input
											type="date"
											bind:value={editDataSaida}
											class="input text-sm"
										/>
									</label>
									<label class="label">
										<span class="label-text text-xs"
											>Hora saída</span
										>
										<div class="flex gap-1">
											<select
												bind:value={editHoraSaida}
												class="select text-sm flex-1"
											>
												{#each horas as h (h)}<option
														value={h}>{h}h</option
													>{/each}
											</select>
											<select
												bind:value={editMinutoSaida}
												class="select text-sm flex-1"
											>
												{#each minutos as m (m)}<option
														value={m}>{m}m</option
													>{/each}
											</select>
										</div>
									</label>
								</div>
								<p class="text-xs text-surface-500 italic">
									{editPreviewData()} &bull; {editHoraEntrada}:{editMinutoEntrada}H A {editHoraSaida}:{editMinutoSaida}H
								</p>
								<div>
									<span class="text-xs font-semibold text-surface-500">Observações:</span>
									<textarea bind:value={editObservacoes} class="input text-sm w-full mt-1 min-h-[48px] resize-y" placeholder="Férias, licenças, dispensas..." rows="2"></textarea>
								</div>
								<div class="flex gap-2">
									<button
										class="btn btn-sm preset-filled-primary-500"
										disabled={salvandoEdicao}
										onclick={() => salvarEdicao(p.id)}
									>{#if salvandoEdicao}<Spinner size="xs" />{/if}{salvandoEdicao ? 'Salvando...' : 'Salvar'}</button>
									<button
										class="btn btn-sm preset-outlined-primary-500"
										disabled={salvandoEdicao}
										onclick={cancelEdit}>Cancelar</button
									>
								</div>
							</div>
						{:else}
							{#if p.observacoes}
								<div class="text-xs text-surface-500 italic mb-2">{p.observacoes}</div>
							{/if}
							<div class="flex gap-2 mb-3">
								<button
									class="flex-1 border border-dashed border-surface-300 rounded px-2 py-2 text-sm text-center hover:border-primary-500 transition-colors"
									onclick={() => startEdit(p)}
								>
									{formatarDataPlantao(p)}
								</button>
								<button
									class="flex-1 border border-dashed border-surface-300 rounded px-2 py-2 text-sm text-center hover:border-primary-500 transition-colors"
									onclick={() => startEdit(p)}
								>
									{formatarHorario(p)}
								</button>
							</div>
						{/if}

						<div class="flex justify-end">
							<button
								class="btn btn-sm preset-filled-error-500"
								onclick={() => solicitarRemocao(p.id, p.nome)}
								>Remover</button
							>
						</div>
					</div>
				{/each}
			</div>
		{/each}
	{/if}
{/if}
