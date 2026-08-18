/**
 * Guard de CI: **bloco de código copiado entre arquivos não cresce em silêncio.**
 *
 * O `CLAUDE.md` abre a seção "Duplicação: extrair antes de comentar" com uma
 * tabela de bugs que têm todos a mesma forma — lógica copiada, uma cópia
 * consertada, as outras não. Duas linhas dessa tabela (o portão de assinar
 * escala sem o gate de FDS, o fallback de hora do plantão) foram achadas por
 * uma varredura mecânica de blocos repetidos, não por teste e não por leitura.
 * Este script É essa varredura, versionada.
 *
 * O que ele NÃO é: um medidor de qualidade. Não existe meta de "0% duplicado",
 * e o próprio `CLAUDE.md` registra o corolário — quando a extração fica pior
 * que a repetição (a grade dos três calendários, as estruturas ASN.1, os blocos
 * de expansão de `respostas.ts`), a decisão é MANTER. Por isso o guard trabalha
 * contra uma BASELINE: o que já existe está aceito, e só duplicação NOVA
 * reprova.
 *
 * Como funciona:
 *   1. varre `src/**` (`.ts`/`.svelte`), ignorando `__tests__/`;
 *   2. normaliza cada arquivo — descarta linha vazia, comentário e linha com
 *      menos de 6 caracteres, que é onde moram `}`, `});` e `else {`;
 *   3. desliza a janela de `JANELA` linhas normalizadas e agrupa as idênticas
 *      que apareçam em ARQUIVOS DIFERENTES (repetição dentro de um arquivo é
 *      outro problema — geralmente um laço que faltou);
 *   4. compara a impressão digital de cada bloco com `duplicacao-baseline.json`.
 *
 * Um bloco EDITADO conta como novo, e isso é de propósito: mexer em UMA das
 * cópias de um trecho duplicado é exatamente o ato perigoso que a tabela do
 * `CLAUDE.md` documenta. O guard obriga a olhar as outras antes de seguir.
 *
 * Uso:
 *   node scripts/guard-duplicacao.mjs              # verifica (é o que o CI roda)
 *   node scripts/guard-duplicacao.mjs --atualizar  # regrava a baseline
 *
 * `--atualizar` NÃO é o jeito de fazer o guard passar. Regravar sem extrair
 * troca um achado por uma linha de JSON — que é a versão automatizada de
 * "comentar em vez de extrair". Só regrave quando (a) você extraiu e a baseline
 * encolheu, ou (b) você decidiu MANTER e escreveu o motivo na entrada.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Linhas normalizadas por janela. **10 foi medido, não escolhido por gosto** — o
 * valor decide se o guard é útil ou se vira carimbo, então vale o registro.
 *
 * | janela | baseline | alertas em commit normal | em commit de dedup | pega o portão de escala? |
 * | ------ | -------- | ------------------------ | ------------------ | ------------------------ |
 * |     10 |       82 | 2, ambos VERDADEIROS     |                  4 | sim (4 arquivos)         |
 * |     12 |       50 | 0                        |                  5 | sim (3 arquivos)         |
 * |     15 |       26 | 0                        |                  1 | mal (2 arquivos)         |
 *
 * "Commit normal" = os quatro anteriores a `f67345f`. Em janela 10 os dois
 * únicos alertas caíram no commit dos quadros de bem-vindo — e eram a duplicação
 * real das quatro páginas, não ruído. "Commit de dedup" = os três de ago/2026,
 * 109 arquivos, trabalho que REMOVIA duplicação: caso extremo, e nele reavaliar
 * a baseline é justamente o que se quer.
 *
 * A 12 tem baseline menor mas NÃO tem menos ruído — churna mais que a 10 no
 * commit largo, porque blocos de 12 linhas quebram mais fácil quando o código em
 * volta muda. Foi isso que decidiu: a 10 ganha nos dois eixos.
 *
 * Teste de aceite, a última coluna: a janela precisa continuar detectando o
 * portão de assinatura de escala na árvore ANTERIOR à sua extração — o bloco em
 * que `finalizar-assinatura-avancada` estava sem o gate de FDS.
 *
 * LIMITE conhecido: bloco copiado com MENOS de `JANELA` linhas relevantes é
 * invisível para o guard, e o gate GISE de três rotas está nessa faixa. Não é
 * regulável para baixo sem trazer o ruído de volta — abaixo de 10 qualquer bloco
 * de imports casa com outro. O guard reduz a classe do problema; não a elimina.
 */
const JANELA = 10;

const AQUI = dirname(fileURLToPath(import.meta.url));
const BASELINE = resolve(AQUI, 'duplicacao-baseline.json');

/** Linha que não carrega lógica — não deve sustentar sozinha um "bloco igual". */
function relevante(linha) {
	const t = linha.trim();
	if (!t || t.length < 6) return false;
	return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
}

function arquivosVarridos() {
	const saida = execSync(
		"find src -type f \\( -name '*.ts' -o -name '*.svelte' \\) | grep -v __tests__ | sort",
		{ encoding: 'utf8' }
	);
	return saida.split('\n').filter(Boolean);
}

/**
 * Blocos de `JANELA` linhas relevantes que aparecem em mais de um arquivo.
 *
 * A varredura é gulosa: blocos maiores são reivindicados primeiro, e as janelas
 * contidas neles não voltam a ser reportadas. Sem isso, um trecho repetido de
 * 20 linhas viraria 13 achados sobrepostos.
 */
function detectar() {
	const mapa = new Map();

	for (const arquivo of arquivosVarridos()) {
		const linhas = [];
		readFileSync(arquivo, 'utf8')
			.split('\n')
			.forEach((l, i) => {
				if (relevante(l)) linhas.push({ t: l.trim(), n: i + 1 });
			});

		for (let i = 0; i + JANELA <= linhas.length; i++) {
			const fatia = linhas.slice(i, i + JANELA);
			const chave = fatia.map((x) => x.t).join('\n');
			if (!mapa.has(chave)) mapa.set(chave, []);
			mapa.get(chave).push({ arquivo, inicio: fatia[0].n, fim: fatia[JANELA - 1].n });
		}
	}

	const candidatos = [];
	for (const [chave, locais] of mapa) {
		if (new Set(locais.map((l) => l.arquivo)).size < 2) continue;
		candidatos.push({ chave, locais });
	}
	candidatos.sort((a, b) => b.chave.length - a.chave.length);

	const consumido = new Set();
	const blocos = [];
	for (const c of candidatos) {
		// Sobreposição, não igualdade de início: as janelas deslizantes de um mesmo
		// trecho repetido começam em linhas diferentes, e a varredura é gulosa por
		// TAMANHO — então a janela que começa ANTES costuma ser avaliada DEPOIS.
		// Comparar só `inicio` deixava a mesma duplicação ser reportada 3 vezes.
		const jaCoberto = c.locais.every((l) => {
			for (let k = l.inicio; k <= l.fim; k++) if (consumido.has(`${l.arquivo}:${k}`)) return true;
			return false;
		});
		if (jaCoberto) continue;
		for (const l of c.locais) {
			for (let k = l.inicio; k <= l.fim; k++) consumido.add(`${l.arquivo}:${k}`);
		}
		blocos.push({
			id: createHash('sha256').update(c.chave).digest('hex').slice(0, 12),
			arquivos: [...new Set(c.locais.map((l) => l.arquivo))].sort(),
			ocorrencias: c.locais.length,
			amostra: c.chave.split('\n')[0].slice(0, 90)
		});
	}
	return blocos.sort((a, b) => a.id.localeCompare(b.id));
}

function lerBaseline() {
	if (!existsSync(BASELINE)) return { blocos: [] };
	return JSON.parse(readFileSync(BASELINE, 'utf8'));
}

const atuais = detectar();

if (process.argv.includes('--atualizar')) {
	const anterior = new Map(lerBaseline().blocos.map((b) => [b.id, b.nota]));
	const conteudo = {
		_doc:
			'Duplicação cross-file ACEITA. Gerado por `node scripts/guard-duplicacao.mjs --atualizar`. ' +
			`Cada entrada é um bloco de ${JANELA} linhas repetido entre arquivos. Preencha \`nota\` com a DECISÃO ` +
			'(por que manter) — entrada sem nota é dívida ainda não avaliada, não duplicação aprovada.',
		_janela: JANELA,
		blocos: atuais.map((b) => ({ ...b, nota: anterior.get(b.id) ?? '' }))
	};
	writeFileSync(BASELINE, JSON.stringify(conteudo, null, '\t') + '\n');
	console.log(`[guard-duplicacao] baseline regravada com ${atuais.length} bloco(s).`);
	process.exit(0);
}

const conhecidos = new Set(lerBaseline().blocos.map((b) => b.id));
const novos = atuais.filter((b) => !conhecidos.has(b.id));

if (novos.length > 0) {
	console.error(`\n[guard-duplicacao] ${novos.length} bloco(s) duplicado(s) NOVO(s):\n`);
	for (const b of novos) {
		console.error(
			`::error file=${b.arquivos[0]}::bloco de ${JANELA} linhas repetido em ${b.arquivos.length} arquivos`
		);
		console.error(`  ${b.id} — ${b.ocorrencias}x em ${b.arquivos.length} arquivo(s):`);
		for (const a of b.arquivos) console.error(`      ${a}`);
		console.error(`    ↳ ${b.amostra}\n`);
	}
	console.error(
		'Extraia antes de comentar (CLAUDE.md → "Duplicação: extrair antes de comentar").\n' +
			'Se a extração deixar o código PIOR que a repetição, a decisão de manter é\n' +
			'legítima — registre-a: `node scripts/guard-duplicacao.mjs --atualizar` e\n' +
			'escreva o motivo no campo `nota` da entrada nova.\n'
	);
	process.exit(1);
}

const semNota = lerBaseline().blocos.filter((b) => !b.nota).length;
console.log(
	`[guard-duplicacao] ${atuais.length} bloco(s) duplicado(s), todos na baseline — nenhum novo.` +
		(semNota ? ` (${semNota} ainda sem decisão registrada em \`nota\`)` : '')
);
