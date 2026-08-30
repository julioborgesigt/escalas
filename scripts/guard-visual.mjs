/**
 * Guard de CI: **a régua visual não se desfaz um call site por vez.**
 *
 * A varredura de ago/2026 (BTN-1…BTN-3) encontrou a divergência que originou
 * este script: 185 elementos preenchidos com texto escuro contra 53 com texto
 * branco, encostados na mesma célula de tabela. Não havia call site culpado — o
 * `theme.css` apontava quatro canais para `contrast-dark` e três para
 * `contrast-light`, e o preset do Skeleton é só
 * `color: var(--color-X-contrast-500)`. A correção foi no TOKEN, e é isso que
 * este guard existe para proteger: decisão centralizada morre quando alguém a
 * recopia à mão no call site, e ninguém percebe porque a tela continua certa.
 *
 * Duas classes de regra, e a diferença entre elas é o que as torna úteis:
 *
 *  - ESTRITAS: hoje valem ZERO no repositório inteiro. Não têm baseline porque
 *    não precisam — qualquer ocorrência é nova por definição. São as quatro em
 *    `REGRAS_ESTRITAS`.
 *  - COM BASELINE: legado real, contado por arquivo em `visual-baseline.json`.
 *    Não existe meta de zero aqui (o README paga esse legado de forma
 *    oportunista, ao tocar no arquivo); o guard só impede que CRESÇA.
 *
 * Uso:
 *   node scripts/guard-visual.mjs              # verifica (é o que o CI roda)
 *   node scripts/guard-visual.mjs --atualizar  # regrava a baseline
 *
 * Como no `guard-duplicacao`, `--atualizar` NÃO é o jeito de fazer o guard
 * passar. Regravar sem corrigir troca um achado por uma linha de JSON. Só
 * regrave quando o número ENCOLHEU.
 *
 * Limite conhecido: o guard lê `class="…"` e `class={…}` por regex, então
 * classe montada em runtime (`` `btn ${cor}` `` com `cor` vindo de variável)
 * é invisível para ele. Isso não é buraco a tapar com parser: é o motivo de a
 * régua morar no TOKEN e não na checagem. O guard pega a recópia manual, que é
 * o modo de falha observado.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const RAIZES = ['src'];
const EXTENSOES = new Set(['.svelte', '.ts']);
const BASELINE = 'scripts/visual-baseline.json';

/**
 * Canais do tema. Lista fechada de propósito: é ela que separa
 * `preset-filled-primary-500` (nosso) de qualquer string parecida.
 */
const CANAIS = 'primary|secondary|tertiary|success|warning|error|surface';

/**
 * Famílias da paleta crua do Tailwind. O README §10 as proíbe porque elas não
 * seguem o tema — `text-red-500` continua vermelho quando a corporação trocar a
 * cor de erro, e não muda no tema escuro.
 */
const PALETA_TAILWIND =
	'red|blue|green|yellow|indigo|purple|pink|gray|slate|zinc|neutral|stone|' +
	'orange|amber|lime|emerald|teal|cyan|sky|violet|fuchsia|rose';

/**
 * **Regras estritas — valem zero hoje, e é isso que as torna aplicáveis sem
 * baseline.** Cada uma tem `teste(texto, classes)` devolvendo as ocorrências.
 */
const REGRAS_ESTRITAS = [
	{
		id: 'preset-preenchido-invalido',
		// Só `-500` existe neste projeto. Os pares `X-a-b` do Skeleton
		// (`preset-filled-surface-100-900`) até existem no CSS dele, mas são
		// `light-dark()` — seguem `color-scheme`, e o tema escuro deste app é a
		// CLASSE `.dark` (ver `@custom-variant` no app.css), então resolveriam
		// SEMPRE para o valor claro. E `preset-filled-surface-100`, que 12 call
		// sites usavam, não existe em lugar nenhum: não gerava CSS, e aqueles
		// botões renderizavam com fundo transparente. Ninguém notou porque eles
		// tinham `border`, então pareciam outlined de propósito.
		descricao: 'preset preenchido que não é `-500` (não gera CSS, ou é light-dark())',
		saida: 'Use `preset-filled-<canal>-500`. Para um neutro que vira com o tema, `bg-surface-100 dark:bg-surface-800`.',
		padrao: new RegExp(`\\bpreset-filled-(?:${CANAIS})-(?!500\\b)[0-9]+(?:-[0-9]+)?\\b`, 'g'),
		emClasse: true
	},
	{
		id: 'hover-preset-preenchido',
		// `hover:preset-filled-primary-500` gera uma CLASSE PRÓPRIA
		// (`.hover\:preset-filled-primary-500:hover`), diferente de
		// `.preset-filled-primary-500` — então ela escapa do escurecimento de
		// fundo do app.css e volta ao `-500` claro. Com o texto branco de hoje
		// isso dá 2,63:1. Foram 12 call sites em 3 arquivos.
		descricao: 'variante de estado sobre preset preenchido (escapa do fundo escurecido)',
		saida: 'Use `hover:bg-<canal>-700` (primary/warning) ou `-600` (success/tertiary) + `hover:text-white`.',
		padrao: new RegExp(`\\b(?:hover|focus|active|group-hover):preset-filled-(?:${CANAIS})`, 'g'),
		emClasse: true
	},
	{
		id: 'texto-manual-em-preenchido',
		// A cor do texto de botão preenchido é decisão de TEMA e mora em
		// `--color-*-contrast-500`. 33 call sites tinham `text-white` escrito à
		// mão — remendo de quando o token dava preto. Redundantes agora, e são
		// exatamente o vetor pelo qual a divergência voltaria: quem "conserta"
		// um botão no call site não conserta os outros 105.
		descricao: '`text-white`/`text-black` à mão sobre preset preenchido',
		saida: 'Remova. A cor vem de `--color-<canal>-contrast-500` no theme.css.',
		testeClasse: (cls) =>
			/\bpreset-filled-/.test(cls) && /(?:^|\s)(text-white|text-black)(?=\s|$)/.test(cls)
				? [cls.match(/(?:^|\s)(text-white|text-black)(?=\s|$)/)[1]]
				: []
	},
	{
		id: 'cor-crua',
		descricao: 'cor crua da paleta Tailwind (não segue o tema nem o modo escuro)',
		saida: 'Use um canal do tema: primary, secondary, tertiary, success, warning, error, surface.',
		padrao: new RegExp(
			`\\b(?:text|bg|border|ring|from|to|via|decoration|fill|stroke|shadow|divide|outline|accent|caret)-(?:${PALETA_TAILWIND})-[0-9]{2,3}\\b`,
			'g'
		)
	}
];

/**
 * **Regras com baseline — legado que não pode crescer.** As duas já estavam
 * escritas no README §10 antes deste guard existir; o que faltava era alguém
 * contando.
 */
const REGRAS_BASELINE = [
	{
		id: 'raio-legado',
		descricao: '`rounded`/`rounded-md` (o tema define --radius-base e --radius-container)',
		saida: 'Use `rounded-xl` (botão/input), `rounded-2xl` (card/modal), `rounded-full` (pill). `rounded-lg` só em elemento ≤ 32px.',
		padrao: /(?:^|\s)rounded(?:-md)?(?=\s|$)/g,
		emClasse: true
	},
	{
		id: 'surface-500-em-texto',
		// `text-surface-500` sobre branco dá 4,10:1, abaixo do piso de 4,5. Só se
		// justifica sobre superfície escura fixa — daí a exceção do `dark:`.
		descricao: '`text-surface-500` sem par `dark:` (4,10:1 sobre branco, abaixo de AA)',
		saida: 'O par padrão é `text-surface-600 dark:text-surface-400`.',
		testeClasse: (cls) =>
			/(?:^|\s)text-surface-500(?=\s|$)/.test(cls) ? ['text-surface-500'] : []
	}
];

function arquivos(dir) {
	const saida = [];
	for (const nome of readdirSync(dir)) {
		if (nome === 'node_modules' || nome.startsWith('.')) continue;
		const caminho = join(dir, nome);
		if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho));
		else if (EXTENSOES.has(extname(nome))) saida.push(caminho);
	}
	return saida;
}

/**
 * Extrai atributos de classe, com a linha em que cada um começa.
 *
 * As três formas que aparecem no projeto: `class="…"`, `` class={`…`} `` e
 * `class={'…'}`. A flag `s` é obrigatória — atributo de classe longo quebra em
 * várias linhas no Prettier deste repo, e sem ela o regex pararia na primeira.
 */
function classesDe(texto) {
	const saida = [];
	for (const m of texto.matchAll(/class=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/gs)) {
		saida.push({
			cls: (m[1] ?? m[2] ?? m[3] ?? '').replace(/\s+/g, ' ').trim(),
			linha: texto.slice(0, m.index).split('\n').length
		});
	}
	return saida;
}

function achadosDe(arquivo) {
	const texto = readFileSync(arquivo, 'utf8');
	const classes = classesDe(texto);
	const porRegra = new Map();

	const anota = (regra, linha, trecho) => {
		if (!porRegra.has(regra.id)) porRegra.set(regra.id, []);
		porRegra.get(regra.id).push({ linha, trecho });
	};

	for (const regra of [...REGRAS_ESTRITAS, ...REGRAS_BASELINE]) {
		if (regra.testeClasse) {
			for (const { cls, linha } of classes)
				for (const t of regra.testeClasse(cls)) anota(regra, linha, t);
		} else if (regra.emClasse) {
			for (const { cls, linha } of classes)
				for (const m of cls.matchAll(regra.padrao)) anota(regra, linha, m[0].trim());
		} else {
			for (const m of texto.matchAll(regra.padrao))
				anota(regra, texto.slice(0, m.index).split('\n').length, m[0].trim());
		}
	}
	return porRegra;
}

// ---------------------------------------------------------------------------

const atualizar = process.argv.includes('--atualizar');
const encontrados = new Map(); // arquivo -> Map(regraId -> ocorrências[])

for (const raiz of RAIZES)
	for (const arquivo of arquivos(raiz)) {
		const r = achadosDe(arquivo);
		if (r.size > 0) encontrados.set(relative('.', arquivo).replaceAll('\\', '/'), r);
	}

const idsBaseline = new Set(REGRAS_BASELINE.map((r) => r.id));

if (atualizar) {
	const arqs = {};
	for (const [arquivo, regras] of [...encontrados].sort())
		for (const [id, oc] of [...regras].sort())
			if (idsBaseline.has(id)) ((arqs[arquivo] ??= {})[id] = oc.length);
	writeFileSync(
		BASELINE,
		JSON.stringify(
			{
				_doc:
					'Legado visual ACEITO, por arquivo. Gerado por `node scripts/guard-visual.mjs --atualizar`. ' +
					'Só as regras COM BASELINE entram aqui — as estritas valem zero e não são negociáveis. ' +
					'Este arquivo só deve ENCOLHER: número que cresce é regressão, não baseline nova.',
				arquivos: arqs
			},
			null,
			'\t'
		) + '\n'
	);
	const total = Object.values(arqs).reduce(
		(n, r) => n + Object.values(r).reduce((a, b) => a + b, 0),
		0
	);
	console.log(
		`[guard-visual] baseline regravada: ${total} ocorrência(s) de legado em ${Object.keys(arqs).length} arquivo(s).`
	);
	process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).arquivos : {};
const violacoes = [];

for (const [arquivo, regras] of [...encontrados].sort())
	for (const [id, oc] of [...regras].sort()) {
		if (!idsBaseline.has(id)) {
			violacoes.push({ arquivo, id, oc, tipo: 'estrita' });
			continue;
		}
		const aceito = baseline[arquivo]?.[id] ?? 0;
		if (oc.length > aceito)
			violacoes.push({
				arquivo,
				id,
				oc: oc.slice(aceito),
				tipo: 'baseline',
				aceito,
				agora: oc.length
			});
	}

if (violacoes.length > 0) {
	const regraPorId = Object.fromEntries(
		[...REGRAS_ESTRITAS, ...REGRAS_BASELINE].map((r) => [r.id, r])
	);
	console.error('\n[guard-visual] a régua visual foi contrariada:\n');
	for (const v of violacoes) {
		const r = regraPorId[v.id];
		const sufixo = v.tipo === 'baseline' ? ` (baseline aceita ${v.aceito}, achei ${v.agora})` : '';
		console.error(`::error file=${v.arquivo},line=${v.oc[0].linha}::${r.descricao}${sufixo}`);
		console.error(`  ${v.arquivo} — ${r.descricao}${sufixo}`);
		for (const o of v.oc.slice(0, 4)) console.error(`    L${o.linha}: ${o.trecho}`);
		if (v.oc.length > 4) console.error(`    … +${v.oc.length - 4}`);
		console.error(`    → ${r.saida}\n`);
	}
	if (violacoes.some((v) => v.tipo === 'baseline'))
		console.error(
			'Legado que CRESCEU. `--atualizar` só depois de o número encolher — regravar\n' +
				'sem corrigir troca um achado por uma linha de JSON.\n'
		);
	console.error('Ver README.md §10 "Padrões visuais (UI)".\n');
	process.exit(1);
}

const totalBaseline = Object.values(baseline).reduce(
	(n, r) => n + Object.values(r).reduce((a, b) => a + b, 0),
	0
);
console.log(
	`[guard-visual] ${REGRAS_ESTRITAS.length} regra(s) estrita(s) em zero; ` +
		`${totalBaseline} ocorrência(s) de legado dentro da baseline.`
);
