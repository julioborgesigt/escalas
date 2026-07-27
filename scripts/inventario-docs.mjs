/**
 * Inventário de documentação do código-fonte — a régua do
 * [`docs/PLANO_DOCUMENTACAO.md`](../docs/PLANO_DOCUMENTACAO.md).
 *
 * Mede três coisas que importam mais do que "porcentagem de comentário":
 *   1. arquivos sem CABEÇALHO de módulo (o comentário de maior retorno: diz o
 *      que o arquivo é e quem o usa);
 *   2. arquivos com alta densidade de DECISÃO e pouco comentário — ramos por 100
 *      linhas ≥ 12 com menos de 6% de comentário costumam esconder regra de
 *      negócio que não se recupera lendo o código;
 *   3. exports públicos sem JSDoc, que são contratos consumidos por outras
 *      camadas.
 *
 * Uso:
 *   node scripts/inventario-docs.mjs             # resumo por categoria + listas
 *   node scripts/inventario-docs.mjs --lista     # todos os arquivos pendentes
 *   node scripts/inventario-docs.mjs --json      # saída para diff entre fases
 *
 * Heurística, não verdade absoluta: serve para priorizar e medir progresso, não
 * para aprovar/reprovar arquivo. Arquivo de UI com 800 linhas de markup e 2% de
 * comentário pode estar correto — o que ele precisa é do cabeçalho.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const RAIZ = 'src';
const MIN_LINHAS = 40;
/** Proxy de complexidade: pontos de decisão no arquivo. */
const RAMOS = /\bif\s*\(|\?\?|\?\s|&&|\|\||\bcase\b|\bcatch\b/g;

function arquivos(dir) {
	const out = [];
	for (const nome of readdirSync(dir)) {
		const p = join(dir, nome);
		if (statSync(p).isDirectory()) {
			if (nome === '__tests__') continue;
			out.push(...arquivos(p));
		} else if (['.ts', '.svelte'].includes(extname(p))) {
			out.push(p);
		}
	}
	return out;
}

function medir(p) {
	const s = readFileSync(p, 'utf8');
	const linhas = s.split('\n').filter((l) => l.trim());
	const comentario = linhas.filter((l) => /^\s*(\/\/|\/\*|\*|<!--)/.test(l)).length;

	// Cabeçalho = comentário antes do primeiro código; em .svelte, dentro do <script>.
	let inicio = s.slice(0, 1200);
	if (extname(p) === '.svelte') {
		const m = /<script[^>]*>/.exec(s);
		inicio = m ? s.slice(m.index + m[0].length, m.index + m[0].length + 900) : '';
	}
	const temCabecalho = /^\s*(\/\*\*|\/\/)/m.test(inicio);

	// Export sem JSDoc: linha anterior não faz parte de um bloco de comentário.
	let exportsSemDoc = 0;
	for (const m of s.matchAll(/^export (?:async )?function (\w+)/gm)) {
		const anterior = s.slice(0, m.index).trimEnd().split('\n').pop()?.trim() ?? '';
		if (!/^(\*|\/\*\*|\/\/|\*\/)/.test(anterior)) exportsSemDoc++;
	}

	const ramos = (s.match(RAMOS) ?? []).length;
	return {
		arquivo: p,
		linhas: linhas.length,
		pctComentario: +((100 * comentario) / linhas.length).toFixed(1),
		temCabecalho,
		ramos,
		densidadeDecisao: +((100 * ramos) / linhas.length).toFixed(1),
		exportsSemDoc
	};
}

function categoria(f) {
	if (f.startsWith(join('src', 'lib', 'server'))) return 'lib/server';
	if (f.startsWith(join('src', 'lib', 'db'))) return 'lib/db';
	if (f.startsWith(join('src', 'lib'))) return 'lib (resto)';
	if (/\+page\.server\.ts|\+server\.ts|_actions/.test(f)) return 'rotas: servidor';
	return 'rotas: UI';
}

/** Arquivo em que a falta de comentário é RISCO, não estilo. */
const opaco = (d) => d.densidadeDecisao >= 12 && d.pctComentario < 6;

const medidos = arquivos(RAIZ)
	.map(medir)
	.filter((d) => d.linhas >= MIN_LINHAS);

if (process.argv.includes('--json')) {
	console.log(JSON.stringify(medidos, null, '\t'));
	process.exit(0);
}

const porCategoria = new Map();
for (const d of medidos) {
	const c = categoria(d.arquivo);
	const a = porCategoria.get(c) ?? { arqs: 0, semCabecalho: 0, opacos: 0, exportsSemDoc: 0 };
	a.arqs++;
	if (!d.temCabecalho) a.semCabecalho++;
	if (opaco(d)) a.opacos++;
	a.exportsSemDoc += d.exportsSemDoc;
	porCategoria.set(c, a);
}

console.log(`\nInventário de documentação — ${medidos.length} arquivos ≥ ${MIN_LINHAS} linhas\n`);
console.log(
	'categoria'.padEnd(18) +
		'arqs'.padStart(6) +
		'sem cabeçalho'.padStart(15) +
		'opacos'.padStart(9) +
		'exports s/doc'.padStart(15)
);
for (const [c, a] of [...porCategoria].sort()) {
	console.log(
		c.padEnd(18) +
			String(a.arqs).padStart(6) +
			String(a.semCabecalho).padStart(15) +
			String(a.opacos).padStart(9) +
			String(a.exportsSemDoc).padStart(15)
	);
}

const total = (k) => [...porCategoria.values()].reduce((s, a) => s + a[k], 0);
console.log(
	`\nTOTAIS: ${total('semCabecalho')} sem cabeçalho · ${total('opacos')} opacos · ` +
		`${total('exportsSemDoc')} exports sem doc`
);

const limite = process.argv.includes('--lista') ? Infinity : 10;

console.log('\n── Opacos (alta decisão, pouco comentário) — prioridade máxima');
for (const d of medidos
	.filter(opaco)
	.sort((a, b) => b.ramos - a.ramos)
	.slice(0, limite)) {
	console.log(
		`  ${String(d.ramos).padStart(4)} ramos · ${String(d.linhas).padStart(4)} ln · ` +
			`${String(d.pctComentario).padStart(4)}%  ${d.arquivo}`
	);
}

console.log('\n── Sem cabeçalho de módulo (do maior para o menor)');
for (const d of medidos
	.filter((d) => !d.temCabecalho)
	.sort((a, b) => b.linhas - a.linhas)
	.slice(0, limite)) {
	console.log(`  ${String(d.linhas).padStart(5)} ln · ${categoria(d.arquivo)}  ${d.arquivo}`);
}

console.log('\n── Exports públicos sem JSDoc');
for (const d of medidos
	.filter((d) => d.exportsSemDoc > 0)
	.sort((a, b) => b.exportsSemDoc - a.exportsSemDoc)
	.slice(0, limite)) {
	console.log(`  ${String(d.exportsSemDoc).padStart(3)} exports  ${d.arquivo}`);
}
console.log('');
