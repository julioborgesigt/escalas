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
 *
 * **A varredura ENUMERA o diretório** (`actions-*.ts`) em vez de listar os
 * arquivos à mão. Quando as actions viviam todas em `+page.server.ts` bastava
 * ler um arquivo; agora que estão agrupadas, fixar a lista faria um
 * `actions-novo.ts` nascer fora do guard — e um guard que não vê o arquivo novo
 * é pior que guard nenhum, porque parece verde.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR_ACTIONS = dirname(dirname(fileURLToPath(import.meta.url)));

const ARQUIVOS = readdirSync(DIR_ACTIONS)
	.filter((f) => f.startsWith('actions-') && f.endsWith('.ts'))
	.sort();

const FONTE = ARQUIVOS.map((f) => readFileSync(join(DIR_ACTIONS, f), 'utf8')).join('\n');

/** As actions, pelo formato único do objeto `actions` destes arquivos. */
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
	it('lê todos os grupos de action do diretório', () => {
		// Se um grupo novo aparecer, ele entra sozinho — o que falha aqui é o
		// diretório ficar VAZIO por um rename que a varredura não acompanhou.
		expect(ARQUIVOS.length).toBeGreaterThanOrEqual(4);
	});

	it('catorze actions, nem mais nem menos', () => {
		// Mudou o número? Instrumente a action nova — não ajuste o total para o
		// teste voltar ao verde.
		expect(NOMES).toHaveLength(14);
	});

	it('nenhuma action ficou para trás em `+page.server.ts`', () => {
		// O arquivo da rota agora só compõe: `load` + spread dos grupos. Uma action
		// escrita direto ali escaparia da varredura acima.
		const rota = readFileSync(join(dirname(DIR_ACTIONS), '+page.server.ts'), 'utf8');
		expect(rota).not.toMatch(/^\t\w+: async \(/m);
	});

	it('as duas exceções continuam existindo', () => {
		for (const nome of AUDITAM_POR_CONTA_PROPRIA) expect(NOMES).toContain(nome);
	});
});

/**
 * As actions que recebem DATA do cliente — FLW-ESC-005.
 *
 * O calendário do modal é markup; quem limita de verdade é o servidor. Uma
 * action nova que aceite data e esqueça a validação repõe o buraco, e é por
 * isso que a lista está aqui em vez de espalhada em cinco testes.
 */
const RECEBEM_DATA = [
	'adicionar',
	'adicionarPlantao',
	'repetir',
	'editar',
	'editarPlantaoAgrupado'
];

describe('datas do cliente são validadas no servidor', () => {
	it.each(RECEBEM_DATA)('%s confere o período da escala', (nome) => {
		expect(NOMES, 'a action existe').toContain(nome);
		expect(corpo(nome)).toContain('erroDeDatasForaDoPeriodo(');
	});
});

describe('no FDS, a ENTREGA vem antes da finalização — FLW-ESC-006', () => {
	const corpoFinalizar = corpo('finalizar');

	it('o envio do e-mail acontece antes de gravar `finalizada_em`', () => {
		// A ordem É a correção. No FDS não há assinatura digital: o marco de
		// conclusão é a entrega. Gravar `finalizada_em` primeiro invertia isso — a
		// falha virava um `logger.warn`, a resposta dizia sucesso, e a escala
		// ficava fechada para edição sem que o e-mail tivesse saído.
		const posEnvio = corpoFinalizar.indexOf('enviarEscalaFDSPorEmail(');
		const posFinaliza = corpoFinalizar.indexOf('finalizarEscalaFDS(');
		expect(posEnvio, 'a action envia o e-mail').toBeGreaterThan(-1);
		expect(posFinaliza, 'a action finaliza').toBeGreaterThan(-1);
		expect(posEnvio).toBeLessThan(posFinaliza);
	});

	it('falha de envio devolve erro, não sucesso', () => {
		expect(corpoFinalizar).toContain('fail(502');
	});

	it('escala já finalizada é recusada em vez de refinalizada', () => {
		// Refinalizar gravaria um novo `finalizada_em` por cima do primeiro: a data
		// de conclusão do documento passaria a ser a da segunda tentativa.
		expect(corpoFinalizar).toContain('escala.finalizada_em');
		expect(corpoFinalizar).toContain('fail(409');
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
		expect(corpo(nome)).toMatch(/async \(event: Event\) =>/);
	});
});

describe('o preâmbulo é o mesmo para todas — FLW-ESC-003', () => {
	it.each(NOMES)('%s começa por carregarEscalaComPermissao', (nome) => {
		// O guard de imutabilidade (assinada/finalizada não muda de composição) e a
		// restrição por lotação moram lá dentro. Uma action que carregue a escala
		// por conta própria repõe o buraco que a extração fechou.
		expect(corpo(nome)).toContain('carregarEscalaComPermissao(');
	});
});
