/**
 * Como cada pergunta é LIDA do blob de respostas.
 *
 * É a conta que as três formas do painel compartilham (colunas, ranking e o
 * total do card), e ela morava em três lugares até ago/2026 — com a de armas já
 * divergindo das outras duas. O que estes testes guardam é a unificação.
 *
 * O caso central é o GATE DO "SIM". O blob guarda o que foi digitado: quem
 * preenche a listagem, muda de ideia e responde "Não" deixa a quantidade lá. O
 * relatório assinado sempre ignorou esse resto — só expande a lista sob um
 * "Sim" —, e o painel não ignorava. As duas leituras do mesmo dado discordavam,
 * e a do painel contava produção que o PDF não mostra.
 */
import { describe, it, expect } from 'vitest';
import { valorDaResposta, detalhePorTipo, formasDaMarca, tituloNoPainel } from '../apresentacao';

/** Uma pergunta como `mapQuestions` a entrega — tipo, `key` e a chave da resposta. */
function pergunta(tipo: string, key: string, mappedKey = key) {
	return { tipo, key, mappedKey };
}

describe('valorDaResposta', () => {
	it('soma o número da chave mapeada, não da `key`', () => {
		// Nos tipos de lista a resposta mora na chave de QUANTIDADE. Ler por `key`
		// daria `undefined` → zero, sem erro nenhum.
		const q = pergunta('celulares_complex', 'apreensao_celulares', 'celulares_qtd');
		expect(valorDaResposta({ apreensao_celulares: 'Sim', celulares_qtd: 4 }, q)).toBe(4);
	});

	it('`sim_nao` conta ocorrências', () => {
		const q = pergunta('sim_nao', 'tentativa');
		expect(valorDaResposta({ tentativa: 'Sim' }, q)).toBe(1);
		expect(valorDaResposta({ tentativa: 'Não' }, q)).toBe(0);
	});

	describe('o gate do "Sim"', () => {
		const q = pergunta('prisoes_maiores', 'flagrante_bool', 'prisoes_qtd');

		it('conta a quantidade quando a pergunta foi respondida Sim', () => {
			expect(valorDaResposta({ flagrante_bool: 'Sim', prisoes_qtd: 3 }, q)).toBe(3);
		});

		it('NÃO conta a quantidade que sobrou de um "Não"', () => {
			// É o caso real: preencheu 3, mudou para "Não", e o 3 ficou no blob. O PDF
			// não mostra a lista; o painel também não pode mostrar o número.
			expect(valorDaResposta({ flagrante_bool: 'Não', prisoes_qtd: 3 }, q)).toBe(0);
		});

		it('vale igual nos tipos SEINT, que não tinham o gate', () => {
			const seint = pergunta('foragidos_complex', 'foragidos_bool', 'foragidos_qtd');
			expect(valorDaResposta({ foragidos_bool: 'Não', foragidos_qtd: 9 }, seint)).toBe(0);
			expect(valorDaResposta({ foragidos_bool: 'Sim', foragidos_qtd: 9 }, seint)).toBe(9);
		});

		it('não se aplica à lista PURA, que não tem par Sim/Não', () => {
			// A listagem dela aparece de saída; exigir um "Sim" que a tela nunca
			// pergunta zeraria a pergunta inteira.
			const pura = pergunta('operacoes_seint_pura', 'ops', 'operacoes_seint_qtd');
			expect(valorDaResposta({ operacoes_seint_qtd: 5 }, pura)).toBe(5);
		});
	});

	describe('drogas', () => {
		const q = pergunta('drogas_complex', 'apreensoes_drogas');

		it('normaliza quilo em grama antes de somar', () => {
			// Sem isso 2 kg e 2 g virariam o mesmo 2.
			const res = {
				drogas_detalhe: { MACONHA: 2, COCAINA: 500 },
				drogas_unidade: { MACONHA: 'kg', COCAINA: 'g' }
			};
			expect(valorDaResposta(res, q)).toBe(2500);
		});

		it('sem unidade declarada assume grama', () => {
			expect(valorDaResposta({ drogas_detalhe: { CRACK: 30 } }, q)).toBe(30);
		});

		it('resposta sem detalhe nenhum vale zero', () => {
			expect(valorDaResposta({}, q)).toBe(0);
		});
	});

	describe('armas', () => {
		const q = pergunta('armas_complex', 'apreensoes_armas_bool');

		it('soma as quantidades por tipo', () => {
			const res = { apreensoes_armas_bool: 'Sim', armas_detalhe: { REVOLVER: 1, PISTOLA: 2 } };
			expect(valorDaResposta(res, q)).toBe(3);
		});

		it('não conta a lista digitada e depois negada', () => {
			const res = { apreensoes_armas_bool: 'Não', armas_detalhe: { REVOLVER: 1 } };
			expect(valorDaResposta(res, q)).toBe(0);
		});
	});
});

describe('detalhePorTipo', () => {
	const drogas = pergunta('drogas_complex', 'apreensoes_drogas');

	it('acumula por categoria entre as respostas, do maior para o menor', () => {
		const linhas = [
			{ respostasParsed: { drogas_detalhe: { MACONHA: 100, CRACK: 50 } } },
			{ respostasParsed: { drogas_detalhe: { MACONHA: 200 } } }
		];
		const { linhas: saida, total } = detalhePorTipo(linhas, drogas);

		expect(saida).toEqual([
			['MACONHA', 300],
			['CRACK', 50]
		]);
		expect(total).toBe(350);
	});

	it('corta as categorias excedentes SEM mexer no total', () => {
		// O corte é da apresentação — o card mostra oito barras e o total de tudo.
		const detalhe: Record<string, number> = {};
		for (let i = 0; i < 12; i++) detalhe[`D${i}`] = i + 1;
		const { linhas, total } = detalhePorTipo(
			[{ respostasParsed: { drogas_detalhe: detalhe } }],
			drogas
		);

		expect(linhas).toHaveLength(8);
		expect(total).toBe(78);
	});

	it('respeita o gate do "Sim" em armas', () => {
		const armas = pergunta('armas_complex', 'apreensoes_armas_bool');
		const linhas = [
			{ respostasParsed: { apreensoes_armas_bool: 'Sim', armas_detalhe: { REVOLVER: 2 } } },
			{ respostasParsed: { apreensoes_armas_bool: 'Não', armas_detalhe: { PISTOLA: 9 } } }
		];
		const { linhas: saida, total } = detalhePorTipo(linhas, armas);

		expect(saida).toEqual([['REVOLVER', 2]]);
		expect(total).toBe(2);
	});

	it('tipo sem quebra por categoria devolve vazio', () => {
		const numero = pergunta('numero', 'atend');
		expect(detalhePorTipo([{ respostasParsed: { atend: 7 } }], numero)).toEqual({
			linhas: [],
			total: 0
		});
	});
});

describe('formasDaMarca', () => {
	it('traduz o booleano ANTIGO em colunas', () => {
		// Formato entre as migrações 0053 e 0054, ainda possível numa sub-pergunta.
		expect(formasDaMarca(true)).toEqual({ colunas: true, ranking: false, detalhe: false });
	});

	it('marca ausente é nenhuma forma', () => {
		expect(formasDaMarca(undefined)).toEqual({ colunas: false, ranking: false, detalhe: false });
		expect(formasDaMarca(false)).toEqual({ colunas: false, ranking: false, detalhe: false });
	});

	it('completa as formas ausentes do objeto', () => {
		expect(formasDaMarca({ ranking: true })).toEqual({
			colunas: false,
			ranking: true,
			detalhe: false
		});
	});
});

describe('tituloNoPainel', () => {
	it('o rótulo do admin ganha do texto da pergunta', () => {
		expect(
			tituloNoPainel({
				tipo: 'numero',
				texto: '3. QUANTOS ATENDIMENTOS FORAM REALIZADOS?',
				rotulo_painel: 'Atendimentos'
			})
		).toBe('Atendimentos');
	});

	it('o rótulo do admin ganha até da identidade fixa de drogas e armas', () => {
		// "Drogas" é padrão de fábrica; quem monta a operação pode preferir
		// "Entorpecentes". Escolha explícita vence padrão — se não vencesse, o campo
		// simplesmente não teria efeito nessas duas perguntas, e nada na tela diria
		// por quê.
		expect(
			tituloNoPainel({
				tipo: 'drogas_complex',
				texto: '10. HOUVE APREENSÃO DE DROGAS?',
				rotulo_painel: 'Entorpecentes'
			})
		).toBe('Entorpecentes');
	});

	it('sem rótulo, drogas e armas mantêm a identidade dos cards antigos', () => {
		expect(tituloNoPainel({ tipo: 'drogas_complex', texto: '10. HOUVE APREENSÃO?' })).toBe(
			'Drogas'
		);
		expect(tituloNoPainel({ tipo: 'armas_complex', texto: '11. HOUVE APREENSÃO?' })).toBe('Armas');
	});

	it('sem rótulo e sem identidade, o texto da pergunta', () => {
		expect(tituloNoPainel({ tipo: 'numero', texto: 'ATENDIMENTOS' })).toBe('ATENDIMENTOS');
	});

	it('rótulo em branco ou só espaços NÃO conta como escolha', () => {
		// Um campo de texto devolve `' '` com a mesma facilidade com que devolve
		// `''` — e um título de um espaço deixaria o card sem cabeçalho, sem erro
		// em lugar nenhum.
		expect(tituloNoPainel({ tipo: 'numero', texto: 'ATENDIMENTOS', rotulo_painel: '' })).toBe(
			'ATENDIMENTOS'
		);
		expect(tituloNoPainel({ tipo: 'numero', texto: 'ATENDIMENTOS', rotulo_painel: '   ' })).toBe(
			'ATENDIMENTOS'
		);
		expect(tituloNoPainel({ tipo: 'drogas_complex', texto: 'X', rotulo_painel: '  ' })).toBe(
			'Drogas'
		);
	});

	it('preserva os espaços internos do rótulo, aparando só as pontas', () => {
		expect(tituloNoPainel({ tipo: 'numero', texto: 'X', rotulo_painel: '  Armas de fogo  ' })).toBe(
			'Armas de fogo'
		);
	});
});
