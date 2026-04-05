/**
 * Fix email form layout:
 * 1. policiais/[id]/+page.svelte — add email HTML field (sm:col-span-9) beside CPF (sm:col-span-3)
 * 2. policiais/+page.svelte — reorder: CPF+Email row before Telefone/Classe/Regime row, fix comments
 */
const fs = require('fs');
const path = require('path');

function r(p) { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); }
function w(p, c) { fs.writeFileSync(p, c.replace(/\n/g, '\r\n'), 'utf8'); console.log('  Written:', path.basename(p)); }
function rep(src, old, neu, label) {
  if (!src.includes(old)) { console.error('  [ERR]', label); return src; }
  console.log('  [OK]', label);
  return src.replace(old, neu);
}

const base = path.join(__dirname, 'src', 'routes', 'policiais');

// ============================================================
// 1. policiais/[id]/+page.svelte — add email field beside CPF
// ============================================================
const editPath = path.join(base, '[id]', '+page.svelte');
let e = r(editPath);

e = rep(e,
  '\t\t\t\t<label class="label sm:col-span-3">\n\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">CPF (Obrigatório para Token)</span>\n\t\t\t\t\t<input \n\t\t\t\t\t\tclass="input py-1 px-3 text-sm" \n\t\t\t\t\t\ttype="text" \n\t\t\t\t\t\tvalue={cpf} \n\t\t\t\t\t\toninput={(e) => (cpf = formatarCPF(e.currentTarget.value))}\n\t\t\t\t\t\tplaceholder="000.000.000-00"\n\t\t\t\t\t\tmaxlength="14"\n\t\t\t\t\t/>\n\t\t\t\t</label>\n\t\t\t</div>\n\n\t\t\t<!-- Linha 2 -->',
  '\t\t\t\t<label class="label sm:col-span-3">\n\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">CPF (Obrigatório para Token)</span>\n\t\t\t\t\t<input \n\t\t\t\t\t\tclass="input py-1 px-3 text-sm" \n\t\t\t\t\t\ttype="text" \n\t\t\t\t\t\tvalue={cpf} \n\t\t\t\t\t\toninput={(e) => (cpf = formatarCPF(e.currentTarget.value))}\n\t\t\t\t\t\tplaceholder="000.000.000-00"\n\t\t\t\t\t\tmaxlength="14"\n\t\t\t\t\t/>\n\t\t\t\t</label>\n\t\t\t\t<label class="label sm:col-span-9">\n\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">E-mail (para autenticação de dois fatores)</span>\n\t\t\t\t\t<input class="input py-1 px-3 text-sm" type="email" bind:value={email} placeholder="exemplo@gmail.com" />\n\t\t\t\t</label>\n\t\t\t</div>\n\n\t\t\t<!-- Linha 2 -->',
  '[id] add email field beside CPF'
);

w(editPath, e);

// ============================================================
// 2. policiais/+page.svelte — reorder CPF+Email before Telefone/Classe/Regime
// ============================================================
const listPath = path.join(base, '+page.svelte');
let s = r(listPath);

// Replace the whole mis-ordered block (comment + Telefone/Classe/Regime div + unlabeled CPF+Email div)
// with correctly ordered: CPF+Email first, then Telefone/Classe/Regime
s = rep(s,
  '\t\t\t\t<!-- Linha 2: CPF (5), E-mail (7) -->\n\t\t\t\t<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">\n\t\t\t\t\t<label class="label sm:col-span-3">\n\t\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Telefone</span>\n\t\t\t\t\t\t<input \n\t\t\t\t\t\t\tclass="input py-1 px-3 text-sm" \n\t\t\t\t\t\t\ttype="text" \n\t\t\t\t\t\t\tvalue={telefone} \n\t\t\t\t\t\t\toninput={(e) => (telefone = formatarTelefone(e.currentTarget.value))} \n\t\t\t\t\t\t\tplaceholder="(88) 9.0000-0000"\n\t\t\t\t\t\t\tmaxlength="16"\n\t\t\t\t\t\t/>\n\t\t\t\t\t</label>\n\t\t\t\t\t<label class="label sm:col-span-4">\n\t\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Classe</span>\n\t\t\t\t\t\t<select class="select py-1 px-3 text-sm" bind:value={classe} required>\n\t\t\t\t\t\t\t<option value="" disabled>-</option>\n\t\t\t\t\t\t\t{#each classesDisponiveis as c}\n\t\t\t\t\t\t\t\t<option value={c}>{c}</option>\n\t\t\t\t\t\t\t{/each}\n\t\t\t\t\t\t</select>\n\t\t\t\t\t</label>\n\t\t\t\t\t<label class="label sm:col-span-5">\n\t\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Regime de Trabalho</span>\n\t\t\t\t\t\t<select class="select py-1 px-3 text-sm" bind:value={regime}>\n\t\t\t\t\t\t\t<option value="ambos">Plantão e Expediente</option>\n\t\t\t\t\t\t\t<option value="plantao">Somente Plantão</option>\n\t\t\t\t\t\t\t<option value="expediente">Somente Expediente</option>\n\t\t\t\t\t\t</select>\n\t\t\t\t\t</label>\n\t\t\t\t</div>\n\n\t\t\t\t<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">\n\t\t\t\t\t<label class="label sm:col-span-5">\n\t\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">CPF (Obrigatório para Token)</span>\n\t\t\t\t\t\t<input\n\t\t\t\t\t\t\tclass="input py-1 px-3 text-sm"\n\t\t\t\t\t\t\ttype="text"\n\t\t\t\t\t\t\tvalue={cpf}\n\t\t\t\t\t\t\toninput={(e) => (cpf = formatarCPF(e.currentTarget.value))}\n\t\t\t\t\t\t\tplaceholder="000.000.000-00"\n\t\t\t\t\t\t\tmaxlength="14"\n\t\t\t\t\t\t/>\n\t\t\t\t\t</label>\n\t\t\t\t\t<label class="label sm:col-span-7">\n\t\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">E-mail (para autenticação de dois fatores)</span>\n\t\t\t\t\t\t<input class="input py-1 px-3 text-sm" type="email" bind:value={email} placeholder="exemplo@gmail.com" />\n\t\t\t\t\t</label>\n\t\t\t\t</div>\n\n\t\t\t\t<!-- Linha 3: Telefone, Classe, Regime -->',
  '\t\t\t\t<!-- Linha 2: CPF (5), E-mail (7) -->\n\t\t\t\t<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">\n\t\t\t\t\t<label class="label sm:col-span-5">\n\t\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">CPF (Obrigatório para Token)</span>\n\t\t\t\t\t\t<input\n\t\t\t\t\t\t\tclass="input py-1 px-3 text-sm"\n\t\t\t\t\t\t\ttype="text"\n\t\t\t\t\t\t\tvalue={cpf}\n\t\t\t\t\t\t\toninput={(e) => (cpf = formatarCPF(e.currentTarget.value))}\n\t\t\t\t\t\t\tplaceholder="000.000.000-00"\n\t\t\t\t\t\t\tmaxlength="14"\n\t\t\t\t\t\t/>\n\t\t\t\t\t</label>\n\t\t\t\t\t<label class="label sm:col-span-7">\n\t\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">E-mail (para autenticação de dois fatores)</span>\n\t\t\t\t\t\t<input class="input py-1 px-3 text-sm" type="email" bind:value={email} placeholder="exemplo@gmail.com" />\n\t\t\t\t\t</label>\n\t\t\t\t</div>\n\n\t\t\t\t<!-- Linha 3: Telefone (3), Classe (4), Regime (5) -->\n\t\t\t\t<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">\n\t\t\t\t\t<label class="label sm:col-span-3">\n\t\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Telefone</span>\n\t\t\t\t\t\t<input \n\t\t\t\t\t\t\tclass="input py-1 px-3 text-sm" \n\t\t\t\t\t\t\ttype="text" \n\t\t\t\t\t\t\tvalue={telefone} \n\t\t\t\t\t\t\toninput={(e) => (telefone = formatarTelefone(e.currentTarget.value))} \n\t\t\t\t\t\t\tplaceholder="(88) 9.0000-0000"\n\t\t\t\t\t\t\tmaxlength="16"\n\t\t\t\t\t\t/>\n\t\t\t\t\t</label>\n\t\t\t\t\t<label class="label sm:col-span-4">\n\t\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Classe</span>\n\t\t\t\t\t\t<select class="select py-1 px-3 text-sm" bind:value={classe} required>\n\t\t\t\t\t\t\t<option value="" disabled>-</option>\n\t\t\t\t\t\t\t{#each classesDisponiveis as c}\n\t\t\t\t\t\t\t\t<option value={c}>{c}</option>\n\t\t\t\t\t\t\t{/each}\n\t\t\t\t\t\t</select>\n\t\t\t\t\t</label>\n\t\t\t\t\t<label class="label sm:col-span-5">\n\t\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">Regime de Trabalho</span>\n\t\t\t\t\t\t<select class="select py-1 px-3 text-sm" bind:value={regime}>\n\t\t\t\t\t\t\t<option value="ambos">Plantão e Expediente</option>\n\t\t\t\t\t\t\t<option value="plantao">Somente Plantão</option>\n\t\t\t\t\t\t\t<option value="expediente">Somente Expediente</option>\n\t\t\t\t\t\t</select>\n\t\t\t\t\t</label>\n\t\t\t\t</div>\n\n\t\t\t\t<!-- Linha 4: Lotação (12) -->',
  'reorder CPF+Email before Telefone/Classe/Regime'
);

w(listPath, s);

console.log('\nDone.');
