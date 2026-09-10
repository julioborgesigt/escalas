/**
 * Gera a MATRIZ DE TEMPO DE TRAJETO entre os 184 municípios do Ceará, consumida
 * pelo módulo de diárias para estimar a jornada da viagem (ver
 * `$lib/diarias/jornada`, entrada `minutosIda`).
 *
 * Uso:
 *   node scripts/gerar-tempos.mjs            # emite a migração de seed
 *   node scripts/gerar-tempos.mjs --diff     # só mostra o que MUDOU
 *
 * ## Por que uma matriz SEPARADA da de distâncias
 *
 * `distancias_municipios` decide a rubrica do plano operacional (100 km) e não
 * muda por causa do módulo novo — é decisão registrada (plano do módulo de
 * diárias, decisão 4). O tempo serve a outra pergunta: o Decreto nº 35.922/2024
 * presume a jornada de uma missão como `2 × tempo de ida + permanência`, e é
 * essa conta que concede ou nega a meia diária. Duas tabelas, dois motivos, sem
 * uma coluna nova numa tabela que outro módulo lê.
 *
 * ## As sedes vêm da migração 0072, não do IBGE/Wikidata
 *
 * Mede-se entre EXATAMENTE as coordenadas que estão no banco. Buscar de novo
 * poderia trazer uma sede que o Wikidata moveu, e a chave do par (menor código
 * primeiro, a mesma de `chaveDoPar`) precisa casar com a matriz de distâncias.
 *
 * ## A mesma chamada devolve metros e segundos — e isso é a conferência
 *
 * O OSRM devolve as duas anotações de uma vez. O script compara a distância
 * medida agora com a gravada na 0072 e informa quantos pares diferem: se a
 * matriz de distâncias bate, o tempo foi medido sobre a MESMA rota. Um desvio
 * grande é o OSM que mudou — e aí é a matriz de distâncias que pede revisão,
 * pelo `--diff` dela.
 *
 * ## Uma linha por par NÃO ordenado, em minutos
 *
 * Como na distância: média das duas direções, arredondada ao minuto. A
 * assimetria de ida e volta é da mesma ordem (mão única, pista dupla) e uma
 * linha só não obriga ninguém a explicar dois números num documento.
 *
 * ## Atualização é sob demanda e revisada
 *
 * O tempo muda com obra viária, como a distância. Plano ou pedido já emitido
 * não muda: o que vale fica gravado na própria linha do pedido; esta tabela só
 * PRÉ-PREENCHE. Fonte: OSRM sobre OpenStreetMap (ODbL), cuja licença permite
 * armazenar o resultado.
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const OSRM = 'https://router.project-osrm.org';
/** O OSRM público recusa mais de 100 coordenadas por chamada: 50 + 50. */
const BLOCO = 50;
const UA = 'escalas-pcce/1.0 (geracao de matriz de tempos)';
const ORIGEM_SEDES = 'migrations/0072_municipios_distancias.sql';
const DESTINO = 'migrations/0079_tempos_municipios.sql';
/** Diferença de distância, em km, a partir da qual o par é listado. */
const TOLERANCIA_KM = 2;

const args = process.argv.slice(2);
const modoDiff = args.includes('--diff');

/** As 184 sedes e a matriz de km, como a 0072 as gravou. */
function lerMigracao0072() {
	const sql = readFileSync(ORIGEM_SEDES, 'utf8');
	const sedes = [];
	for (const m of sql.matchAll(/\('(\d{7})','((?:[^']|'')*)','CE',(-?[\d.]+),(-?[\d.]+)\)/g)) {
		sedes.push({
			ibge: m[1],
			nome: m[2].replace(/''/g, "'"),
			lat: Number(m[3]),
			lon: Number(m[4])
		});
	}
	const km = new Map();
	for (const m of sql.matchAll(/\('(\d{7})','(\d{7})',(\d+)\)/g))
		km.set(`${m[1]}-${m[2]}`, Number(m[3]));
	return { sedes: sedes.sort((a, b) => a.ibge.localeCompare(b.ibge)), km };
}

/** Uma submatriz de duração (s) e distância (m) entre dois blocos de sedes. */
async function submatriz(origens, destinos) {
	const pontos = [...origens, ...destinos];
	const coords = pontos.map((p) => `${p.lon},${p.lat}`).join(';');
	const s = origens.map((_, i) => i).join(';');
	const d = destinos.map((_, i) => origens.length + i).join(';');
	const url = `${OSRM}/table/v1/driving/${coords}?annotations=duration,distance&sources=${s}&destinations=${d}`;

	for (let tentativa = 1; tentativa <= 4; tentativa++) {
		const res = await fetch(url, { headers: { 'User-Agent': UA } });
		if (res.ok) {
			const json = await res.json();
			if (json.code === 'Ok') return { duracoes: json.durations, distancias: json.distances };
			throw new Error(`OSRM: ${json.code} ${json.message ?? ''}`);
		}
		if (tentativa === 4) throw new Error(`OSRM respondeu ${res.status}`);
		await new Promise((r) => setTimeout(r, 2 ** tentativa * 1000));
	}
	throw new Error('inalcançável');
}

/** As matrizes completas, por par NÃO ordenado: minutos e km (para conferir). */
async function montarMatrizes(sedes) {
	const brutaSeg = new Map();
	const brutaM = new Map();
	const blocos = [];
	for (let i = 0; i < sedes.length; i += BLOCO) blocos.push(sedes.slice(i, i + BLOCO));

	let feitos = 0;
	const total = blocos.length * blocos.length;
	for (const origens of blocos) {
		for (const destinos of blocos) {
			const { duracoes, distancias } = await submatriz(origens, destinos);
			for (let i = 0; i < origens.length; i++) {
				for (let j = 0; j < destinos.length; j++) {
					const chave = `${origens[i].ibge}>${destinos[j].ibge}`;
					if (typeof duracoes[i][j] === 'number') brutaSeg.set(chave, duracoes[i][j]);
					if (typeof distancias[i][j] === 'number') brutaM.set(chave, distancias[i][j]);
				}
			}
			feitos++;
			process.stderr.write(`\r  blocos: ${feitos}/${total}`);
		}
	}
	process.stderr.write('\n');

	const media = (bruta, a, b) => {
		const v = [bruta.get(`${a}>${b}`), bruta.get(`${b}>${a}`)].filter((x) => typeof x === 'number');
		return v.length === 0 ? null : v.reduce((s, x) => s + x, 0) / v.length;
	};

	const minutos = new Map();
	const km = new Map();
	const semRota = [];
	for (let i = 0; i < sedes.length; i++) {
		for (let j = i + 1; j < sedes.length; j++) {
			const a = sedes[i].ibge;
			const b = sedes[j].ibge;
			const seg = media(brutaSeg, a, b);
			if (seg === null) {
				semRota.push(`${sedes[i].nome} ↔ ${sedes[j].nome}`);
				continue;
			}
			minutos.set(`${a}-${b}`, Math.round(seg / 60));
			const m = media(brutaM, a, b);
			if (m !== null) km.set(`${a}-${b}`, Math.round(m / 1000));
		}
	}
	return { minutos, km, semRota };
}

/** Compara a distância medida agora com a da 0072 — a rota é a mesma? */
function conferirDistancias(kmAgora, km0072, sedes) {
	const nome = new Map(sedes.map((s) => [s.ibge, s.nome]));
	const divergentes = [];
	for (const [chave, km] of kmAgora) {
		const antes = km0072.get(chave);
		if (antes !== undefined && Math.abs(antes - km) >= TOLERANCIA_KM) {
			const [a, b] = chave.split('-');
			divergentes.push(`${nome.get(a)} ↔ ${nome.get(b)}: 0072 diz ${antes} km, hoje ${km} km`);
		}
	}
	console.error(
		`[tempos] conferência de rota: ${kmAgora.size - divergentes.length}/${kmAgora.size} pares com a mesma distância da 0072 (±${TOLERANCIA_KM} km).`
	);
	if (divergentes.length > 0) {
		console.error(
			`⚠ ${divergentes.length} par(es) com distância diferente — o OSM mudou nessas rotas:`
		);
		for (const l of divergentes.slice(0, 20)) console.error(`    ${l}`);
		if (divergentes.length > 20) console.error(`    … e mais ${divergentes.length - 20}`);
	}
}

const sq = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** A matriz de tempos que já está no repositório, para o `--diff`. */
function matrizAnterior() {
	if (!existsSync(DESTINO)) return null;
	const pares = new Map();
	for (const m of readFileSync(DESTINO, 'utf8').matchAll(/\('(\d{7})','(\d{7})',(\d+)\)/g)) {
		pares.set(`${m[1]}-${m[2]}`, Number(m[3]));
	}
	return pares.size > 0 ? pares : null;
}

function mostrarDiff(anterior, atual, sedes) {
	const nome = new Map(sedes.map((s) => [s.ibge, s.nome]));
	const mudaram = [];
	let novos = 0;
	for (const [chave, min] of atual) {
		const antes = anterior.get(chave);
		if (antes === undefined) {
			novos++;
			continue;
		}
		// Menos de 5 minutos é ruído de medição, não obra viária.
		if (Math.abs(min - antes) >= 5) {
			const [a, b] = chave.split('-');
			mudaram.push(`${nome.get(a)} ↔ ${nome.get(b)}: ${antes} → ${min} min`);
		}
	}
	console.log(`\n[tempos] ${atual.size} pares medidos.`);
	if (mudaram.length > 0) {
		console.log(`\n${mudaram.length} par(es) mudaram 5 minutos ou mais:`);
		for (const l of mudaram.slice(0, 40)) console.log(`    ${l}`);
		if (mudaram.length > 40) console.log(`    … e mais ${mudaram.length - 40}`);
	}
	if (novos > 0) console.log(`\n${novos} par(es) novos.`);
	if (mudaram.length === 0 && novos === 0) {
		console.log('Nada mudou — a matriz de tempos no repositório continua válida.');
	}
}

function gerarMigracao(minutos, medidoEm) {
	const chaves = [...minutos.keys()].sort();
	const lotes = [];
	for (let i = 0; i < chaves.length; i += 500) {
		const valores = chaves
			.slice(i, i + 500)
			.map((k) => {
				const [a, b] = k.split('-');
				return `('${a}','${b}',${minutos.get(k)})`;
			})
			.join(',');
		lotes.push(
			`INSERT OR REPLACE INTO \`tempos_municipios\` (\`origem_ibge\`,\`destino_ibge\`,\`minutos\`) VALUES ${valores};`
		);
	}

	return `-- MATRIZ DE TEMPO DE TRAJETO entre os municípios do Ceará, em minutos.
--
-- Gerado por \`node scripts/gerar-tempos.mjs\` — não edite à mão. O cabeçalho do
-- script explica por que é uma tabela SEPARADA de \`distancias_municipios\` (que
-- decide a rubrica do plano operacional e não muda), por que as sedes vêm da
-- 0072 e como a medição é conferida contra ela.
--
-- Serve ao módulo de diárias: o Decreto nº 35.922/2024 presume a jornada de uma
-- missão como 2 × tempo de ida + permanência, e é essa conta que concede ou
-- nega a meia diária (\`$lib/diarias/jornada\`, entrada \`minutosIda\`). Esta
-- tabela só PRÉ-PREENCHE — o que vale para um pedido fica gravado nele.
CREATE TABLE IF NOT EXISTS \`tempos_municipios\` (
	-- Par NÃO ordenado, menor código primeiro — a mesma chave da matriz de
	-- distâncias (\`chaveDoPar\`). Média das duas direções, arredondada ao minuto.
	\`origem_ibge\` text NOT NULL,
	\`destino_ibge\` text NOT NULL,
	\`minutos\` integer NOT NULL,
	PRIMARY KEY (\`origem_ibge\`, \`destino_ibge\`),
	FOREIGN KEY (\`origem_ibge\`) REFERENCES \`municipios\`(\`ibge\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`destino_ibge\`) REFERENCES \`municipios\`(\`ibge\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Procedência, uma linha para a matriz inteira — como \`distancias_medicao\`.
CREATE TABLE IF NOT EXISTS \`tempos_medicao\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`fonte\` text NOT NULL,
	\`medido_em\` text NOT NULL,
	\`pares\` integer NOT NULL
);
--> statement-breakpoint
${lotes.join('\n--> statement-breakpoint\n')}
--> statement-breakpoint
INSERT INTO \`tempos_medicao\` (\`fonte\`,\`medido_em\`,\`pares\`)
VALUES ('OSRM/OpenStreetMap (ODbL); sedes da migração 0072', ${sq(medidoEm)}, ${minutos.size});
`;
}

const { sedes, km: km0072 } = lerMigracao0072();
console.error(`[tempos] ${sedes.length} sedes lidas de ${ORIGEM_SEDES}.`);
if (sedes.length !== 184) {
	console.error('⚠ esperava 184 sedes na 0072 — confira antes de usar este resultado.');
	process.exit(1);
}

console.error('[tempos] medindo a matriz de tempo (OSRM)…');
const { minutos, km, semRota } = await montarMatrizes(sedes);
if (semRota.length > 0) {
	console.error(`⚠ ${semRota.length} par(es) sem rota; ficam de fora da tabela:`);
	for (const p of semRota.slice(0, 10)) console.error(`    ${p}`);
}
conferirDistancias(km, km0072, sedes);

if (modoDiff) {
	const anterior = matrizAnterior();
	if (!anterior) {
		console.error(
			'Não há matriz de tempos no repositório para comparar. Rode sem --diff para gerar.'
		);
		process.exit(1);
	}
	mostrarDiff(anterior, minutos, sedes);
	process.exit(0);
}

const medidoEm = new Date().toISOString().slice(0, 10);
writeFileSync(DESTINO, gerarMigracao(minutos, medidoEm));
console.error(`\n[tempos] ${DESTINO} — ${minutos.size} pares, medido em ${medidoEm}.`);
console.error(
	'CONFIRA alguns pares conhecidos antes de commitar: matriz errada passa em todo teste.'
);
