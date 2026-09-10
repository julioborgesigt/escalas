/**
 * Emite a migração que cria e semeia `feriados` com o calendário NACIONAL.
 *
 * Uso:
 *   node scripts/gerar-feriados.mjs                       # 2026–2030 → migrations/0077_feriados.sql
 *   node scripts/gerar-feriados.mjs --anos 2031-2035 --destino migrations/00NN_feriados_2031_2035.sql
 *
 * ## Para que serve
 *
 * O módulo de diárias precisa saber se a viagem cai em feriado: a contagem do
 * Decreto nº 35.922/2024 trata o dia como fim de semana, e o pedido passa a
 * exigir justificativa. Hoje isso é uma caixa marcada à mão no plano
 * operacional; com a tabela, o calendário SUGERE e o solicitante confirma.
 *
 * ## O que entra e o que fica de fora
 *
 * Entram os feriados nacionais por lei federal — Lei nº 662/1949 (com a redação
 * da Lei nº 10.607/2002), Lei nº 6.802/1980 e Lei nº 14.759/2023 — e a
 * Sexta-feira da Paixão, que a Lei nº 9.093/1995 deixa como feriado religioso
 * municipal, mas que o calendário anual do Governo Federal e o do Estado do
 * Ceará tratam como feriado. A linha dela diz isso na coluna `fonte`.
 *
 * NÃO entram Carnaval e Corpus Christi: são ponto facultativo, e ponto
 * facultativo não é feriado. O módulo prevê declaração manual para esse caso
 * (plano do módulo de diárias, decisão 1). Feriado estadual do Ceará ficou fora
 * por decisão de 10/09/2026; a tabela tem `abrangencia` e `uf` para o dia em
 * que entrar.
 *
 * ## Por que script, e não cálculo em runtime
 *
 * Mesma disciplina da matriz de distâncias e das regiões metropolitanas: o dado
 * decide dinheiro, então precisa ser REPRODUTÍVEL e AUDITÁVEL. Lei nova que
 * crie ou mova feriado é revisão humana — roda-se o script para os anos
 * seguintes e a migração nova entra por PR, lida por alguém.
 */
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
function opcao(nome, padrao) {
	const i = args.indexOf(nome);
	return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
}
const [anoInicial, anoFinal] = opcao('--anos', '2026-2030').split('-').map(Number);
const DESTINO = opcao('--destino', 'migrations/0077_feriados.sql');
const CRIAR_TABELA = !args.includes('--sem-tabela');

/** Feriados de data fixa, com a lei que os institui. */
const FIXOS = [
	['01-01', 'Confraternização Universal', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'],
	['04-21', 'Tiradentes', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'],
	['05-01', 'Dia Mundial do Trabalho', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'],
	['09-07', 'Independência do Brasil', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'],
	['10-12', 'Nossa Senhora Aparecida', 'Lei nº 6.802/1980'],
	['11-02', 'Finados', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'],
	['11-15', 'Proclamação da República', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)'],
	['11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'Lei nº 14.759/2023'],
	['12-25', 'Natal', 'Lei nº 662/1949, art. 1º (red. Lei nº 10.607/2002)']
];

const FONTE_PAIXAO =
	'Lei nº 9.093/1995, art. 2º (feriado religioso); consta como feriado no ' +
	'calendário anual do Governo Federal e do Estado do Ceará';

/**
 * Domingo de Páscoa pelo algoritmo de Meeus/Jones/Butcher (gregoriano). Devolve
 * `{ mes, dia }` — a Sexta-feira da Paixão é dois dias antes.
 */
function pascoa(ano) {
	const a = ano % 19;
	const b = Math.floor(ano / 100);
	const c = ano % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const mes = Math.floor((h + l - 7 * m + 114) / 31);
	const dia = ((h + l - 7 * m + 114) % 31) + 1;
	return { mes, dia };
}

/** A Sexta-feira da Paixão do ano, em ISO — Páscoa menos dois dias, em UTC. */
function sextaFeiraDaPaixao(ano) {
	const { mes, dia } = pascoa(ano);
	const d = new Date(Date.UTC(ano, mes - 1, dia - 2));
	return d.toISOString().slice(0, 10);
}

function sql(s) {
	return `'${String(s).replace(/'/g, "''")}'`;
}

const linhas = [];
for (let ano = anoInicial; ano <= anoFinal; ano++) {
	for (const [md, descricao, fonte] of FIXOS) linhas.push([`${ano}-${md}`, descricao, fonte]);
	linhas.push([sextaFeiraDaPaixao(ano), 'Sexta-feira da Paixão', FONTE_PAIXAO]);
}
linhas.sort((x, y) => x[0].localeCompare(y[0]));

const cabecalho = `-- Calendário de FERIADOS NACIONAIS, ${anoInicial}–${anoFinal}.
--
-- Gerado por \`node scripts/gerar-feriados.mjs\` — não edite à mão; o cabeçalho
-- do script explica o que entra, o que fica de fora e por quê. Em resumo: os
-- feriados por lei federal mais a Sexta-feira da Paixão; Carnaval e Corpus
-- Christi NÃO (ponto facultativo é declaração manual no pedido); feriado
-- estadual do Ceará fora por decisão de 10/09/2026.
--
-- Serve ao módulo de diárias: viagem em feriado conta como fim de semana no
-- Decreto nº 35.922/2024 e exige justificativa no pedido. O calendário SUGERE;
-- o solicitante confirma e o analista pode negar.
--
-- \`uf\` é '' quando nacional (mesma convenção de \`unidades.sigla\`: vazio é
-- "não tem"), o que deixa a chave primária composta funcionar — NULL não casa
-- consigo mesmo num UNIQUE. \`abrangencia\` é vocabulário aberto, sem CHECK.
`;

const ddl = CRIAR_TABELA
	? `CREATE TABLE IF NOT EXISTS \`feriados\` (
	\`data\` text NOT NULL,
	\`abrangencia\` text DEFAULT 'nacional' NOT NULL,
	\`uf\` text DEFAULT '' NOT NULL,
	\`descricao\` text NOT NULL,
	\`fonte\` text NOT NULL,
	PRIMARY KEY (\`data\`, \`abrangencia\`, \`uf\`)
);--> statement-breakpoint
`
	: '';

const valores = linhas
	.map(
		([data, descricao, fonte]) =>
			`\t(${sql(data)}, 'nacional', '', ${sql(descricao)}, ${sql(fonte)})`
	)
	.join(',\n');
const insert = `-- ${linhas.length} linhas: ${FIXOS.length} datas fixas + Sexta-feira da Paixão, por ano.
INSERT OR IGNORE INTO \`feriados\` (\`data\`, \`abrangencia\`, \`uf\`, \`descricao\`, \`fonte\`) VALUES
${valores};
`;

writeFileSync(DESTINO, cabecalho + ddl + insert);
console.log(`${DESTINO}: ${linhas.length} feriados (${anoInicial}–${anoFinal})`);
