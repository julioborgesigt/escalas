/**
 * 1. policiais/[id]/+page.svelte — adiciona campo email na edição
 * 2. policiais/+page.svelte       — move CPF para a mesma linha do email no cadastro
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
// 1. policiais/[id]/+page.svelte
// ============================================================
const editPath = path.join(base, '[id]', '+page.svelte');
let e = r(editPath);

// 1a. Add email state variable
e = rep(e,
  '\tlet saving = $state(false);\n\tlet loading = $state(true);',
  '\tlet email = $state(\'\');\n\tlet saving = $state(false);\n\tlet loading = $state(true);',
  '[id] email state'
);

// 1b. Populate email from fetched data
e = rep(e,
  '\t\t\tlotacao = data.lotacao;\n\t\t\tpapel = data.papel ?? null;',
  '\t\t\tlotacao = data.lotacao;\n\t\t\temail = data.email || \'\';\n\t\t\tpapel = data.papel ?? null;',
  '[id] populate email'
);

// 1c. Include email in PUT body
e = rep(e,
  'body: JSON.stringify({ nome, matricula, cargo, cpf: limparCPF(cpf), telefone, lotacao, regime, classe })',
  'body: JSON.stringify({ nome, matricula, cargo, cpf: limparCPF(cpf), telefone, lotacao, regime, classe, email: email || null })',
  '[id] email in PUT body'
);

// 1d. Add email field HTML between CPF and Linha 2
e = rep(e,
  '\t\t\t\t\t<label class="label sm:col-span-3">\n\t\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">CPF (Obrigatório para Token)</span>\n\t\t\t\t\t\t<input \n\t\t\t\t\t\t\tclass="input py-1 px-3 text-sm" \n\t\t\t\t\t\t\ttype="text" \n\t\t\t\t\t\t\tvalue={cpf} \n\t\t\t\t\t\t\toninput={(e) => (cpf = formatarCPF(e.currentTarget.value))}\n\t\t\t\t\t\t\tplaceholder="000.000.000-00"\n\t\t\t\t\t\t\tmaxlength="14"\n\t\t\t\t\t\t/>\n\t\t\t\t\t</label>\n\t\t\t\t</div>\n\n\t\t\t\t<!-- Linha 2 -->',
  '\t\t\t\t\t<label class="label sm:col-span-3">\n\t\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">CPF (Obrigatório para Token)</span>\n\t\t\t\t\t\t<input \n\t\t\t\t\t\t\tclass="input py-1 px-3 text-sm" \n\t\t\t\t\t\t\ttype="text" \n\t\t\t\t\t\t\tvalue={cpf} \n\t\t\t\t\t\t\toninput={(e) => (cpf = formatarCPF(e.currentTarget.value))}\n\t\t\t\t\t\t\tplaceholder="000.000.000-00"\n\t\t\t\t\t\t\tmaxlength="14"\n\t\t\t\t\t\t/>\n\t\t\t\t\t</label>\n\t\t\t\t\t<label class="label sm:col-span-9">\n\t\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">E-mail (para autenticação de dois fatores)</span>\n\t\t\t\t\t\t<input class="input py-1 px-3 text-sm" type="email" bind:value={email} placeholder="exemplo@gmail.com" />\n\t\t\t\t\t</label>\n\t\t\t\t</div>\n\n\t\t\t\t<!-- Linha 2 -->',
  '[id] email HTML field'
);

w(editPath, e);

// ============================================================
// 2. policiais/+page.svelte — CPF + email na mesma linha
// ============================================================
const listPath = path.join(base, '+page.svelte');
let s = r(listPath);

// 2a. Remove CPF from Linha 1 (it's after Nome+Matricula+Cargo, col-span 3)
s = rep(s,
  '\t\t\t\t\t<label class="label sm:col-span-3">\n\t\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">CPF (Obrigatório para Token)</span>\n\t\t\t\t\t\t<input \n\t\t\t\t\t\t\tclass="input py-1 px-3 text-sm" \n\t\t\t\t\t\t\ttype="text" \n\t\t\t\t\t\t\tvalue={cpf} \n\t\t\t\t\t\t\toninput={(e) => (cpf = formatarCPF(e.currentTarget.value))}\n\t\t\t\t\t\t\tplaceholder="000.000.000-00"\n\t\t\t\t\t\t\tmaxlength="14"\n\t\t\t\t\t\t/>\n\t\t\t\t\t</label>\n\t\t\t\t</div>\n\t\t\n\t\t\t\t<!-- Linha 2: Telefone (3), Classe (4), Regime (5) -->',
  '\t\t\t\t</div>\n\n\t\t\t\t<!-- Linha 2: CPF (5), E-mail (7) -->',
  'remove CPF from Linha 1'
);

// 2b. Replace the standalone "Linha 3: E-mail" with combined CPF + email row
s = rep(s,
  '\t\t\t\t<!-- Linha 3: E-mail (12) -->\n\t\t\t\t<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">\n\t\t\t\t\t<label class="label sm:col-span-12">\n\t\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">E-mail (para autenticação de dois fatores)</span>\n\t\t\t\t\t\t<input class="input py-1 px-3 text-sm" type="email" bind:value={email} placeholder="exemplo@gmail.com" />\n\t\t\t\t\t</label>\n\t\t\t\t</div>\n\n\t\t\t\t<!-- Linha 4: Lotação (12) -->',
  '\t\t\t\t<div class="grid grid-cols-1 sm:grid-cols-12 gap-2">\n\t\t\t\t\t<label class="label sm:col-span-5">\n\t\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">CPF (Obrigatório para Token)</span>\n\t\t\t\t\t\t<input\n\t\t\t\t\t\t\tclass="input py-1 px-3 text-sm"\n\t\t\t\t\t\t\ttype="text"\n\t\t\t\t\t\t\tvalue={cpf}\n\t\t\t\t\t\t\toninput={(e) => (cpf = formatarCPF(e.currentTarget.value))}\n\t\t\t\t\t\t\tplaceholder="000.000.000-00"\n\t\t\t\t\t\t\tmaxlength="14"\n\t\t\t\t\t\t/>\n\t\t\t\t\t</label>\n\t\t\t\t\t<label class="label sm:col-span-7">\n\t\t\t\t\t\t<span class="label-text text-[0.7rem] font-bold uppercase opacity-70 ml-1">E-mail (para autenticação de dois fatores)</span>\n\t\t\t\t\t\t<input class="input py-1 px-3 text-sm" type="email" bind:value={email} placeholder="exemplo@gmail.com" />\n\t\t\t\t\t</label>\n\t\t\t\t</div>\n\n\t\t\t\t<!-- Linha 3: Telefone, Classe, Regime -->',
  'CPF + email combined row'
);

// 2c. Rename "Linha 4: Lotação" to "Linha 4: Lotação" (no change needed, handled above)
// Fix the old Linha 2 label which was Telefone/Classe/Regime
s = rep(s,
  '\t\t\t\t<!-- Linha 2: Telefone (3), Classe (4), Regime (5) -->',
  '\t\t\t\t<!-- Linha 3: Telefone (3), Classe (4), Regime (5) -->',
  'rename Linha 2 → Linha 3'
);

w(listPath, s);

console.log('\nDone.');
