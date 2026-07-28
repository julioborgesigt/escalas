/**
 * Guard de CI: **arquivo NOVO em `src/lib/db/` precisa nascer documentado.**
 *
 * A camada de dados é consumida por rotas, endpoints e testes — cada export ali
 * é um contrato. Os cinco bugs de jul/2026 saíram todos de lógica de dados cujo
 * porquê não estava escrito em lugar nenhum.
 *
 * Só vale para arquivos ADICIONADOS no diff. Travar o legado inteiro irritaria
 * sem ganho: o backlog está sendo pago em levas, medido por
 * `npm run docs:inventario`. Aqui o objetivo é só impedir que ele volte a
 * crescer.
 *
 * Exige duas coisas do arquivo novo:
 *   1. CABEÇALHO de módulo — comentário antes da primeira linha de código;
 *   2. JSDoc em cada `export function` (sobrecarga conta como uma só).
 *
 * Uso:
 *   node scripts/guard-docs-novos.mjs <ref-base>
 *   node scripts/guard-docs-novos.mjs origin/main
 *
 * Sem ref-base, compara com o commit anterior (`HEAD~1`) — útil localmente.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const base = process.argv[2] || 'HEAD~1';
const DIR_VIGIADO = 'src/lib/db/';

/** Arquivos ADICIONADOS (não modificados) entre a base e o HEAD. */
function arquivosNovos() {
	try {
		const saida = execSync(`git diff --name-only --diff-filter=A ${base}...HEAD`, {
			encoding: 'utf8'
		});
		return saida.split('\n').filter(Boolean);
	} catch (err) {
		// Base inacessível (shallow clone, primeiro commit) não pode reprovar o CI:
		// o guard é preventivo, não é o gate de qualidade do repositório.
		console.warn(`[guard-docs] não foi possível comparar com "${base}": ${err.message}`);
		return [];
	}
}

const alvos = arquivosNovos().filter(
	(f) => f.startsWith(DIR_VIGIADO) && f.endsWith('.ts') && !f.includes('__tests__')
);

if (alvos.length === 0) {
	console.log('[guard-docs] nenhum arquivo novo em src/lib/db/ — nada a verificar.');
	process.exit(0);
}

const problemas = [];

for (const arquivo of alvos) {
	if (!existsSync(arquivo)) continue; // adicionado e removido no mesmo intervalo
	const s = readFileSync(arquivo, 'utf8');

	const primeiraLinha = s.split('\n').find((l) => l.trim()) ?? '';
	if (!/^(\/\*\*|\/\*|\/\/)/.test(primeiraLinha.trim())) {
		problemas.push({
			arquivo,
			msg: 'sem cabeçalho de módulo (comentário antes da primeira linha de código)'
		});
	}

	const porNome = new Map();
	for (const m of s.matchAll(/^export (?:async )?function (\w+)/gm)) {
		const anterior = s.slice(0, m.index).trimEnd().split('\n').pop()?.trim() ?? '';
		const temDoc = /^(\*|\/\*\*|\/\/|\*\/)/.test(anterior);
		porNome.set(m[1], (porNome.get(m[1]) ?? false) || temDoc);
	}
	for (const [nome, documentado] of porNome) {
		if (!documentado) problemas.push({ arquivo, msg: `export sem JSDoc: ${nome}()` });
	}
}

if (problemas.length > 0) {
	console.error('\n[guard-docs] arquivo novo em src/lib/db/ precisa nascer documentado:\n');
	for (const { arquivo, msg } of problemas) {
		console.error(`::error file=${arquivo}::${msg}`);
		console.error(`  ${arquivo} — ${msg}`);
	}
	console.error(
		'\nO cabeçalho diz o que o módulo é e quem o usa; o JSDoc diz o CONTRATO ' +
			'(o que devolve, o que assume do chamador, que efeito colateral tem).\n' +
			'Ver CLAUDE.md → "Documentação de código".\n'
	);
	process.exit(1);
}

console.log(`[guard-docs] ${alvos.length} arquivo(s) novo(s) em src/lib/db/ — documentação OK.`);
