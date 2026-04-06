<script lang="ts">
	import type { Policial, Unidade } from "$lib/types";
	import { page } from "$app/state";
	import { toaster } from "$lib/toast";
	import Spinner from "$lib/components/Spinner.svelte";
	import { Dialog } from "@skeletonlabs/skeleton-svelte";
	import { browser } from "$app/environment";
	import { formatarTelefone, formatarCPF, limparCPF } from "$lib/utils";
	import { policialSchema } from "$lib/schemas/policial";
	import { csrfHeaders } from "$lib/csrf";

	const isAdmin = $derived(page.data.usuario?.tipo === "admin");

	let policiais = $state<Policial[]>([]);
	let loading = $state(true);
	let unidades = $state<Unidade[]>([]);
	// Paginação
	let paginaAtual = $state(1);
	let totalPaginas = $state(1);
	let totalPoliciais = $state(0);
	const ITEMS_POR_PAGINA = 20;

	// Recuperar filtros do localStorage (apenas no navegador)
	const KEY = "filtros_policiais";
	const saved = browser ? JSON.parse(localStorage.getItem(KEY) || "{}") : {};

	let filtroLotacao = $state(saved.lotacao || "");
	let filtroCargo = $state(saved.cargo || "");
	let filtroSeccional = $state<number | "todas">(saved.seccional || "todas");
	let filtroBusca = $state(saved.busca || "");

	// Salvar filtros no localStorage a cada mudança
	$effect(() => {
		if (browser) {
			localStorage.setItem(
				KEY,
				JSON.stringify({
					lotacao: filtroLotacao,
					cargo: filtroCargo,
					seccional: filtroSeccional,
					busca: filtroBusca,
				}),
			);
		}
	});

	const seccionais = $derived(unidades.filter((u) => u.tipo === "seccional"));
	const delegaciasDropdown = $derived(
		filtroSeccional === "todas"
			? unidades.filter((u) => u.tipo === "delegacia")
			: unidades.filter(
					(u) =>
						u.tipo === "delegacia" &&
						u.seccional_id === filtroSeccional,
				),
	);

	let dialogOpen = $state(false);
	let policialParaExcluir = $state<{ id: number; nome: string } | null>(null);

	// Special sentinel value for "sem lotação" filter
	const SEM_LOTACAO = "__sem_lotacao__";
	const TODAS_UNIDADES = "__todas__";

	// Cadastro
	let cadastroOpen = $state(false);
	let nome = $state("");
	let matricula = $state("");
	let cargo = $state<"DPC" | "OIP">("OIP");
	let cpf = $state("");
	let telefone = $state("");
	let classe = $state("");
	let regime = $state<"plantao" | "expediente" | "ambos">("ambos");
	let lotacaoInput = $state("");
	let email = $state("");
	let saving = $state(false);
	let excluindo = $state(false);

	// Papel administrativo no cadastro
	let papel = $state<string | null>(null);
	let papelUnidadeId = $state<number | null>(null);

	const isAdminOrSeccional = $derived(
		page.data.usuario?.tipo === "admin" ||
			page.data.usuario?.papel === "admin_seccional",
	);
	const isAdminUnidade = $derived(
		page.data.usuario?.papel === "admin_unidade",
	);
	const seccionaisParaPapel = $derived(
		unidades.filter((u: any) => u.tipo === "seccional"),
	);
	const unidadesParaAdmin = $derived(
		unidades.filter((u: any) => u.tipo !== "seccional"),
	);

	$effect(() => {
		if (cadastroOpen) {
			lotacaoInput = isAdmin ? "" : (page.data.usuario?.lotacao ?? "");
		}
	});

	const classesDisponiveis = $derived(
		cargo === "DPC"
			? ["1", "2", "3", "Especial"]
			: [
					"D - I",
					"D - II",
					"C - I",
					"C - II",
					"C - III",
					"C - IV",
					"C - V",
					"C - VI",
					"C - VII",
					"B - I",
					"B - II",
					"B - III",
					"B - IV",
					"B - V",
					"B - VI",
					"B - VII",
					"A - I",
					"A - II",
					"A - III",
					"A - IV",
				],
	);

	function resetForm() {
		nome = "";
		matricula = "";
		cargo = "OIP";
		cpf = "";
		telefone = "";
		classe = "";
		regime = "ambos";
		lotacaoInput = isAdmin ? "" : (page.data.usuario?.lotacao ?? "");
		email = "";
		papel = null;
		papelUnidadeId = null;
	}

	async function salvar(e: Event) {
		e.preventDefault();

		const parsed = policialSchema.safeParse({
			nome,
			matricula,
			cargo,
			cpf: limparCPF(cpf),
			telefone,
			lotacao: lotacaoInput,
			regime,
			classe,
			papel: papel || null,
			papel_unidade_id: papelUnidadeId || null,
			email: email || null,
		});
		if (!parsed.success) {
			toaster.create({
				title: parsed.error.issues[0].message,
				type: "error",
			});
			return;
		}

		saving = true;
		try {
			const res = await fetch("/api/policiais", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...csrfHeaders(),
				},
				body: JSON.stringify({
					nome,
					matricula,
					cargo,
					cpf: limparCPF(cpf),
					telefone,
					lotacao: lotacaoInput,
					regime,
					classe,
					papel: papel || null,
					papel_unidade_id: papelUnidadeId || null,
					email: email || null,
				}),
			});

			if (res.ok) {
				toaster.create({
					title: "Policial cadastrado com sucesso!",
					type: "success",
				});
				resetForm();
				cadastroOpen = false;
				carregarPoliciais();
			} else {
				const data = await res.json();
				toaster.create({
					title: data.error || "Erro ao cadastrar",
					type: "error",
				});
			}
		} catch {
			toaster.create({ title: "Erro de conexão", type: "error" });
		} finally {
			saving = false;
		}
	}

	const policiaisExibidos = $derived(
		policiais.filter((p) => {
			if (filtroCargo && p.cargo !== filtroCargo) return false;
			if (
				filtroBusca &&
				!p.nome.toLowerCase().includes(filtroBusca.toLowerCase())
			)
				return false;
			return true;
		}),
	);

	$effect(() => {
		// Resetar para página 1 ao filtrar
		if (filtroCargo || filtroBusca || filtroLotacao || filtroSeccional) {
			paginaAtual = 1;
		}
	});

	async function carregarPoliciais() {
		if (isAdmin && !filtroLotacao) {
			policiais = [];
			loading = false;
			return;
		}
		if (isAdmin && filtroLotacao === TODAS_UNIDADES) {
			loading = true;
			const params = new URLSearchParams();
			if (filtroBusca) params.set("busca", filtroBusca);
			params.set("page", String(paginaAtual));
			params.set("limit", String(ITEMS_POR_PAGINA));
			const res = await fetch(`/api/policiais?${params.toString()}`);
			const resultado = await res.json();
			policiais = resultado.policiais ?? resultado;
			totalPaginas = resultado.totalPages ?? 1;
			totalPoliciais =
				resultado.total ?? resultado.policiais?.length ?? 0;
			loading = false;
			return;
		}

		loading = true;
		const params = new URLSearchParams();
		if (filtroLotacao === SEM_LOTACAO) {
			params.set("sem_lotacao", "1");
		} else if (filtroLotacao) {
			params.set("lotacao", filtroLotacao);
		}
		if (filtroBusca) {
			params.set("busca", filtroBusca);
		}
		params.set("page", String(paginaAtual));
		params.set("limit", String(ITEMS_POR_PAGINA));

		const res = await fetch(`/api/policiais?${params.toString()}`);
		const resultado = await res.json();
		policiais = resultado.policiais ?? resultado;
		totalPaginas = resultado.totalPages ?? 1;
		totalPoliciais = resultado.total ?? resultado.policiais?.length ?? 0;
		loading = false;
	}

	async function carregarUnidades() {
		const res = await fetch("/api/unidades");
		unidades = await res.json();
	}

	function solicitarExclusao(id: number, nome: string) {
		policialParaExcluir = { id, nome };
		dialogOpen = true;
	}

	async function confirmarExclusao() {
		if (!policialParaExcluir) return;
		excluindo = true;
		const id = policialParaExcluir.id;
		const nome = policialParaExcluir.nome;
		try {
			const res = await fetch(`/api/policiais/${id}`, {
				method: "DELETE",
				headers: csrfHeaders(),
			});
			if (res.ok) {
				toaster.create({
					title: `${nome} removido com sucesso`,
					type: "success",
				});
				policiais = policiais.filter((p) => p.id !== id);
				dialogOpen = false;
				policialParaExcluir = null;
			} else {
				const data = await res.json();
				toaster.create({
					title: data.error || "Erro ao remover",
					type: "error",
				});
			}
		} catch {
			toaster.create({ title: "Erro de conexão", type: "error" });
		} finally {
			excluindo = false;
		}
	}

	function limparFiltros() {
		filtroLotacao = isAdmin ? "" : page.data.usuario?.lotacao || "";
		filtroCargo = "";
		filtroSeccional = "todas";
		filtroBusca = "";
		paginaAtual = 1;
		carregarPoliciais();
	}

	const temFiltros = $derived(
		filtroLotacao !== (isAdmin ? "" : page.data.usuario?.lotacao || "") ||
			filtroCargo !== "" ||
			filtroSeccional !== "todas" ||
			filtroBusca !== "",
	);

	$effect(() => {
		carregarPoliciais();
		carregarUnidades();
	});
</script>

<div
	class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6"
>
	<h1 class="h1 text-xl font-bold">Gerenciar Policiais</h1>
	<div class="flex flex-wrap gap-2">
		<button
			class="btn btn-sm {temFiltros
				? 'preset-filled-warning-500'
				: 'preset-outlined-primary-500 opacity-40'}"
			onclick={limparFiltros}
			disabled={!temFiltros && !loading}
		>
			Limpar filtros
		</button>
		{#if isAdmin}
			<a
				href="/policiais/upload"
				class="btn btn-sm preset-outlined-primary-500 hidden sm:inline-flex"
				>Importar Excel</a
			>
		{/if}
		<button
			class="btn btn-sm preset-filled-primary-500"
			onclick={() => {
				resetForm();
				cadastroOpen = true;
			}}>Novo Policial</button
		>
	</div>
</div>

<Dialog
	open={cadastroOpen}
	onOpenChange={(e) => {
		cadastroOpen = e.open;
		if (!e.open) resetForm();
	}}
>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
	>
		<div
			class="card p-5 max-w-2xl w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-5"
				>Cadastrar Novo Policial</Dialog.Title
			>

			<form onsubmit={salvar} class="space-y-3">
				<!-- Linha 1: Nome (7), Matrícula (2), Cargo (3) -->
				<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
					<label class="label sm:col-span-7">
						<span
							class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>Nome completo (Conforme Certificado Digital)</span
						>
						<input
							class="input py-1 px-3 text-sm"
							type="text"
							bind:value={nome}
							required
						/>
					</label>
					<label class="label sm:col-span-2">
						<span
							class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>Matrícula</span
						>
						<input
							class="input py-1 px-3 text-sm"
							type="text"
							bind:value={matricula}
							maxlength="10"
							required
						/>
					</label>
					<label class="label sm:col-span-3">
						<span
							class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>Cargo</span
						>
						<select
							class="select py-1 px-3 text-sm"
							bind:value={cargo}
						>
							<option value="DPC">DPC - Delegado</option>
							<option value="OIP">OIP - Investigador</option>
						</select>
					</label>
				</div>

				<!-- Linha 2: CPF (5), E-mail (7) -->
				<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
					<label class="label sm:col-span-5">
						<span
							class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>CPF (Obrigatório para Token)</span
						>
						<input
							class="input py-1 px-3 text-sm"
							type="text"
							value={cpf}
							oninput={(e) =>
								(cpf = formatarCPF(e.currentTarget.value))}
							placeholder="000.000.000-00"
							maxlength="14"
						/>
					</label>
					<label class="label sm:col-span-7">
						<span
							class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>E-mail (para autenticação de dois fatores)</span
						>
						<input
							class="input py-1 px-3 text-sm"
							type="email"
							bind:value={email}
							placeholder="exemplo@gmail.com"
						/>
					</label>
				</div>

				<!-- Linha 3: Telefone (3), Classe (4), Regime (5) -->
				<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
					<label class="label sm:col-span-3">
						<span
							class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>Telefone</span
						>
						<input
							class="input py-1 px-3 text-sm"
							type="text"
							value={telefone}
							oninput={(e) =>
								(telefone = formatarTelefone(
									e.currentTarget.value,
								))}
							placeholder="(88) 9.0000-0000"
							maxlength="16"
						/>
					</label>
					<label class="label sm:col-span-4">
						<span
							class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>Classe</span
						>
						<select
							class="select py-1 px-3 text-sm"
							bind:value={classe}
							required
						>
							<option value="" disabled>-</option>
							{#each classesDisponiveis as c}
								<option value={c}>{c}</option>
							{/each}
						</select>
					</label>
					<label class="label sm:col-span-5">
						<span
							class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>Regime de Trabalho</span
						>
						<select
							class="select py-1 px-3 text-sm"
							bind:value={regime}
						>
							<option value="ambos">Plantão e Expediente</option>
							<option value="plantao">Somente Plantão</option>
							<option value="expediente"
								>Somente Expediente</option
							>
						</select>
					</label>
				</div>

				<!-- Linha 4: Lotação (12) -->
				<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
					<label class="label sm:col-span-12">
						<span
							class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1"
							>Lotação</span
						>
						{#if isAdmin}
							<select
								class="select py-1 px-3 text-sm"
								bind:value={lotacaoInput}
							>
								<option value="">— Sem lotação —</option>
								{#each unidades as u (u.id)}
									<option value={u.nome}>{u.nome}</option>
								{/each}
							</select>
						{:else}
							<input
								class="input py-1 px-3 text-sm bg-surface-200 dark:bg-surface-800 cursor-not-allowed opacity-75"
								type="text"
								value={lotacaoInput}
								readonly
							/>
						{/if}
					</label>
				</div>

				{#if isAdminOrSeccional || isAdminUnidade}
					<div
						class="p-3 rounded-xl bg-surface-500/5 border border-surface-500/10 space-y-3 mt-1"
					>
						<h4
							class="text-[0.7rem] font-bold uppercase opacity-50"
						>
							Papel Administrativo (Opcional)
						</h4>
						<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
							<label class="label sm:col-span-5">
								<span
									class="label-text text-[0.7rem] font-bold opacity-70 ml-1"
									>Papel</span
								>
								<select
									class="select py-1 px-3 text-sm"
									bind:value={papel}
								>
									<option value={null}
										>Servidor (sem papel)</option
									>
									{#if isAdminOrSeccional}
										<option value="admin_seccional"
											>Admin Seccional</option
										>
									{/if}
									<option value="admin_unidade"
										>Admin Unidade</option
									>
								</select>
							</label>
							{#if papel && !(isAdminUnidade && papel === "admin_unidade")}
								<label class="label sm:col-span-7">
									<span
										class="label-text text-[0.7rem] font-bold opacity-70 ml-1"
									>
										{papel === "admin_seccional"
											? "Seccional de resp."
											: "Unidade de resp."}
									</span>
									<select
										class="select py-1 px-3 text-sm"
										bind:value={papelUnidadeId}
									>
										<option value={null}
											>Selecionar...</option
										>
										{#each papel === "admin_seccional" ? seccionaisParaPapel : unidadesParaAdmin as u}
											<option value={u.id}
												>{u.nome}</option
											>
										{/each}
									</select>
								</label>
							{:else if papel === "admin_unidade" && isAdminUnidade}
								<p
									class="text-[0.65rem] text-surface-500 sm:col-span-7 flex items-end pb-2 ml-1 italic"
								>
									Será nomeado para a sua própria unidade.
								</p>
							{/if}
						</div>
					</div>
				{/if}

				<div
					class="flex justify-end gap-2 pt-4 border-t border-surface-200 dark:border-white/5"
				>
					<Dialog.CloseTrigger
						class="btn btn-sm preset-outlined-surface"
						>Cancelar</Dialog.CloseTrigger
					>
					<button
						type="submit"
						class="btn btn-sm preset-filled-primary-500 flex items-center gap-2"
						disabled={saving}
					>
						{#if saving}<Spinner size="sm" />{/if}
						{saving ? "Guardando..." : "Cadastrar"}
					</button>
				</div>
			</form>
		</div>
	</Dialog.Content>
</Dialog>

<Dialog open={dialogOpen} onOpenChange={(e) => (dialogOpen = e.open)}>
	<Dialog.Content
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-sm"
	>
		<div
			class="card p-6 max-w-sm w-full bg-surface-100 dark:bg-surface-900 shadow-2xl rounded-2xl border border-surface-200 dark:border-white/10"
		>
			<Dialog.Title class="h3 font-bold mb-2"
				>Excluir Policial?</Dialog.Title
			>
			<Dialog.Description
				class="text-surface-600 dark:text-surface-400 mb-6"
			>
				Tem certeza que deseja excluir o policial "{policialParaExcluir?.nome}"
				do sistema de cadastro?
			</Dialog.Description>
			<div class="flex justify-end gap-3">
				<Dialog.CloseTrigger
					class="btn preset-outlined-surface"
					disabled={excluindo}>Cancelar</Dialog.CloseTrigger
				>
				<button
					class="btn preset-filled-error-500 flex items-center gap-2"
					onclick={confirmarExclusao}
					disabled={excluindo}
				>
					{#if excluindo}<Spinner size="sm" />{/if}
					{excluindo ? "Excluindo..." : "Excluir"}
				</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog>

<div
	class="p-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20 overflow-hidden mt-6"
>
	<div
		class="flex flex-col sm:flex-row sm:items-end gap-4 mb-8 p-6 rounded-2xl bg-surface-100/30 dark:bg-surface-800/20 border border-surface-200 dark:border-white/10"
	>
		{#if isAdmin}
			<label class="label flex-1 max-w-sm">
				<span class="label-text font-semibold mb-1">Seccional</span>
				<select
					class="select"
					bind:value={filtroSeccional}
					onchange={() => {
						filtroLotacao = "";
						carregarPoliciais();
					}}
				>
					<option value="todas">Todas as Seccionais</option>
					{#each seccionais as sec (sec.id)}
						<option value={sec.id}>{sec.nome}</option>
					{/each}
				</select>
			</label>
			<label class="label flex-1 max-w-sm">
				<span class="label-text font-semibold mb-1"
					>Unidade de Lotação</span
				>
				<select
					class="select"
					bind:value={filtroLotacao}
					onchange={carregarPoliciais}
				>
					<option value="">Selecione uma unidade...</option>
					<option value={TODAS_UNIDADES}>Todas as unidades</option>
					{#each delegaciasDropdown as del (del.id)}
						<option value={del.nome}>{del.nome}</option>
					{/each}
					<option value={SEM_LOTACAO}>— Sem lotação —</option>
				</select>
			</label>
		{/if}
		<label class="label w-full sm:w-48 shrink-0">
			<span class="label-text font-semibold mb-1">Cargo</span>
			<select class="select" bind:value={filtroCargo}>
				<option value="">Todos</option>
				<option value="DPC">DPC — Delegado</option>
				<option value="OIP">OIP — Oficial Investigador</option>
			</select>
		</label>

		<label class="label flex-1 min-w-[200px]">
			<span class="label-text font-semibold mb-1">Buscar por Nome</span>
			<div class="relative">
				<input
					type="text"
					class="input pl-10"
					bind:value={filtroBusca}
					placeholder="Digite um nome..."
				/>
				<div
					class="absolute inset-y-0 left-3 flex items-center pointer-events-none opacity-50"
				>
					<svg
						class="w-4 h-4"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
						/></svg
					>
				</div>
			</div>
		</label>
	</div>
	{#if isAdmin && !filtroLotacao}
		<p class="text-xs text-surface-500 -mt-5 mb-4 italic px-1">
			Selecione uma unidade para visualizar os policiais cadastrados nela.
		</p>
	{/if}

	{#if loading}
		<div
			class="flex flex-col items-center justify-center py-16 gap-3 text-surface-400 dark:text-surface-500"
		>
			<Spinner size="xl" />
			<span class="text-sm">Carregando...</span>
		</div>
	{:else if isAdmin && !filtroLotacao}
		<div class="text-center py-20">
			<div
				class="bg-surface-200/50 dark:bg-surface-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 grayscale opacity-50"
			>
				<svg
					class="w-8 h-8 text-surface-400"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
					/></svg
				>
			</div>
			<p class="text-surface-600 dark:text-surface-400 text-lg">
				Escolha uma unidade para exibir os dados.
			</p>
		</div>
	{:else if policiaisExibidos.length === 0}
		<div class="text-center py-12 text-surface-500">
			<p class="mb-4">
				{filtroCargo
					? `Nenhum policial com cargo ${filtroCargo} encontrado.`
					: "Nenhum policial cadastrado."}
			</p>
			{#if !filtroCargo}
				<a
					href="/policiais"
					class="btn preset-filled-primary-500"
					onclick={(e) => {
						e.preventDefault();
						resetForm();
						cadastroOpen = true;
					}}>Cadastrar Policial</a
				>
			{/if}
		</div>
	{:else}
		<!-- Desktop table -->
		<div class="hidden md:block table-wrap">
			<table class="table">
				<thead>
					<tr>
						<th>Nome</th>
						<th>Matrícula</th>
						<th>Cargo</th>
						<th>Telefone</th>
						<th>Lotação</th>
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
									>{p.cargo}</span
								>
							</td>
							<td>{p.telefone}</td>
							<td>{p.lotacao}</td>
							<td>
								<div class="flex gap-2">
									<a
										href="/policiais/{p.id}"
										class="btn btn-sm preset-outlined-primary-500"
										>Editar</a
									>
									<button
										class="btn btn-sm preset-filled-error-500"
										onclick={() =>
											solicitarExclusao(p.id, p.nome)}
										>Excluir</button
									>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Mobile cards -->
		<div class="md:hidden space-y-3">
			{#each policiais as p (p.id)}
				<div
					class="p-4 rounded-2xl bg-surface-100/50 dark:bg-surface-800/50 border border-surface-200 dark:border-white/10 hover:border-primary-500/30 transition-colors"
				>
					<div class="flex items-center justify-between mb-2">
						<span class="font-semibold text-sm">{p.nome}</span>
						<span
							class="badge text-xs {p.cargo === 'DPC'
								? 'preset-filled-primary-500'
								: 'preset-filled-warning-500'}">{p.cargo}</span
						>
					</div>
					<div class="space-y-1 text-sm mb-3">
						<div class="flex justify-between">
							<span class="text-surface-500">Matrícula</span>
							<span class="text-surface-900 dark:text-surface-100"
								>{p.matricula}</span
							>
						</div>
						<div class="flex justify-between">
							<span class="text-surface-500">Telefone</span>
							<span class="text-surface-900 dark:text-surface-100"
								>{p.telefone}</span
							>
						</div>
						<div class="flex justify-between">
							<span class="text-surface-500">Lotação</span>
							<span
								class="text-right text-surface-900 dark:text-surface-100"
								>{p.lotacao}</span
							>
						</div>
					</div>
					<div
						class="flex gap-2 pt-3 border-t border-surface-200 dark:border-white/5"
					>
						<a
							href="/policiais/{p.id}"
							class="btn btn-sm preset-outlined-primary-500 hover:bg-primary-500/10 hover:-translate-y-0.5 transition-all"
							>Editar</a
						>
						<button
							class="btn btn-sm preset-filled-error-500 hover:-translate-y-0.5 transition-all"
							onclick={() => solicitarExclusao(p.id, p.nome)}
							>Excluir</button
						>
					</div>
				</div>
			{/each}
		</div>

		<div
			class="mt-6 pt-6 border-t border-surface-200 dark:border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4"
		>
			<p class="text-surface-500 text-sm">
				Mostrando <strong
					>{(paginaAtual - 1) * ITEMS_POR_PAGINA + 1}-{Math.min(
						paginaAtual * ITEMS_POR_PAGINA,
						policiaisExibidos.length,
					)}</strong
				>
				de <strong>{policiaisExibidos.length}</strong> policial(is)
			</p>

			{#if totalPaginas > 1}
				<div class="flex items-center gap-2">
					<button
						class="btn btn-sm preset-outlined-surface"
						onclick={() => {
							paginaAtual--;
							window.scrollTo({ top: 0, behavior: "smooth" });
						}}
						disabled={paginaAtual === 1}
					>
						Anterior
					</button>

					<div class="flex items-center gap-1">
						{#each Array.from({ length: totalPaginas }, (_, i) => i + 1) as p}
							{#if totalPaginas <= 5 || p === 1 || p === totalPaginas || (p >= paginaAtual - 1 && p <= paginaAtual + 1)}
								<button
									class="btn btn-sm {paginaAtual === p
										? 'preset-filled-primary-500'
										: 'preset-outlined-surface'} min-w-[32px]"
									onclick={() => {
										paginaAtual = p;
										window.scrollTo({
											top: 0,
											behavior: "smooth",
										});
									}}
								>
									{p}
								</button>
							{:else if (p === 2 && paginaAtual > 3) || (p === totalPaginas - 1 && paginaAtual < totalPaginas - 2)}
								<span class="px-1 opacity-50">...</span>
							{/if}
						{/each}
					</div>

					<button
						class="btn btn-sm preset-outlined-surface"
						onclick={() => {
							paginaAtual++;
							window.scrollTo({ top: 0, behavior: "smooth" });
						}}
						disabled={paginaAtual >= totalPaginas}
					>
						Próxima
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>
