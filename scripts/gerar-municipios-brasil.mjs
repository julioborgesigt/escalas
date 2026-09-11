/**
 * Emite a migração que semeia `municipios` com as sedes de TODO o Brasil fora
 * do Ceará — nome e código do IBGE, coordenada do Wikidata.
 *
 * Uso:
 *   node scripts/gerar-municipios-brasil.mjs            # emite a migração
 *   node scripts/gerar-municipios-brasil.mjs --diff     # só mostra o que MUDOU
 *
 * ## Para que serve
 *
 * O módulo de diárias paga viagem para fora do estado (diária interestadual,
 * valor próprio em `custo_parametros`), e o destino sai impresso no
 * Requerimento. A tabela tinha só os 184 do Ceará, semeados por
 * `gerar-distancias.mjs`; a coluna `uf` já existia e `listarMunicipios(db, uf)`
 * já recebia o parâmetro — faltava o dado.
 *
 * ## O que NÃO entra
 *
 * Nem distância nem tempo de trajeto: `distancias_municipios` continua só com
 * os pares do Ceará (16.836), e medir os 15,5 milhões de pares do país não faz
 * sentido — a viagem interestadual é exceção, e o módulo pede a distância à mão
 * nesse caso. `regiao_metropolitana` fica NULL: a vedação do Decreto nº
 * 35.922/2024 que a consome é sobre deslocamento DENTRO do Ceará.
 *
 * ## As fontes, e por que estas
 *
 * As mesmas de `gerar-distancias.mjs`, pelas mesmas razões: **IBGE** para nome
 * e código, porque o nome vai impresso e é a lista oficial que diz quantos e
 * quais são; **Wikidata** (CC0) para a coordenada da SEDE, chaveada pelo código
 * IBGE (P1585), nunca por nome. Município do IBGE sem coordenada ABORTA a
 * geração em vez de sair em silêncio — em set/2026 os 5.571 tinham.
 *
 * ## Atualização é sob demanda e revisada
 *
 * Município novo é lei estadual e plebiscito — raro, e quando acontece alguém
 * precisa olhar. O `--diff` mostra entradas, saídas e renomeações contra a
 * migração já gravada. `INSERT OR IGNORE` deixa a migração idempotente e nunca
 * sobrescreve os 184 do Ceará.
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

/** O estado que JÁ está na tabela e fica de fora deste seed. */
const UF_EXCLUIDA = 'CE';
const SPARQL = 'https://query.wikidata.org/sparql';
const IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades';
const UA = 'escalas-pcce/1.0 (geracao de municipios do brasil)';
const DESTINO = 'migrations/0078_municipios_fora_ce.sql';
/** Linhas por INSERT — 5.387 numa instrução só estoura o limite do D1. */
const LOTE = 500;

const modoDiff = process.argv.slice(2).includes('--diff');

/** As coordenadas das sedes, por código IBGE (Wikidata). */
async function buscarCoordenadas() {
	const query = `SELECT ?ibge ?coord WHERE { ?m wdt:P1585 ?ibge ; wdt:P625 ?coord . }`;
	const res = await fetch(`${SPARQL}?query=${encodeURIComponent(query)}`, {
		headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA }
	});
	if (!res.ok) throw new Error(`Wikidata respondeu ${res.status}`);
	const dados = await res.json();

	const coords = new Map();
	for (const linha of dados.results.bindings) {
		const ibge = linha.ibge.value;
		// P1585 aparece também em entidades com código de 6 ou 8 dígitos;
		// município do IBGE tem exatamente 7.
		if (ibge.length !== 7) continue;
		const m = /^Point\(([-\d.]+) ([-\d.]+)\)$/.exec(linha.coord.value);
		if (m) coords.set(ibge, { lon: Number(m[1]), lat: Number(m[2]) });
	}
	return coords;
}

/**
 * As sedes de todos os municípios do país menos o Ceará, em ordem de código.
 * `view=nivelado` traz a UF na própria linha — a forma aninhada deixa
 * `microrregiao` nula em alguns casos e a sigla fica inalcançável.
 */
async function buscarSedes() {
	const res = await fetch(`${IBGE}/municipios?view=nivelado`, {
		headers: { 'User-Agent': UA }
	});
	if (!res.ok) throw new Error(`IBGE respondeu ${res.status}`);
	const oficiais = await res.json();

	const coords = await buscarCoordenadas();
	const sedes = [];
	const semCoordenada = [];
	for (const m of oficiais) {
		const uf = m['UF-sigla'];
		if (uf === UF_EXCLUIDA) continue;
		const ibge = String(m['municipio-id']);
		const c = coords.get(ibge);
		if (!c) {
			semCoordenada.push(`${m['municipio-nome']}/${uf} (${ibge})`);
			continue;
		}
		sedes.push({ ibge, nome: m['municipio-nome'], uf, lon: c.lon, lat: c.lat });
	}
	if (semCoordenada.length > 0) {
		throw new Error(
			`${semCoordenada.length} município(s) do IBGE sem coordenada no Wikidata: ` +
				semCoordenada.join(', ')
		);
	}
	return sedes.sort((a, b) => a.ibge.localeCompare(b.ibge));
}

function sq(s) {
	return `'${String(s).replace(/'/g, "''")}'`;
}

/** Lê da migração gravada o que ela afirma: código → { nome, uf }. */
function lerMigracaoAtual() {
	if (!existsSync(DESTINO)) return null;
	const atual = new Map();
	const re = /\('(\d{7})','((?:[^']|'')*)','([A-Z]{2})',/g;
	for (const m of readFileSync(DESTINO, 'utf8').matchAll(re)) {
		atual.set(m[1], { nome: m[2].replace(/''/g, "'"), uf: m[3] });
	}
	return atual;
}

function mostrarDiff(sedes) {
	const atual = lerMigracaoAtual();
	if (!atual) {
		console.log(`${DESTINO} não existe — nada com que comparar.`);
		return;
	}
	const novo = new Map(sedes.map((s) => [s.ibge, s]));
	const entraram = sedes.filter((s) => !atual.has(s.ibge));
	const sairam = [...atual].filter(([ibge]) => !novo.has(ibge));
	const renomeados = sedes.filter((s) => atual.has(s.ibge) && atual.get(s.ibge).nome !== s.nome);
	for (const s of entraram) console.log(`+ ${s.nome}/${s.uf} (${s.ibge})`);
	for (const [ibge, a] of sairam) console.log(`- ${a.nome}/${a.uf} (${ibge})`);
	for (const s of renomeados) console.log(`~ ${atual.get(s.ibge).nome} → ${s.nome} (${s.ibge})`);
	if (entraram.length + sairam.length + renomeados.length === 0) {
		console.log(`Nada mudou — ${atual.size} municípios, a migração continua válida.`);
	}
}

function gerarMigracao(sedes, geradoEm) {
	const porUf = new Map();
	for (const s of sedes) porUf.set(s.uf, (porUf.get(s.uf) ?? 0) + 1);
	const resumo = [...porUf]
		.sort()
		.map(([uf, n]) => `${uf} ${n}`)
		.join(', ');

	const lotes = [];
	for (let i = 0; i < sedes.length; i += LOTE) {
		const valores = sedes
			.slice(i, i + LOTE)
			.map(
				(s) => `(${sq(s.ibge)},${sq(s.nome)},${sq(s.uf)},${s.lat.toFixed(6)},${s.lon.toFixed(6)})`
			)
			.join(',\n  ');
		lotes.push(
			`INSERT OR IGNORE INTO \`municipios\` (\`ibge\`,\`nome\`,\`uf\`,\`lat\`,\`lon\`) VALUES\n  ${valores};`
		);
	}

	return `-- As sedes municipais de TODO o Brasil fora do Ceará: ${sedes.length} municípios.
--
-- Gerado por \`node scripts/gerar-municipios-brasil.mjs\` em ${geradoEm} — não
-- edite à mão; o cabeçalho do script explica as fontes e o que fica de fora.
-- Nome e código do IBGE (\`/localidades/municipios\`), coordenada da SEDE pelo
-- Wikidata (P1585 → P625), chaveado por código.
--
-- Só dados: a estrutura veio na 0072, a coluna \`uf\` já existia e
-- \`listarMunicipios(db, uf)\` já recebia o parâmetro. Nenhuma distância nem
-- tempo é semeado — \`distancias_municipios\` continua só com o Ceará, e
-- \`regiao_metropolitana\` fica NULL (a vedação que a lê é sobre o Ceará).
--
-- \`INSERT OR IGNORE\`: idempotente, e nunca sobrescreve os 184 do Ceará.
-- Por UF: ${resumo}.
${lotes.join('\n--> statement-breakpoint\n')}
`;
}

const sedes = await buscarSedes();
if (modoDiff) {
	mostrarDiff(sedes);
} else {
	const geradoEm = new Date().toISOString().slice(0, 10);
	writeFileSync(DESTINO, gerarMigracao(sedes, geradoEm));
	console.log(`${DESTINO}: ${sedes.length} municípios em ${Math.ceil(sedes.length / LOTE)} lotes`);
}
