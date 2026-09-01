/**
 * Gera a MATRIZ DE DISTÂNCIAS RODOVIÁRIAS entre os 184 municípios do Ceará,
 * consumida por `src/lib/db/planos/distancias.ts` para preencher sozinha a
 * distância de cada equipe do plano operacional.
 *
 * Uso:
 *   node scripts/gerar-distancias.mjs            # emite a migração de seed
 *   node scripts/gerar-distancias.mjs --diff     # só mostra o que MUDOU
 *
 * ## Por que uma matriz gravada, e não uma API consultada na hora
 *
 * O número decide dinheiro: 100 km ou mais é pago em diária (ver
 * `$lib/planos/custeio`). Isso pede três coisas que só a tabela dá —
 * REPRODUTIBILIDADE (o mesmo par devolve sempre o mesmo valor, e um plano
 * reemitido não muda), DISPONIBILIDADE (API fora do ar não pode impedir a
 * montagem de um plano) e AUDITABILIDADE (dá para perguntar de onde veio cada
 * número, e quando).
 *
 * ## Por que não linha reta
 *
 * Medido em 12 pares reais do Ceará: o fator rodovia/reta varia de **1,10 a
 * 1,62** — nenhum multiplicador fixo serve. Em 3 dos 12, a linha reta daria a
 * RUBRICA errada, sempre para menos (Iguatu→Juazeiro do Norte: 95 km em reta,
 * 153 km por estrada). O erro cai justamente em cima do limite de 100 km.
 *
 * ## As fontes, e por que estas
 *
 * - **IBGE** para os NOMES e os códigos: é a fonte oficial, e o nome sai
 *   impresso num documento da corporação. Não é detalhe — o Wikidata devolveu
 *   "Guaiuba" sem acento, e a constante `CIDADES_CEARA` do projeto tinha
 *   "Ererê" onde o IBGE diz "Ereré". Nenhuma das duas serve sozinha.
 * - **Wikidata** (CC0) para as COORDENADAS: devolve a da SEDE municipal, não o
 *   centroide do polígono — que é o que erra em município alongado, e a viatura
 *   sai da sede, não do centro geométrico.
 * - **OSRM** sobre dados **OpenStreetMap** (ODbL) para a rodovia: a licença
 *   permite ARMAZENAR o resultado. O Google Distance Matrix, não — o contrato
 *   dele proíbe guardar além de ~30 dias, o que inviabiliza tabela permanente.
 *
 * ## Uma linha por par NÃO ordenado
 *
 * Ida e volta diferem (mão única, pista dupla), mas o medido ficou abaixo de
 * 1,5% — Iguatu→Acopiara 37,3 contra 37,0. Grava-se a MÉDIA das duas direções,
 * arredondada: uma linha em vez de duas, e ninguém precisa explicar por que
 * ir e voltar dão números diferentes num documento.
 *
 * ## Atualização é sob demanda e revisada, nunca automática
 *
 * Distância entre sedes só muda com obra viária grande. E um par que vá de 101
 * para 98 km passa a pagar hora extra em vez de diária em todo plano futuro
 * daquela rota — mudança de dinheiro, que pede gente olhando. Daí o `--diff`,
 * que destaca em separado quem CRUZOU o limite.
 *
 * Plano já emitido nunca muda: `plano_equipes.distancia_km` guarda o número na
 * linha da equipe, e esta tabela só serve para PRÉ-PREENCHER.
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const UF = 'CE';
/** Prefixo IBGE do Ceará — o filtro que separa os 184 do resto do país. */
const PREFIXO_IBGE = '23';
const SPARQL = 'https://query.wikidata.org/sparql';
const IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades';
const OSRM = 'https://router.project-osrm.org';
/**
 * O OSRM público recusa mais de 100 coordenadas por chamada ("TooBig"). Com
 * `sources`/`destinations` cabem 50 origens + 50 destinos, e a matriz inteira
 * sai em 16 blocos — segundos, não horas.
 */
const BLOCO = 50;
/** O limite que decide a rubrica. O `--diff` destaca quem o cruza. */
const LIMITE_DIARIA_KM = 100;
const UA = 'escalas-pcce/1.0 (geracao de matriz de distancias)';

const args = process.argv.slice(2);
const modoDiff = args.includes('--diff');

/** As coordenadas das sedes, por código IBGE (Wikidata). */
async function buscarCoordenadas() {
	const query = `SELECT ?ibge ?coord WHERE {
		?m wdt:P1585 ?ibge ; wdt:P625 ?coord .
		FILTER(STRSTARTS(?ibge, "${PREFIXO_IBGE}"))
	}`;
	const res = await fetch(`${SPARQL}?query=${encodeURIComponent(query)}`, {
		headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA }
	});
	if (!res.ok) throw new Error(`Wikidata respondeu ${res.status}`);
	const dados = await res.json();

	const coords = new Map();
	for (const linha of dados.results.bindings) {
		const ibge = linha.ibge.value;
		// O P1585 aparece também em entidades com código de 6 ou 8 dígitos;
		// município do IBGE tem exatamente 7.
		if (ibge.length !== 7) continue;
		const m = /^Point\(([-\d.]+) ([-\d.]+)\)$/.exec(linha.coord.value);
		if (m) coords.set(ibge, { lon: Number(m[1]), lat: Number(m[2]) });
	}
	return coords;
}

/**
 * As sedes municipais: NOME e código do IBGE, coordenada do Wikidata.
 *
 * A lista de municípios é a do IBGE, não a do Wikidata — é ela que define
 * quantos e quais são, e é o nome dela que vai impresso. Município sem
 * coordenada aborta a geração em vez de sair da matriz em silêncio: uma cidade
 * ausente vira "distância não encontrada" na tela, sem ninguém saber por quê.
 */
async function buscarSedes() {
	const res = await fetch(`${IBGE}/estados/${PREFIXO_IBGE}/municipios`, {
		headers: { 'User-Agent': UA }
	});
	if (!res.ok) throw new Error(`IBGE respondeu ${res.status}`);
	const oficiais = await res.json();

	const coords = await buscarCoordenadas();
	const sedes = [];
	const semCoordenada = [];
	for (const m of oficiais) {
		const ibge = String(m.id);
		const c = coords.get(ibge);
		if (!c) {
			semCoordenada.push(`${m.nome} (${ibge})`);
			continue;
		}
		sedes.push({ ibge, nome: m.nome, lon: c.lon, lat: c.lat });
	}
	if (semCoordenada.length > 0) {
		throw new Error(
			`${semCoordenada.length} município(s) do IBGE sem coordenada no Wikidata: ` +
				semCoordenada.join(', ')
		);
	}
	return sedes.sort((a, b) => a.ibge.localeCompare(b.ibge));
}

/** Uma submatriz de distâncias (metros) entre dois blocos de sedes. */
async function submatriz(origens, destinos) {
	const pontos = [...origens, ...destinos];
	const coords = pontos.map((p) => `${p.lon},${p.lat}`).join(';');
	const s = origens.map((_, i) => i).join(';');
	const d = destinos.map((_, i) => origens.length + i).join(';');
	const url = `${OSRM}/table/v1/driving/${coords}?annotations=distance&sources=${s}&destinations=${d}`;

	// O servidor público é gentil mas não infinito: uma repetição com espera
	// resolve o 429/503 ocasional sem transformar a geração numa loteria.
	for (let tentativa = 1; tentativa <= 4; tentativa++) {
		const res = await fetch(url, { headers: { 'User-Agent': UA } });
		if (res.ok) {
			const json = await res.json();
			if (json.code === 'Ok') return json.distances;
			throw new Error(`OSRM: ${json.code} ${json.message ?? ''}`);
		}
		if (tentativa === 4) throw new Error(`OSRM respondeu ${res.status}`);
		await new Promise((r) => setTimeout(r, 2 ** tentativa * 1000));
	}
	throw new Error('inalcançável');
}

/**
 * A matriz completa, em quilômetros, por par NÃO ordenado.
 *
 * Chave `"origem-destino"` com o menor código primeiro — é o que garante que
 * `m(a,b)` e `m(b,a)` caiam na mesma entrada.
 */
async function montarMatriz(sedes) {
	const bruta = new Map();
	const blocos = [];
	for (let i = 0; i < sedes.length; i += BLOCO) blocos.push(sedes.slice(i, i + BLOCO));

	let feitos = 0;
	const total = blocos.length * blocos.length;
	for (const origens of blocos) {
		for (const destinos of blocos) {
			const dist = await submatriz(origens, destinos);
			for (let i = 0; i < origens.length; i++) {
				for (let j = 0; j < destinos.length; j++) {
					const metros = dist[i][j];
					if (metros === null || metros === undefined) continue;
					bruta.set(`${origens[i].ibge}>${destinos[j].ibge}`, metros / 1000);
				}
			}
			feitos++;
			process.stderr.write(`\r  blocos: ${feitos}/${total}`);
		}
	}
	process.stderr.write('\n');

	// Fecha os pares: média das duas direções, arredondada ao km.
	const pares = new Map();
	const semRota = [];
	for (let i = 0; i < sedes.length; i++) {
		for (let j = i + 1; j < sedes.length; j++) {
			const a = sedes[i].ibge;
			const b = sedes[j].ibge;
			const ida = bruta.get(`${a}>${b}`);
			const volta = bruta.get(`${b}>${a}`);
			const valores = [ida, volta].filter((v) => typeof v === 'number');
			if (valores.length === 0) {
				semRota.push(`${sedes[i].nome} ↔ ${sedes[j].nome}`);
				continue;
			}
			const media = valores.reduce((s, v) => s + v, 0) / valores.length;
			pares.set(`${a}-${b}`, Math.round(media));
		}
	}
	return { pares, semRota };
}

/** Escapa aspas simples para literal SQL. */
const sq = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** A matriz que já está no repositório, para o `--diff`. */
function matrizAnterior() {
	const arquivo = 'migrations/0072_municipios_distancias.sql';
	if (!existsSync(arquivo)) return null;
	const sql = readFileSync(arquivo, 'utf8');
	const pares = new Map();
	for (const m of sql.matchAll(/\('(\d{7})','(\d{7})',(\d+)\)/g)) {
		pares.set(`${m[1]}-${m[2]}`, Number(m[3]));
	}
	return pares.size > 0 ? pares : null;
}

/** Mostra só o que mudou, separando quem cruzou o limite da diária. */
function mostrarDiff(anterior, atual, sedes) {
	const nome = new Map(sedes.map((s) => [s.ibge, s.nome]));
	const cruzaram = [];
	const mudaram = [];
	const novos = [];

	for (const [chave, km] of atual) {
		const antes = anterior.get(chave);
		if (antes === undefined) {
			novos.push(chave);
			continue;
		}
		if (antes === km) continue;
		const [a, b] = chave.split('-');
		const linha = `${nome.get(a) ?? a} ↔ ${nome.get(b) ?? b}: ${antes} → ${km} km`;
		if (antes >= LIMITE_DIARIA_KM !== km >= LIMITE_DIARIA_KM) cruzaram.push(linha);
		else if (Math.abs(km - antes) >= 2) mudaram.push(linha);
	}

	console.log(`\n[distancias] ${atual.size} pares medidos.`);
	if (cruzaram.length > 0) {
		console.log(
			`\n⚠ ${cruzaram.length} par(es) CRUZARAM o limite de ${LIMITE_DIARIA_KM} km — a rubrica`
		);
		console.log('  muda em todo plano FUTURO nessas rotas. Confira um a um antes de aplicar:');
		for (const l of cruzaram) console.log(`    ${l}`);
	}
	if (mudaram.length > 0) {
		console.log(`\n${mudaram.length} par(es) mudaram 2 km ou mais (sem trocar de rubrica):`);
		for (const l of mudaram.slice(0, 40)) console.log(`    ${l}`);
		if (mudaram.length > 40) console.log(`    … e mais ${mudaram.length - 40}`);
	}
	if (novos.length > 0) console.log(`\n${novos.length} par(es) novos.`);
	if (cruzaram.length === 0 && mudaram.length === 0 && novos.length === 0) {
		console.log('Nada mudou — a matriz no repositório continua válida.');
	}
}

/** A migração de seed: municípios e pares. */
function gerarMigracao(sedes, pares, medidoEm) {
	const linhasMun = sedes
		.map((s) => `(${sq(s.ibge)},${sq(s.nome)},${sq(UF)},${s.lat.toFixed(6)},${s.lon.toFixed(6)})`)
		.join(',\n  ');

	// INSERT em lotes: uma instrução por par produziria 16.836 statements e uma
	// migração que leva minutos. Em lotes de 500 são 34 instruções.
	const chaves = [...pares.keys()].sort();
	const lotes = [];
	for (let i = 0; i < chaves.length; i += 500) {
		const valores = chaves
			.slice(i, i + 500)
			.map((k) => {
				const [a, b] = k.split('-');
				return `('${a}','${b}',${pares.get(k)})`;
			})
			.join(',');
		lotes.push(
			`INSERT OR REPLACE INTO \`distancias_municipios\` (\`origem_ibge\`,\`destino_ibge\`,\`km\`) VALUES ${valores};`
		);
	}

	return `-- Municípios do Ceará e a MATRIZ DE DISTÂNCIAS RODOVIÁRIAS entre eles.
--
-- Gerado por \`node scripts/gerar-distancias.mjs\` — não edite à mão. O cabeçalho
-- daquele script explica as fontes (Wikidata CC0 para as sedes, OSRM/OSM ODbL
-- para a rodovia), por que a linha reta foi descartada e por que a atualização é
-- sob demanda e revisada.
--
-- A distância decide a rubrica da equipe: 100 km ou mais é pago em diária. Esta
-- tabela só PRÉ-PREENCHE — o número que vale para um plano fica gravado em
-- \`plano_equipes.distancia_km\`, então atualizar aqui nunca reescreve documento
-- já emitido.
CREATE TABLE IF NOT EXISTS \`municipios\` (
	-- Código IBGE de 7 dígitos. Chave natural e estável: nome de município muda
	-- (acento, grafia), código não.
	\`ibge\` text PRIMARY KEY NOT NULL,
	\`nome\` text NOT NULL,
	\`uf\` text NOT NULL,
	-- Coordenada da SEDE, não o centroide do polígono: a viatura sai da sede, e
	-- em município alongado o centro geométrico fica dezenas de km fora.
	-- Guardadas porque o script de atualização precisa delas para regerar.
	\`lat\` real NOT NULL,
	\`lon\` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS \`idx_municipios_nome\` ON \`municipios\` (\`uf\`, \`nome\`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS \`distancias_municipios\` (
	-- Par NÃO ordenado, sempre com o menor código primeiro: uma linha serve ida e
	-- volta. As duas direções diferem menos de 1,5% e o valor gravado é a média
	-- arredondada — ver o cabeçalho do script.
	\`origem_ibge\` text NOT NULL,
	\`destino_ibge\` text NOT NULL,
	\`km\` integer NOT NULL,
	PRIMARY KEY (\`origem_ibge\`, \`destino_ibge\`),
	FOREIGN KEY (\`origem_ibge\`) REFERENCES \`municipios\`(\`ibge\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`destino_ibge\`) REFERENCES \`municipios\`(\`ibge\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Procedência da medição, uma linha para a tabela inteira: a matriz é gerada de
-- uma vez, então datar par a par repetiria o mesmo valor 16.836 vezes. A tela
-- mostra esta data ao lado da distância preenchida.
CREATE TABLE IF NOT EXISTS \`distancias_medicao\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`fonte\` text NOT NULL,
	\`medido_em\` text NOT NULL,
	\`pares\` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO \`municipios\` (\`ibge\`,\`nome\`,\`uf\`,\`lat\`,\`lon\`) VALUES
  ${linhasMun};
--> statement-breakpoint
${lotes.join('\n--> statement-breakpoint\n')}
--> statement-breakpoint
INSERT INTO \`distancias_medicao\` (\`fonte\`,\`medido_em\`,\`pares\`)
VALUES ('OSRM/OpenStreetMap (ODbL); sedes do Wikidata (CC0)', ${sq(medidoEm)}, ${pares.size});
--> statement-breakpoint
-- A opção de briefing/origem/destino passa a poder apontar para um município.
-- Anulável porque nem toda opção resolve: "Sede da 4ª Seccional do Interior Sul"
-- é um PRÉDIO, e em que cidade ele fica não está em lugar nenhum do banco — quem
-- sabe é quem monta o plano. NULL é o estado que a tela explica.
ALTER TABLE \`plano_opcoes\` ADD COLUMN \`municipio_ibge\` text REFERENCES \`municipios\`(\`ibge\`);
--> statement-breakpoint
-- As opções de ORIGEM e DESTINO já gravadas são nomes de cidade digitados à mão:
-- casam por nome normalizado (sem acento, caixa baixa). O que não casar fica
-- NULL e o editor pede a cidade — melhor do que adivinhar.
--
-- Briefing NÃO entra: nome de prédio não vira município por semelhança de texto,
-- e um palpite errado aqui mediria o trajeto pela cidade errada.
UPDATE \`plano_opcoes\`
   SET \`municipio_ibge\` = (
     SELECT m.\`ibge\` FROM \`municipios\` m
      WHERE m.\`uf\` = '${UF}'
        AND lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
            m.\`nome\`,'á','a'),'à','a'),'â','a'),'ã','a'),'é','e'),'ê','e'),'í','i'),'ó','o'),'ô','o'),'ú','u'))
          = lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
            trim(\`plano_opcoes\`.\`valor\`),'á','a'),'à','a'),'â','a'),'ã','a'),'é','e'),'ê','e'),'í','i'),'ó','o'),'ô','o'),'ú','u'))
   )
 WHERE \`tipo\` IN ('origem','destino') AND \`municipio_ibge\` IS NULL;
`;
}

const sedes = await buscarSedes();
console.error(`[distancias] ${sedes.length} sedes do ${UF} (Wikidata).`);
if (sedes.length !== 184) {
	console.error(`⚠ esperava 184 municípios no Ceará — confira antes de usar este resultado.`);
}

console.error('[distancias] medindo a matriz rodoviária (OSRM)…');
const { pares, semRota } = await montarMatriz(sedes);
if (semRota.length > 0) {
	console.error(`⚠ ${semRota.length} par(es) sem rota; ficam de fora da tabela:`);
	for (const p of semRota.slice(0, 10)) console.error(`    ${p}`);
}

if (modoDiff) {
	const anterior = matrizAnterior();
	if (!anterior) {
		console.error('Não há matriz no repositório para comparar. Rode sem --diff para gerar.');
		process.exit(1);
	}
	mostrarDiff(anterior, pares, sedes);
	process.exit(0);
}

const medidoEm = new Date().toISOString().slice(0, 10);
const destino = 'migrations/0072_municipios_distancias.sql';
writeFileSync(destino, gerarMigracao(sedes, pares, medidoEm));
console.error(
	`\n[distancias] ${destino} — ${sedes.length} municípios, ${pares.size} pares, medido em ${medidoEm}.`
);
console.error(
	'CONFIRA alguns pares conhecidos antes de commitar: matriz errada passa em todo teste.'
);
