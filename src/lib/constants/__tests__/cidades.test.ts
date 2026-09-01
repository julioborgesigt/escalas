import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CIDADES_CEARA } from '../cidades';

/**
 * `CIDADES_CEARA` e a tabela `municipios` são DUAS listas dos mesmos 184 nomes.
 *
 * A constante existe porque alimenta um `<select>` em `/unidades` e não deve
 * virar consulta ao banco; a tabela existe porque a matriz de distâncias precisa
 * de código IBGE e coordenada. Nenhuma das duas pode sumir.
 *
 * O que não pode é DIVERGIREM: um município escrito com grafia diferente nos
 * dois lados faz a opção de origem/destino do plano não casar com município
 * nenhum, e a distância que era automática volta a ser manual — sem erro, sem
 * aviso, só um campo em branco que ninguém sabe explicar. Foi assim que o menu e
 * os quadros de boas-vindas divergiram (ver `bem-vindo-cards.test.ts`).
 *
 * A comparação é contra a MIGRAÇÃO, e não contra um banco montado no teste:
 * é aquele arquivo que vai para produção, e é ele que precisa concordar.
 */
const MIGRACAO = fileURLToPath(
	new URL('../../../../migrations/0072_municipios_distancias.sql', import.meta.url)
);

/** Os nomes semeados na tabela, na ordem em que a migração os insere. */
function nomesDaMigracao(): string[] {
	const sql = readFileSync(MIGRACAO, 'utf8');
	const nomes: string[] = [];
	for (const m of sql.matchAll(/\('\d{7}','((?:[^']|'')*)','CE',/g)) {
		nomes.push(m[1].replace(/''/g, "'"));
	}
	return nomes;
}

describe('CIDADES_CEARA e a tabela municipios', () => {
	it('têm os mesmos 184 municípios', () => {
		const daTabela = nomesDaMigracao();
		expect(daTabela).toHaveLength(184);
		expect(CIDADES_CEARA).toHaveLength(184);
		expect([...daTabela].sort()).toEqual([...CIDADES_CEARA].sort());
	});

	it('escrevem cada nome exatamente igual — acento incluído', () => {
		// Comparar conjuntos já pegaria isto, mas a mensagem de falha ali diz "os
		// arrays diferem". Nomear a diferença é o que faz alguém achar "Cariús"
		// contra "Carius" sem abrir os dois arquivos.
		const daTabela = new Set(nomesDaMigracao());
		const semPar = CIDADES_CEARA.filter((c) => !daTabela.has(c));
		expect(semPar, `sem correspondência em municipios: ${semPar.join(', ')}`).toEqual([]);
	});
});
