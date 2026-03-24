const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, '..');

let page = fs.readFileSync(path.join(base, 'src/routes/escalas/[id]/+page.svelte'), 'utf8');
const lines = page.split('\r\n');

// ─── 1. Add new state variables after "let gerandoProximoMes = $state(false);" ───
const gerandoLine = lines.findIndex(l => l.trim() === 'let gerandoProximoMes = $state(false);');
console.log('gerandoProximoMes at line:', gerandoLine);
if (gerandoLine >= 0) {
  const newVars = [
    '',
    "\tlet addEquipe = $state('1');",
    "\tlet addTipoEscala = $state<'1x3' | '2x6'>('1x3');",
    "\tlet addPrimeiroPlantao = $state('');",
    "\tlet addDatasSelecionadas = $state<string[]>([]);"
  ];
  lines.splice(gerandoLine + 1, 0, ...newVars);
  console.log('Added state vars');
}

// ─── 2. Add new functions and $effect before "$effect(() => {" (carregar) ───
// After adding vars, we need to find the effect
const effectLine = lines.findIndex(l => l.trim() === '$effect(() => {' && lines[lines.indexOf(l) + 1]?.trim() === 'carregar();');
console.log('$effect(carregar) at line:', effectLine);

if (effectLine >= 0) {
  const newFunctions = [
    "\tfunction calcularDatasPlantao(primeiroPlantao: string, tipo: '1x3' | '2x6'): string[] {",
    "\t\tif (!primeiroPlantao || !escala) return [];",
    "\t\tconst datas: string[] = [];",
    "\t\tconst inicio = new Date(escala.data_inicio + 'T00:00:00');",
    "\t\tconst fim = new Date(escala.data_fim + 'T00:00:00');",
    "\t\tlet d = new Date(primeiroPlantao + 'T00:00:00');",
    "\t\tif (tipo === '1x3') {",
    "\t\t\twhile (d <= fim) {",
    "\t\t\t\tif (d >= inicio) datas.push(d.toISOString().split('T')[0]);",
    "\t\t\t\td.setDate(d.getDate() + 4);",
    "\t\t\t}",
    "\t\t} else {",
    "\t\t\twhile (d <= fim) {",
    "\t\t\t\tif (d >= inicio) datas.push(d.toISOString().split('T')[0]);",
    "\t\t\t\td.setDate(d.getDate() + 8);",
    "\t\t\t}",
    "\t\t}",
    "\t\treturn datas;",
    "\t}",
    "",
    "\tfunction toggleDataPlantao(data: string) {",
    "\t\tconst idx = addDatasSelecionadas.indexOf(data);",
    "\t\tif (idx >= 0) {",
    "\t\t\taddDatasSelecionadas = addDatasSelecionadas.filter((d) => d !== data);",
    "\t\t} else {",
    "\t\t\taddDatasSelecionadas = [...addDatasSelecionadas, data].sort();",
    "\t\t}",
    "\t}",
    "",
    "\tfunction agruparPorEquipe(",
    "\t\titems: EscalaPolicialComDados[],",
    "\t): Map<string, EscalaPolicialComDados[]> {",
    "\t\tconst map = new Map<string, EscalaPolicialComDados[]>();",
    "\t\tfor (const item of items) {",
    "\t\t\tconst equipe = item.equipe || '';",
    "\t\t\tconst list = map.get(equipe) || [];",
    "\t\t\tlist.push(item);",
    "\t\t\tmap.set(equipe, list);",
    "\t\t}",
    "\t\tfor (const list of map.values()) {",
    "\t\t\tlist.sort((a, b) => {",
    "\t\t\t\tif (a.cargo !== b.cargo) return a.cargo === 'DPC' ? -1 : 1;",
    "\t\t\t\tif (a.nome !== b.nome) return a.nome.localeCompare(b.nome);",
    "\t\t\t\treturn a.data_plantao.localeCompare(b.data_plantao);",
    "\t\t\t});",
    "\t\t}",
    "\t\treturn new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));",
    "\t}",
    "",
    "\tasync function adicionarPlantao(e: Event) {",
    "\t\te.preventDefault();",
    "\t\tif (!policialId || addDatasSelecionadas.length === 0) return;",
    "\t\tadding = true;",
    "\t\tconst diasSaida = addTipoEscala === '2x6' ? 2 : 1;",
    "\t\tconst datas = addDatasSelecionadas.map((d) => {",
    "\t\t\tconst ds = new Date(d + 'T00:00:00');",
    "\t\t\tds.setDate(ds.getDate() + diasSaida);",
    "\t\t\treturn { data_plantao: d, data_saida: ds.toISOString().split('T')[0] };",
    "\t\t});",
    "\t\tconst res = await fetch(`/api/escalas/${page.params.id}/policiais`, {",
    "\t\t\tmethod: 'POST',",
    "\t\t\theaders: { 'Content-Type': 'application/json' },",
    "\t\t\tbody: JSON.stringify({",
    "\t\t\t\tpolicial_id: Number(policialId),",
    "\t\t\t\tdatas,",
    "\t\t\t\thora_entrada: `${addHoraEntrada}:${addMinutoEntrada}`,",
    "\t\t\t\thora_saida: `${addHoraSaida}:${addMinutoSaida}`,",
    "\t\t\t\tequipe: addEquipe,",
    "\t\t\t}),",
    "\t\t});",
    "\t\tif (res.ok) {",
    "\t\t\ttoaster.create({ title: 'Servidor adicionado à escala de plantão', type: 'success' });",
    "\t\t\tcargoBusca = '';",
    "\t\t\tpolicialId = '';",
    "\t\t\taddPrimeiroPlantao = '';",
    "\t\t\taddEquipe = '1';",
    "\t\t\taddDatasSelecionadas = [];",
    "\t\t\tawait recarregarPoliciais();",
    "\t\t} else {",
    "\t\t\tconst err = await res.json().catch(() => ({}));",
    "\t\t\ttoaster.create({ title: (err as { error?: string }).error || 'Erro ao adicionar', type: 'error' });",
    "\t\t}",
    "\t\tadding = false;",
    "\t}",
    "",
    "\t$effect(() => {",
    "\t\taddDatasSelecionadas = calcularDatasPlantao(addPrimeiroPlantao, addTipoEscala);",
    "\t});",
    ""
  ];
  lines.splice(effectLine, 0, ...newFunctions);
  console.log('Added new functions');
}

// ─── 3. Change "Adicionar Todos" condition from plantao || expediente to just expediente ───
const adicionarTodosLine = lines.findIndex(l =>
  l.includes("escala.tipo === 'plantao' || escala.tipo === 'expediente'") &&
  lines[lines.indexOf(l) - 2]?.includes('<!-- Adicionar todos')
);
console.log('Adicionar todos condition at line:', adicionarTodosLine);
if (adicionarTodosLine >= 0) {
  lines[adicionarTodosLine] = lines[adicionarTodosLine].replace(
    "escala.tipo === 'plantao' || escala.tipo === 'expediente'",
    "escala.tipo === 'expediente'"
  );
  console.log('Updated Adicionar Todos condition');
}

// Find and rebuild
const result = lines.join('\r\n');

// ─── 4. Replace Add Form section ───
const addFormStart = result.indexOf('\t<!-- Add form -->');
const addFormEnd = result.indexOf('\n\t<!-- Policiais list -->');
console.log('Add form start:', addFormStart, 'end:', addFormEnd);

if (addFormStart >= 0 && addFormEnd >= 0) {
  const newAddForm = `\t<!-- Add form -->
\t<div
\t\tclass="p-4 sm:p-6 mb-4 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border border-surface-200 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-black/20"
\t>
\t\t<h3 class="font-semibold text-sm mb-3">Adicionar DPC/OIP à Escala</h3>
\t\t{#if escala.tipo === 'plantao'}
\t\t\t<!-- Plantão: form com cálculo automático de datas -->
\t\t\t<form onsubmit={adicionarPlantao}>
\t\t\t\t<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
\t\t\t\t\t<label class="label">
\t\t\t\t\t\t<span class="label-text">Cargo</span>
\t\t\t\t\t\t<select class="select" bind:value={cargoBusca} onchange={() => { policialId = ''; }}>
\t\t\t\t\t\t\t<option value="">Selecione...</option>
\t\t\t\t\t\t\t<option value="DPC">DPC - Delegado de Polícia Civil</option>
\t\t\t\t\t\t\t<option value="OIP">OIP - Oficial Investigador de Polícia</option>
\t\t\t\t\t\t</select>
\t\t\t\t\t</label>
\t\t\t\t\t<label class="label">
\t\t\t\t\t\t<span class="label-text">Servidor</span>
\t\t\t\t\t\t<select class="select" bind:value={policialId} disabled={!cargoBusca}>
\t\t\t\t\t\t\t<option value="">Selecione...</option>
\t\t\t\t\t\t\t{#each policialsFiltrados as p (p.id)}
\t\t\t\t\t\t\t\t<option value={String(p.id)}>{p.nome}{p.lotacao ? " — " + p.lotacao : ""}</option>
\t\t\t\t\t\t\t{/each}
\t\t\t\t\t\t</select>
\t\t\t\t\t</label>
\t\t\t\t\t<label class="label">
\t\t\t\t\t\t<span class="label-text">Equipe</span>
\t\t\t\t\t\t<select class="select" bind:value={addEquipe}>
\t\t\t\t\t\t\t<option value="1">Equipe 1</option>
\t\t\t\t\t\t\t<option value="2">Equipe 2</option>
\t\t\t\t\t\t\t<option value="3">Equipe 3</option>
\t\t\t\t\t\t\t<option value="4">Equipe 4</option>
\t\t\t\t\t\t\t<option value="5">Equipe 5</option>
\t\t\t\t\t\t</select>
\t\t\t\t\t</label>
\t\t\t\t\t<label class="label">
\t\t\t\t\t\t<span class="label-text">Tipo de Escala</span>
\t\t\t\t\t\t<select class="select" bind:value={addTipoEscala}>
\t\t\t\t\t\t\t<option value="1x3">1×3 — 24h serviço, 3 dias folga</option>
\t\t\t\t\t\t\t<option value="2x6">2×6 — 48h serviço, 6 dias folga</option>
\t\t\t\t\t\t</select>
\t\t\t\t\t</label>
\t\t\t\t</div>
\t\t\t\t<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
\t\t\t\t\t<label class="label">
\t\t\t\t\t\t<span class="label-text">Primeiro plantão do mês</span>
\t\t\t\t\t\t<input type="date" class="input" bind:value={addPrimeiroPlantao} min={escala.data_inicio} max={escala.data_fim} required />
\t\t\t\t\t</label>
\t\t\t\t\t<div class="flex flex-col gap-1">
\t\t\t\t\t\t<span class="label-text text-xs">Hora Entrada</span>
\t\t\t\t\t\t<div class="flex gap-1">
\t\t\t\t\t\t\t<select class="select flex-1" bind:value={addHoraEntrada}>
\t\t\t\t\t\t\t\t{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
\t\t\t\t\t\t\t</select>
\t\t\t\t\t\t\t<select class="select flex-1" bind:value={addMinutoEntrada}>
\t\t\t\t\t\t\t\t{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
\t\t\t\t\t\t\t</select>
\t\t\t\t\t\t</div>
\t\t\t\t\t</div>
\t\t\t\t\t<div class="flex flex-col gap-1">
\t\t\t\t\t\t<span class="label-text text-xs">Hora Saída</span>
\t\t\t\t\t\t<div class="flex gap-1">
\t\t\t\t\t\t\t<select class="select flex-1" bind:value={addHoraSaida}>
\t\t\t\t\t\t\t\t{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
\t\t\t\t\t\t\t</select>
\t\t\t\t\t\t\t<select class="select flex-1" bind:value={addMinutoSaida}>
\t\t\t\t\t\t\t\t{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
\t\t\t\t\t\t\t</select>
\t\t\t\t\t\t</div>
\t\t\t\t\t</div>
\t\t\t\t</div>
\t\t\t\t{#if addPrimeiroPlantao}
\t\t\t\t\t{@const datasCalc = calcularDatasPlantao(addPrimeiroPlantao, addTipoEscala)}
\t\t\t\t\t<div class="mb-4">
\t\t\t\t\t\t<p class="text-xs font-semibold text-surface-600 dark:text-surface-400 mb-2">
\t\t\t\t\t\t\tDias de plantão calculados ({addDatasSelecionadas.length} selecionados — desmarque para férias/licença):
\t\t\t\t\t\t</p>
\t\t\t\t\t\t<div class="flex flex-wrap gap-2">
\t\t\t\t\t\t\t{#each datasCalc as d (d)}
\t\t\t\t\t\t\t\t{@const dia = d.split('-')[2]}
\t\t\t\t\t\t\t\t{@const selecionada = addDatasSelecionadas.includes(d)}
\t\t\t\t\t\t\t\t<button
\t\t\t\t\t\t\t\t\ttype="button"
\t\t\t\t\t\t\t\t\tclass="px-3 py-1.5 rounded-lg text-sm font-semibold border-2 transition-all {selecionada ? 'bg-primary-500 text-white border-primary-500' : 'bg-surface-100 dark:bg-surface-800 text-surface-400 border-surface-200 line-through'}"
\t\t\t\t\t\t\t\t\tonclick={() => toggleDataPlantao(d)}
\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t{dia}
\t\t\t\t\t\t\t\t</button>
\t\t\t\t\t\t\t{/each}
\t\t\t\t\t\t</div>
\t\t\t\t\t</div>
\t\t\t\t{/if}
\t\t\t\t<button
\t\t\t\t\ttype="submit"
\t\t\t\t\tclass="btn preset-filled-primary-500"
\t\t\t\t\tdisabled={adding || !policialId || addDatasSelecionadas.length === 0}
\t\t\t\t>
\t\t\t\t\t{adding ? 'Adicionando...' : '+ Adicionar à Escala de Plantão'}
\t\t\t\t</button>
\t\t\t</form>
\t\t{:else}
\t\t\t<!-- Expediente / FDS: form com data única -->
\t\t\t<form onsubmit={adicionar}>
\t\t\t\t<div
\t\t\t\t\tclass="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end"
\t\t\t\t>
\t\t\t\t\t<label class="label">
\t\t\t\t\t\t<span class="label-text">Cargo</span>
\t\t\t\t\t\t<select
\t\t\t\t\t\t\tclass="select"
\t\t\t\t\t\t\tbind:value={cargoBusca}
\t\t\t\t\t\t\tonchange={() => {
\t\t\t\t\t\t\t\tpolicialId = "";
\t\t\t\t\t\t\t}}
\t\t\t\t\t\t>
\t\t\t\t\t\t\t<option value="">Selecione...</option>
\t\t\t\t\t\t\t<option value="DPC"
\t\t\t\t\t\t\t\t>DPC - Delegado de Polícia Civil</option
\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t<option value="OIP"
\t\t\t\t\t\t\t\t>OIP - Oficial Investigador de Polícia</option
\t\t\t\t\t\t\t>
\t\t\t\t\t\t</select>
\t\t\t\t\t</label>
\t\t\t\t\t<label class="label">
\t\t\t\t\t\t<span class="label-text">Servidor</span>
\t\t\t\t\t\t<select
\t\t\t\t\t\t\tclass="select"
\t\t\t\t\t\t\tbind:value={policialId}
\t\t\t\t\t\t\tdisabled={!cargoBusca}
\t\t\t\t\t\t>
\t\t\t\t\t\t\t<option value="">Selecione...</option>
\t\t\t\t\t\t\t{#each policialsFiltrados as p (p.id)}
\t\t\t\t\t\t\t\t<option value={String(p.id)}
\t\t\t\t\t\t\t\t\t>{p.nome}{p.lotacao
\t\t\t\t\t\t\t\t\t\t? " — " + p.lotacao
\t\t\t\t\t\t\t\t\t\t: ""}</option
\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t{/each}
\t\t\t\t\t\t</select>
\t\t\t\t\t</label>
\t\t\t\t\t<label class="label">
\t\t\t\t\t\t<span class="label-text">Data do plantão</span>
\t\t\t\t\t\t<select class="select" bind:value={dataPlantao} required>
\t\t\t\t\t\t\t{#each datasDoPlantao(escala) as d (d)}
\t\t\t\t\t\t\t\t<option value={d}>{formatarData(d)}</option>
\t\t\t\t\t\t\t{/each}
\t\t\t\t\t\t</select>
\t\t\t\t\t</label>
\t\t\t\t\t<div class="flex flex-col gap-1">
\t\t\t\t\t\t<span class="label-text text-xs">Entrada</span>
\t\t\t\t\t\t<div class="flex gap-1">
\t\t\t\t\t\t\t<select class="select flex-1" bind:value={addHoraEntrada}>
\t\t\t\t\t\t\t\t{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
\t\t\t\t\t\t\t</select>
\t\t\t\t\t\t\t<select class="select flex-1" bind:value={addMinutoEntrada}>
\t\t\t\t\t\t\t\t{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
\t\t\t\t\t\t\t</select>
\t\t\t\t\t\t</div>
\t\t\t\t\t</div>
\t\t\t\t\t<div class="flex flex-col gap-1">
\t\t\t\t\t\t<span class="label-text text-xs">Saída</span>
\t\t\t\t\t\t<div class="flex gap-1">
\t\t\t\t\t\t\t<select class="select flex-1" bind:value={addHoraSaida}>
\t\t\t\t\t\t\t\t{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
\t\t\t\t\t\t\t</select>
\t\t\t\t\t\t\t<select class="select flex-1" bind:value={addMinutoSaida}>
\t\t\t\t\t\t\t\t{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
\t\t\t\t\t\t\t</select>
\t\t\t\t\t\t</div>
\t\t\t\t\t</div>
\t\t\t\t\t<div class="lg:col-span-1">
\t\t\t\t\t\t<button
\t\t\t\t\t\t\ttype="submit"
\t\t\t\t\t\t\tclass="btn preset-filled-primary-500 w-full"
\t\t\t\t\t\t\tdisabled={adding || !policialId || !dataPlantao}
\t\t\t\t\t\t>
\t\t\t\t\t\t\t{adding ? "Adicionando..." : "Adicionar"}
\t\t\t\t\t\t</button>
\t\t\t\t\t</div>
\t\t\t\t</div>
\t\t\t</form>
\t\t{/if}
\t</div>`;

  const before = result.substring(0, addFormStart);
  const after = result.substring(addFormEnd);
  const newResult = before + newAddForm + after;

  // ─── 5. Replace Policiais list section ───
  const listStart = newResult.indexOf('\n\t<!-- Policiais list -->');
  const listEnd = newResult.lastIndexOf('{/if}');
  // We need to find the end of the file which should be after the last {/if}
  // The structure ends with {/if} (for the `{:else}` of loading) then `\n{/if}` for the main escala block
  // Let's find the last occurrence
  console.log('list start:', listStart, 'file end:', newResult.length);

  const policiaisListNew = `
\t<!-- Policiais list -->
\t{#if policiaisEscala.length === 0}
\t\t<div class="card p-8 text-center text-surface-500">
\t\t\t<p>Nenhum policial na escala. Adicione policiais acima.</p>
\t\t</div>
\t{:else if escala.tipo === 'plantao'}
\t\t<!-- Plantão: agrupado por equipe -->
\t\t{#each [...agruparPorEquipe(policiaisEscala)] as [equipe, itens] (equipe)}
\t\t\t<div
\t\t\t\tclass="p-4 overflow-hidden mb-6 rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border-2 border-primary-500/20 shadow-xl shadow-black/5 dark:shadow-black/20"
\t\t\t>
\t\t\t\t<h4 class="font-bold text-primary-700 dark:text-primary-400 text-sm mb-3 uppercase tracking-wide">
\t\t\t\t\t{equipe ? \`Equipe \${equipe}\` : 'Sem Equipe Definida'}
\t\t\t\t</h4>
\t\t\t\t<!-- Desktop table -->
\t\t\t\t<div class="table-wrap hidden md:block">
\t\t\t\t\t<table class="table">
\t\t\t\t\t\t<thead>
\t\t\t\t\t\t\t<tr>
\t\t\t\t\t\t\t\t<th>Nome</th>
\t\t\t\t\t\t\t\t<th>Matrícula</th>
\t\t\t\t\t\t\t\t<th>Cargo</th>
\t\t\t\t\t\t\t\t<th>Telefone</th>
\t\t\t\t\t\t\t\t<th>Lotação</th>
\t\t\t\t\t\t\t\t<th>Data Plantão</th>
\t\t\t\t\t\t\t\t<th>Horário</th>
\t\t\t\t\t\t\t\t<th>Observações</th>
\t\t\t\t\t\t\t\t<th>Ações</th>
\t\t\t\t\t\t\t</tr>
\t\t\t\t\t\t</thead>
\t\t\t\t\t\t<tbody>
\t\t\t\t\t\t\t{#each itens as p (p.id)}
\t\t\t\t\t\t\t\t<tr>
\t\t\t\t\t\t\t\t\t<td>{p.nome}</td>
\t\t\t\t\t\t\t\t\t<td>{p.matricula}</td>
\t\t\t\t\t\t\t\t\t<td>
\t\t\t\t\t\t\t\t\t\t<span class="badge text-xs {p.cargo === 'DPC' ? 'preset-filled-primary-500' : 'preset-filled-warning-500'}">{p.cargo}</span>
\t\t\t\t\t\t\t\t\t</td>
\t\t\t\t\t\t\t\t\t<td>{p.telefone}</td>
\t\t\t\t\t\t\t\t\t<td>{p.lotacao}</td>
\t\t\t\t\t\t\t\t\t{#if editingId === p.id}
\t\t\t\t\t\t\t\t\t\t<td colspan="3" class="bg-surface-200 dark:bg-surface-800 rounded-lg">
\t\t\t\t\t\t\t\t\t\t\t<div class="flex flex-col gap-2 py-1">
\t\t\t\t\t\t\t\t\t\t\t\t<div class="flex items-center gap-2">
\t\t\t\t\t\t\t\t\t\t\t\t\t<span class="text-xs font-semibold text-surface-500 w-14">Entrada:</span>
\t\t\t\t\t\t\t\t\t\t\t\t\t<input type="date" bind:value={editDataEntrada} class="input text-sm flex-1 min-w-[120px]" />
\t\t\t\t\t\t\t\t\t\t\t\t\t<div class="flex gap-1">
\t\t\t\t\t\t\t\t\t\t\t\t\t\t<select bind:value={editHoraEntrada} class="select text-sm w-16">{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select>
\t\t\t\t\t\t\t\t\t\t\t\t\t\t<select bind:value={editMinutoEntrada} class="select text-sm w-16">{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}</select>
\t\t\t\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t\t\t\t<div class="flex items-center gap-2">
\t\t\t\t\t\t\t\t\t\t\t\t\t<span class="text-xs font-semibold text-surface-500 w-14">Saída:</span>
\t\t\t\t\t\t\t\t\t\t\t\t\t<input type="date" bind:value={editDataSaida} class="input text-sm flex-1 min-w-[120px]" />
\t\t\t\t\t\t\t\t\t\t\t\t\t<div class="flex gap-1">
\t\t\t\t\t\t\t\t\t\t\t\t\t\t<select bind:value={editHoraSaida} class="select text-sm w-16">{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select>
\t\t\t\t\t\t\t\t\t\t\t\t\t\t<select bind:value={editMinutoSaida} class="select text-sm w-16">{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}</select>
\t\t\t\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t\t\t\t<p class="text-xs text-surface-500 italic">{editPreviewData()} &bull; {editHoraEntrada}:{editMinutoEntrada}H A {editHoraSaida}:{editMinutoSaida}H</p>
\t\t\t\t\t\t\t\t\t\t\t\t<div>
\t\t\t\t\t\t\t\t\t\t\t\t\t<span class="text-xs font-semibold text-surface-500">Observações:</span>
\t\t\t\t\t\t\t\t\t\t\t\t\t<textarea bind:value={editObservacoes} class="input text-sm w-full mt-1 min-h-[48px] resize-y" placeholder="Férias, licenças, dispensas..." rows="2"></textarea>
\t\t\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t\t\t\t<div class="flex gap-1">
\t\t\t\t\t\t\t\t\t\t\t\t\t<button class="btn btn-sm preset-filled-primary-500" onclick={() => salvarEdicao(p.id)}>Salvar</button>
\t\t\t\t\t\t\t\t\t\t\t\t\t<button class="btn btn-sm preset-outlined-primary-500" onclick={cancelEdit}>Cancelar</button>
\t\t\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t\t</td>
\t\t\t\t\t\t\t\t\t{:else}
\t\t\t\t\t\t\t\t\t\t<td>
\t\t\t\t\t\t\t\t\t\t\t<button class="border border-dashed border-surface-300 rounded px-2 py-1 text-sm w-full text-center hover:border-primary-500 hover:bg-surface-100 transition-colors" onclick={() => startEdit(p)} title="Clique para editar">{formatarDataPlantao(p)}</button>
\t\t\t\t\t\t\t\t\t\t</td>
\t\t\t\t\t\t\t\t\t\t<td>
\t\t\t\t\t\t\t\t\t\t\t<button class="border border-dashed border-surface-300 rounded px-2 py-1 text-sm w-full text-center hover:border-primary-500 hover:bg-surface-100 transition-colors" onclick={() => startEdit(p)} title="Clique para editar">{formatarHorario(p)}</button>
\t\t\t\t\t\t\t\t\t\t</td>
\t\t\t\t\t\t\t\t\t\t<td>
\t\t\t\t\t\t\t\t\t\t\t<button class="border border-dashed border-surface-300 rounded px-2 py-1 text-sm w-full text-left hover:border-primary-500 hover:bg-surface-100 transition-colors text-xs" onclick={() => startEdit(p)} title="Clique para editar">{p.observacoes || '-'}</button>
\t\t\t\t\t\t\t\t\t\t</td>
\t\t\t\t\t\t\t\t\t{/if}
\t\t\t\t\t\t\t\t\t<td>
\t\t\t\t\t\t\t\t\t\t<button class="btn btn-sm preset-filled-error-500" onclick={() => solicitarRemocao(p.id, p.nome)}>Remover</button>
\t\t\t\t\t\t\t\t\t</td>
\t\t\t\t\t\t\t\t</tr>
\t\t\t\t\t\t\t{/each}
\t\t\t\t\t\t</tbody>
\t\t\t\t\t</table>
\t\t\t\t</div>
\t\t\t\t<!-- Mobile cards -->
\t\t\t\t<div class="md:hidden space-y-3">
\t\t\t\t\t{#each itens as p (p.id)}
\t\t\t\t\t\t<div class="p-4 rounded-2xl bg-surface-100/50 dark:bg-surface-800/50 border-2 border-surface-200 dark:border-white/15 hover:border-primary-500/40 transition-colors">
\t\t\t\t\t\t\t<div class="flex items-center justify-between mb-2">
\t\t\t\t\t\t\t\t<span class="font-semibold text-sm">{p.nome}</span>
\t\t\t\t\t\t\t\t<span class="badge text-xs {p.cargo === 'DPC' ? 'preset-filled-primary-500' : 'preset-filled-warning-500'}">{p.cargo}</span>
\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t<div class="space-y-1 text-sm text-surface-600 mb-3">
\t\t\t\t\t\t\t\t<div class="flex justify-between"><span class="text-surface-500">Matrícula</span><span>{p.matricula}</span></div>
\t\t\t\t\t\t\t\t<div class="flex justify-between"><span class="text-surface-500">Telefone</span><span>{p.telefone}</span></div>
\t\t\t\t\t\t\t\t<div class="flex justify-between"><span class="text-surface-500">Lotação</span><span>{p.lotacao}</span></div>
\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t{#if editingId === p.id}
\t\t\t\t\t\t\t\t<div class="bg-surface-200 dark:bg-surface-800 rounded-lg p-3 space-y-2 mb-3">
\t\t\t\t\t\t\t\t\t<div class="grid grid-cols-2 gap-2">
\t\t\t\t\t\t\t\t\t\t<label class="label"><span class="label-text text-xs">Data entrada</span><input type="date" bind:value={editDataEntrada} class="input text-sm" /></label>
\t\t\t\t\t\t\t\t\t\t<label class="label"><span class="label-text text-xs">Hora entrada</span>
\t\t\t\t\t\t\t\t\t\t\t<div class="flex gap-1"><select bind:value={editHoraEntrada} class="select text-sm flex-1">{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select><select bind:value={editMinutoEntrada} class="select text-sm flex-1">{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}</select></div>
\t\t\t\t\t\t\t\t\t\t</label>
\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t<div class="grid grid-cols-2 gap-2">
\t\t\t\t\t\t\t\t\t\t<label class="label"><span class="label-text text-xs">Data saída</span><input type="date" bind:value={editDataSaida} class="input text-sm" /></label>
\t\t\t\t\t\t\t\t\t\t<label class="label"><span class="label-text text-xs">Hora saída</span>
\t\t\t\t\t\t\t\t\t\t\t<div class="flex gap-1"><select bind:value={editHoraSaida} class="select text-sm flex-1">{#each horas as h (h)}<option value={h}>{h}h</option>{/each}</select><select bind:value={editMinutoSaida} class="select text-sm flex-1">{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}</select></div>
\t\t\t\t\t\t\t\t\t\t</label>
\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t<p class="text-xs text-surface-500 italic">{editPreviewData()} &bull; {editHoraEntrada}:{editMinutoEntrada}H A {editHoraSaida}:{editMinutoSaida}H</p>
\t\t\t\t\t\t\t\t\t<div>
\t\t\t\t\t\t\t\t\t\t<span class="text-xs font-semibold text-surface-500">Observações:</span>
\t\t\t\t\t\t\t\t\t\t<textarea bind:value={editObservacoes} class="input text-sm w-full mt-1 min-h-[48px] resize-y" placeholder="Férias, licenças, dispensas..." rows="2"></textarea>
\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t<div class="flex gap-2">
\t\t\t\t\t\t\t\t\t\t<button class="btn btn-sm preset-filled-primary-500" onclick={() => salvarEdicao(p.id)}>Salvar</button>
\t\t\t\t\t\t\t\t\t\t<button class="btn btn-sm preset-outlined-primary-500" onclick={cancelEdit}>Cancelar</button>
\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t{:else}
\t\t\t\t\t\t\t\t{#if p.observacoes}
\t\t\t\t\t\t\t\t\t<div class="text-xs text-surface-500 italic mb-2">{p.observacoes}</div>
\t\t\t\t\t\t\t\t{/if}
\t\t\t\t\t\t\t\t<div class="flex gap-2 mb-3">
\t\t\t\t\t\t\t\t\t<button class="flex-1 border border-dashed border-surface-300 rounded px-2 py-2 text-sm text-center hover:border-primary-500 transition-colors" onclick={() => startEdit(p)}>{formatarDataPlantao(p)}</button>
\t\t\t\t\t\t\t\t\t<button class="flex-1 border border-dashed border-surface-300 rounded px-2 py-2 text-sm text-center hover:border-primary-500 transition-colors" onclick={() => startEdit(p)}>{formatarHorario(p)}</button>
\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t{/if}
\t\t\t\t\t\t\t<div class="flex justify-end">
\t\t\t\t\t\t\t\t<button class="btn btn-sm preset-filled-error-500" onclick={() => solicitarRemocao(p.id, p.nome)}>Remover</button>
\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t</div>
\t\t\t\t\t{/each}
\t\t\t\t</div>
\t\t\t</div>
\t\t{/each}
\t{:else}
\t\t<!-- Expediente / FDS: agrupado por data -->
\t\t{#each [...agruparPorData(policiaisEscala)] as [dataGrupo, policiais] (dataGrupo)}
\t\t\t<!-- Desktop table -->
\t\t\t<div
\t\t\t\tclass="p-4 overflow-hidden mb-6 hidden md:block rounded-3xl bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border-2 border-surface-200 dark:border-white/15 shadow-xl shadow-black/5 dark:shadow-black/20"
\t\t\t>
\t\t\t\t<div class="table-wrap">
\t\t\t\t\t<table class="table">
\t\t\t\t\t\t<thead>
\t\t\t\t\t\t\t<tr>
\t\t\t\t\t\t\t\t<th>Nome</th>
\t\t\t\t\t\t\t\t<th>Matrícula</th>
\t\t\t\t\t\t\t\t<th>Cargo</th>
\t\t\t\t\t\t\t\t<th>Telefone</th>
\t\t\t\t\t\t\t\t<th>Classe</th>
\t\t\t\t\t\t\t\t<th>Lotação</th>
\t\t\t\t\t\t\t\t<th>Data</th>
\t\t\t\t\t\t\t\t<th>Horário</th>
\t\t\t\t\t\t\t\t<th>Observações</th>
\t\t\t\t\t\t\t\t<th>Ações</th>
\t\t\t\t\t\t\t</tr>
\t\t\t\t\t\t</thead>
\t\t\t\t\t\t<tbody>
\t\t\t\t\t\t\t{#each policiais as p (p.id)}
\t\t\t\t\t\t\t\t<tr>
\t\t\t\t\t\t\t\t\t<td>{p.nome}</td>
\t\t\t\t\t\t\t\t\t<td>{p.matricula}</td>
\t\t\t\t\t\t\t\t\t<td>
\t\t\t\t\t\t\t\t\t\t<span
\t\t\t\t\t\t\t\t\t\t\tclass="badge text-xs {p.cargo === 'DPC'
\t\t\t\t\t\t\t\t\t\t\t\t? 'preset-filled-primary-500'
\t\t\t\t\t\t\t\t\t\t\t\t: 'preset-filled-warning-500'}"
\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t{p.cargo}
\t\t\t\t\t\t\t\t\t\t</span>
\t\t\t\t\t\t\t\t\t</td>
\t\t\t\t\t\t\t\t\t<td>{p.telefone}</td>
\t\t\t\t\t\t\t\t\t<td class="text-xs text-surface-500">{p.classe || '—'}</td>
\t\t\t\t\t\t\t\t\t<td>{p.lotacao}</td>
\t\t\t\t\t\t\t\t\t{#if editingId === p.id}
\t\t\t\t\t\t\t\t\t\t<td
\t\t\t\t\t\t\t\t\t\t\tcolspan="3"
\t\t\t\t\t\t\t\t\t\t\tclass="bg-surface-200 dark:bg-surface-800 rounded-lg"
\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t<div class="flex flex-col gap-2 py-1">
\t\t\t\t\t\t\t\t\t\t\t\t<div class="flex items-center gap-2">
\t\t\t\t\t\t\t\t\t\t\t\t\t<span class="text-xs font-semibold text-surface-500 w-14">Entrada:</span>
\t\t\t\t\t\t\t\t\t\t\t\t\t<input type="date" bind:value={editDataEntrada} class="input text-sm flex-1 min-w-[120px]" />
\t\t\t\t\t\t\t\t\t\t\t\t\t<div class="flex gap-1">
\t\t\t\t\t\t\t\t\t\t\t\t\t\t<select bind:value={editHoraEntrada} class="select text-sm w-16">
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t</select>
\t\t\t\t\t\t\t\t\t\t\t\t\t\t<select bind:value={editMinutoEntrada} class="select text-sm w-16">
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t</select>
\t\t\t\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t\t\t\t<div class="flex items-center gap-2">
\t\t\t\t\t\t\t\t\t\t\t\t\t<span class="text-xs font-semibold text-surface-500 w-14">Saída:</span>
\t\t\t\t\t\t\t\t\t\t\t\t\t<input type="date" bind:value={editDataSaida} class="input text-sm flex-1 min-w-[120px]" />
\t\t\t\t\t\t\t\t\t\t\t\t\t<div class="flex gap-1">
\t\t\t\t\t\t\t\t\t\t\t\t\t\t<select bind:value={editHoraSaida} class="select text-sm w-16">
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t{#each horas as h (h)}<option value={h}>{h}h</option>{/each}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t</select>
\t\t\t\t\t\t\t\t\t\t\t\t\t\t<select bind:value={editMinutoSaida} class="select text-sm w-16">
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t{#each minutos as m (m)}<option value={m}>{m}m</option>{/each}
\t\t\t\t\t\t\t\t\t\t\t\t\t\t</select>
\t\t\t\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t\t\t\t<p class="text-xs text-surface-500 italic">
\t\t\t\t\t\t\t\t\t\t\t\t\t{editPreviewData()} &bull; {editHoraEntrada}:{editMinutoEntrada}H A {editHoraSaida}:{editMinutoSaida}H
\t\t\t\t\t\t\t\t\t\t\t\t</p>
\t\t\t\t\t\t\t\t\t\t\t\t<div>
\t\t\t\t\t\t\t\t\t\t\t\t\t<span class="text-xs font-semibold text-surface-500">Observações:</span>
\t\t\t\t\t\t\t\t\t\t\t\t\t<textarea bind:value={editObservacoes} class="input text-sm w-full mt-1 min-h-[48px] resize-y" placeholder="Férias, licenças, dispensas..." rows="2"></textarea>
\t\t\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t\t\t\t<div class="flex gap-1">
\t\t\t\t\t\t\t\t\t\t\t\t\t<button class="btn btn-sm preset-filled-primary-500" onclick={() => salvarEdicao(p.id)}>Salvar</button>
\t\t\t\t\t\t\t\t\t\t\t\t\t<button class="btn btn-sm preset-outlined-primary-500" onclick={cancelEdit}>Cancelar</button>
\t\t\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t\t</td>
\t\t\t\t\t\t\t\t\t{:else}
\t\t\t\t\t\t\t\t\t\t<td>
\t\t\t\t\t\t\t\t\t\t\t<button
\t\t\t\t\t\t\t\t\t\t\t\tclass="border border-dashed border-surface-300 rounded px-2 py-1 text-sm w-full text-center hover:border-primary-500 hover:bg-surface-100 transition-colors"
\t\t\t\t\t\t\t\t\t\t\t\tonclick={() => startEdit(p)}
\t\t\t\t\t\t\t\t\t\t\t\ttitle="Clique para editar"
\t\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t\t{formatarDataPlantao(p)}
\t\t\t\t\t\t\t\t\t\t\t</button>
\t\t\t\t\t\t\t\t\t\t</td>
\t\t\t\t\t\t\t\t\t\t<td>
\t\t\t\t\t\t\t\t\t\t\t<button
\t\t\t\t\t\t\t\t\t\t\t\tclass="border border-dashed border-surface-300 rounded px-2 py-1 text-sm w-full text-center hover:border-primary-500 hover:bg-surface-100 transition-colors"
\t\t\t\t\t\t\t\t\t\t\t\tonclick={() => startEdit(p)}
\t\t\t\t\t\t\t\t\t\t\t\ttitle="Clique para editar"
\t\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t\t{formatarHorario(p)}
\t\t\t\t\t\t\t\t\t\t\t</button>
\t\t\t\t\t\t\t\t\t\t</td>
\t\t\t\t\t\t\t\t\t\t<td>
\t\t\t\t\t\t\t\t\t\t\t<button
\t\t\t\t\t\t\t\t\t\t\t\tclass="border border-dashed border-surface-300 rounded px-2 py-1 text-sm w-full text-left hover:border-primary-500 hover:bg-surface-100 transition-colors text-xs"
\t\t\t\t\t\t\t\t\t\t\t\tonclick={() => startEdit(p)}
\t\t\t\t\t\t\t\t\t\t\t\ttitle="Clique para editar"
\t\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t\t{p.observacoes || '-'}
\t\t\t\t\t\t\t\t\t\t\t</button>
\t\t\t\t\t\t\t\t\t\t</td>
\t\t\t\t\t\t\t\t\t{/if}
\t\t\t\t\t\t\t\t\t<td>
\t\t\t\t\t\t\t\t\t\t<button
\t\t\t\t\t\t\t\t\t\t\tclass="btn btn-sm preset-filled-error-500"
\t\t\t\t\t\t\t\t\t\t\tonclick={() => solicitarRemocao(p.id, p.nome)}
\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\tRemover
\t\t\t\t\t\t\t\t\t\t</button>
\t\t\t\t\t\t\t\t\t</td>
\t\t\t\t\t\t\t\t</tr>
\t\t\t\t\t\t\t{/each}
\t\t\t\t\t\t</tbody>
\t\t\t\t\t</table>
\t\t\t\t</div>
\t\t\t</div>

\t\t\t<!-- Mobile cards -->
\t\t\t<div class="md:hidden space-y-3 mb-6">
\t\t\t\t{#each policiais as p (p.id)}
\t\t\t\t\t<div
\t\t\t\t\t\tclass="p-4 mb-4 rounded-2xl bg-surface-100/50 dark:bg-surface-800/50 border-2 border-surface-200 dark:border-white/15 hover:border-primary-500/40 transition-colors"
\t\t\t\t\t>
\t\t\t\t\t\t<div class="flex items-center justify-between mb-2">
\t\t\t\t\t\t\t<span class="font-semibold text-sm">{p.nome}</span>
\t\t\t\t\t\t\t<span
\t\t\t\t\t\t\t\tclass="badge text-xs {p.cargo === 'DPC'
\t\t\t\t\t\t\t\t\t? 'preset-filled-primary-500'
\t\t\t\t\t\t\t\t\t: 'preset-filled-warning-500'}"
\t\t\t\t\t\t\t\t>{p.cargo}</span
\t\t\t\t\t\t\t>
\t\t\t\t\t\t</div>
\t\t\t\t\t\t<div class="space-y-1 text-sm text-surface-600 mb-3">
\t\t\t\t\t\t\t<div class="flex justify-between">
\t\t\t\t\t\t\t\t<span class="text-surface-500">Matrícula</span>
\t\t\t\t\t\t\t\t<span>{p.matricula}</span>
\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t<div class="flex justify-between">
\t\t\t\t\t\t\t\t<span class="text-surface-500">Telefone</span>
\t\t\t\t\t\t\t\t<span>{p.telefone}</span>
\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t<div class="flex justify-between">
\t\t\t\t\t\t\t\t<span class="text-surface-500">Classe</span>
\t\t\t\t\t\t\t\t<span class="text-xs text-surface-500">{p.classe || '—'}</span>
\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t<div class="flex justify-between">
\t\t\t\t\t\t\t\t<span class="text-surface-500">Lotação</span>
\t\t\t\t\t\t\t\t<span>{p.lotacao}</span>
\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t</div>

\t\t\t\t\t\t{#if editingId === p.id}
\t\t\t\t\t\t\t<div
\t\t\t\t\t\t\t\tclass="bg-surface-200 dark:bg-surface-800 rounded-lg p-3 space-y-2 mb-3"
\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t<div class="grid grid-cols-2 gap-2">
\t\t\t\t\t\t\t\t\t<label class="label">
\t\t\t\t\t\t\t\t\t\t<span class="label-text text-xs"
\t\t\t\t\t\t\t\t\t\t\t>Data entrada</span
\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t<input
\t\t\t\t\t\t\t\t\t\t\ttype="date"
\t\t\t\t\t\t\t\t\t\t\tbind:value={editDataEntrada}
\t\t\t\t\t\t\t\t\t\t\tclass="input text-sm"
\t\t\t\t\t\t\t\t\t\t/>
\t\t\t\t\t\t\t\t\t</label>
\t\t\t\t\t\t\t\t\t<label class="label">
\t\t\t\t\t\t\t\t\t\t<span class="label-text text-xs"
\t\t\t\t\t\t\t\t\t\t\t>Hora entrada</span
\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t<div class="flex gap-1">
\t\t\t\t\t\t\t\t\t\t\t<select
\t\t\t\t\t\t\t\t\t\t\t\tbind:value={editHoraEntrada}
\t\t\t\t\t\t\t\t\t\t\t\tclass="select text-sm flex-1"
\t\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t\t{#each horas as h (h)}<option
\t\t\t\t\t\t\t\t\t\t\t\t\t\tvalue={h}>{h}h</option
\t\t\t\t\t\t\t\t\t\t\t\t\t>{/each}
\t\t\t\t\t\t\t\t\t\t\t</select>
\t\t\t\t\t\t\t\t\t\t\t<select
\t\t\t\t\t\t\t\t\t\t\t\tbind:value={editMinutoEntrada}
\t\t\t\t\t\t\t\t\t\t\t\tclass="select text-sm flex-1"
\t\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t\t{#each minutos as m (m)}<option
\t\t\t\t\t\t\t\t\t\t\t\t\t\tvalue={m}>{m}m</option
\t\t\t\t\t\t\t\t\t\t\t\t\t>{/each}
\t\t\t\t\t\t\t\t\t\t\t</select>
\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t</label>
\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t<div class="grid grid-cols-2 gap-2">
\t\t\t\t\t\t\t\t\t<label class="label">
\t\t\t\t\t\t\t\t\t\t<span class="label-text text-xs"
\t\t\t\t\t\t\t\t\t\t\t>Data saída</span
\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t<input
\t\t\t\t\t\t\t\t\t\t\ttype="date"
\t\t\t\t\t\t\t\t\t\t\tbind:value={editDataSaida}
\t\t\t\t\t\t\t\t\t\t\tclass="input text-sm"
\t\t\t\t\t\t\t\t\t\t/>
\t\t\t\t\t\t\t\t\t</label>
\t\t\t\t\t\t\t\t\t<label class="label">
\t\t\t\t\t\t\t\t\t\t<span class="label-text text-xs"
\t\t\t\t\t\t\t\t\t\t\t>Hora saída</span
\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t<div class="flex gap-1">
\t\t\t\t\t\t\t\t\t\t\t<select
\t\t\t\t\t\t\t\t\t\t\t\tbind:value={editHoraSaida}
\t\t\t\t\t\t\t\t\t\t\t\tclass="select text-sm flex-1"
\t\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t\t{#each horas as h (h)}<option
\t\t\t\t\t\t\t\t\t\t\t\t\t\tvalue={h}>{h}h</option
\t\t\t\t\t\t\t\t\t\t\t\t\t>{/each}
\t\t\t\t\t\t\t\t\t\t\t</select>
\t\t\t\t\t\t\t\t\t\t\t<select
\t\t\t\t\t\t\t\t\t\t\t\tbind:value={editMinutoSaida}
\t\t\t\t\t\t\t\t\t\t\t\tclass="select text-sm flex-1"
\t\t\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t\t\t\t{#each minutos as m (m)}<option
\t\t\t\t\t\t\t\t\t\t\t\t\t\tvalue={m}>{m}m</option
\t\t\t\t\t\t\t\t\t\t\t\t\t>{/each}
\t\t\t\t\t\t\t\t\t\t\t</select>
\t\t\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t\t</label>
\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t<p class="text-xs text-surface-500 italic">
\t\t\t\t\t\t\t\t\t{editPreviewData()} &bull; {editHoraEntrada}:{editMinutoEntrada}H A {editHoraSaida}:{editMinutoSaida}H
\t\t\t\t\t\t\t\t</p>
\t\t\t\t\t\t\t\t<div>
\t\t\t\t\t\t\t\t\t<span class="text-xs font-semibold text-surface-500">Observações:</span>
\t\t\t\t\t\t\t\t\t<textarea bind:value={editObservacoes} class="input text-sm w-full mt-1 min-h-[48px] resize-y" placeholder="Férias, licenças, dispensas..." rows="2"></textarea>
\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t\t<div class="flex gap-2">
\t\t\t\t\t\t\t\t\t<button
\t\t\t\t\t\t\t\t\t\tclass="btn btn-sm preset-filled-primary-500"
\t\t\t\t\t\t\t\t\t\tonclick={() => salvarEdicao(p.id)}
\t\t\t\t\t\t\t\t\t\t>Salvar</button
\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t<button
\t\t\t\t\t\t\t\t\t\tclass="btn btn-sm preset-outlined-primary-500"
\t\t\t\t\t\t\t\t\t\tonclick={cancelEdit}>Cancelar</button
\t\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t{:else}
\t\t\t\t\t\t\t{#if p.observacoes}
\t\t\t\t\t\t\t\t<div class="text-xs text-surface-500 italic mb-2">{p.observacoes}</div>
\t\t\t\t\t\t\t{/if}
\t\t\t\t\t\t\t<div class="flex gap-2 mb-3">
\t\t\t\t\t\t\t\t<button
\t\t\t\t\t\t\t\t\tclass="flex-1 border border-dashed border-surface-300 rounded px-2 py-2 text-sm text-center hover:border-primary-500 transition-colors"
\t\t\t\t\t\t\t\t\tonclick={() => startEdit(p)}
\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t{formatarDataPlantao(p)}
\t\t\t\t\t\t\t\t</button>
\t\t\t\t\t\t\t\t<button
\t\t\t\t\t\t\t\t\tclass="flex-1 border border-dashed border-surface-300 rounded px-2 py-2 text-sm text-center hover:border-primary-500 transition-colors"
\t\t\t\t\t\t\t\t\tonclick={() => startEdit(p)}
\t\t\t\t\t\t\t\t>
\t\t\t\t\t\t\t\t\t{formatarHorario(p)}
\t\t\t\t\t\t\t\t</button>
\t\t\t\t\t\t\t</div>
\t\t\t\t\t\t{/if}

\t\t\t\t\t\t<div class="flex justify-end">
\t\t\t\t\t\t\t<button
\t\t\t\t\t\t\t\tclass="btn btn-sm preset-filled-error-500"
\t\t\t\t\t\t\t\tonclick={() => solicitarRemocao(p.id, p.nome)}
\t\t\t\t\t\t\t\t>Remover</button
\t\t\t\t\t\t\t>
\t\t\t\t\t\t</div>
\t\t\t\t\t</div>
\t\t\t\t{/each}
\t\t\t</div>
\t\t{/each}
\t{/if}`;

  const finalBefore = newResult.substring(0, listStart);
  // The rest after the list should be just "\n{/if}\n" (closing the {:else if !escala} block)
  const finalAfter = '\n{/if}\n';
  const finalResult = finalBefore + policiaisListNew + finalAfter;

  // Write the final result
  fs.writeFileSync(path.join(base, 'src/routes/escalas/[id]/+page.svelte'), finalResult);
  console.log('page.svelte written, length:', finalResult.length);
  console.log('adicionarPlantao check:', finalResult.includes('adicionarPlantao'));
  console.log('agruparPorEquipe check:', finalResult.includes('agruparPorEquipe'));
} else {
  console.log('Could not find add form section');
}
