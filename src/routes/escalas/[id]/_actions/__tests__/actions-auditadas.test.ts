/**
 * Toda action material de `/escalas/[id]` registra o que fez — FLW-ESC-007.
 *
 * São catorze, e só duas chamavam a auditoria. Trocar quem está de plantão num
 * sábado é ato administrativo com consequência funcional, e a trilha não sabia
 * dizer quem trocou — nem quantas pessoas foram afetadas, que é a diferença
 * entre corrigir um horário e refazer o mês.
 *
 * A leitura é textual, pelo mesmo motivo do guard equivalente da GISE
 * (`gise/[id]/_actions/__tests__/actions-auditadas.test.ts`): chamar cada action
 * exigiria RequestEvent, FormData, sessão e D1 para cada uma das catorze, e o
 * que se mediria ao fim é o que está escrito aqui. O achado nunca foi uma
 * action instrumentada errado — eram doze sem instrumentação nenhuma.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROTA = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const FONTE = readFileSync(join(ROTA, '+page.server.ts'), 'utf8');

/** As actions, pelo formato único do objeto `actions` deste arquivo. */
const NOMES = [...FONTE.matchAll(/^\t(\w+): async \(/gm)].map((m) => m[1]);

/** O corpo de uma action, do cabeçalho dela até o da seguinte. */
function corpo(nome: string): string {
	const inicio = FONTE.indexOf(`\t${nome}: async (`);
	const resto = FONTE.slice(inicio + 1);
	const proxima = resto.search(/^\t\w+: async \(/m);
	return proxima === -1 ? resto : resto.slice(0, proxima);
}

/**
 * As duas que já auditavam usam `registrarAuditComContexto` direto: `finalizar`
 * porque o evento carrega o resultado do envio de e-mail, e `gerarProximoMes`
 * porque a entidade do evento é a escala NOVA, não a da URL — nenhuma das duas
 * cabe no contrato de `registrarMudancaEscala`, que fixa `entidade_id` na
 * escala da rota. Ficam declaradas aqui em vez de espalhadas: a lista é o que
 * distingue "audita de outro jeito" de "não audita".
 */
const AUDITAM_POR_CONTA_PROPRIA = new Set(['finalizar', 'gerarProximoMes']);

describe('cobertura da varredura', () => {
	it('catorze actions, nem mais nem menos', () => {
		// Mudou o número? Instrumente a action nova — não ajuste o total para o
		// teste voltar ao verde.
		expect(NOMES).toHaveLength(14);
	});

	it('as duas exceções continuam existindo', () => {
		for (const nome of AUDITAM_POR_CONTA_PROPRIA) expect(NOMES).toContain(nome);
	});
});

describe('cada action material deixa trilha', () => {
	it.each(NOMES.filter((n) => !AUDITAM_POR_CONTA_PROPRIA.has(n)))(
		'%s chama registrarMudancaEscala',
		(nome) => {
			expect(corpo(nome)).toContain('registrarMudancaEscala(event, {');
		}
	);

	it.each([...AUDITAM_POR_CONTA_PROPRIA])('%s audita pelo caminho declarado', (nome) => {
		expect(corpo(nome)).toContain('registrarAuditComContexto(db, {');
	});

	it.each(NOMES)('%s recebe o event inteiro', (nome) => {
		// `contextoDeEvento` precisa de `request`, `url`, `getClientAddress` e
		// `locals`. Desestruturar só `{ request, locals, platform, params }` na
		// assinatura deixaria o evento sem IP, rota e request_id — e, como os
		// cinco campos são opcionais, sem erro nenhum.
		expect(corpo(nome)).toMatch(/async \(event\) =>/);
	});
});
