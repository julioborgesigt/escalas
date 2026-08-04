/**
 * O cabeçalho "DELEGACIA:" tem de dizer a mesma coisa nos três formatos.
 *
 * Ele já divergiu: no PLANTÃO, o PDF imprimia `lotacao` (o nome da unidade) e o
 * DOCX/XLSX imprimiam `cidade` (o município). São colunas distintas de
 * `escalas` — o servidor que abria a planilha da sua escala lia
 * "DELEGACIA: JUAZEIRO DO NORTE" onde o PDF dizia
 * "DELEGACIA: 1ª DELEGACIA DE JUAZEIRO DO NORTE".
 *
 * Nada pegava: só o PDF tem golden, e os cabeçalhos de `docx.ts`/`xlsx.ts`
 * prometem em prosa que "planilha, DOCX e PDF descrevem a mesma escala" — uma
 * promessa que nenhum teste cobrava. Agora o rótulo tem fonte única
 * (`cabecalhoDelegacia`) e o XLSX é conferido de ponta a ponta: gerado de
 * verdade e relido, para provar que a string chega ao arquivo entregue.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import type { Escala, EscalaPolicialComDados } from '$lib/types';
import { cabecalhoDelegacia, CORPORACAO, DELEGACIA_GERAL, DEPARTAMENTO } from '../shared';
import { gerarXlsxPlantao, gerarXlsxExpediente } from '../xlsx';

/** Escala em que município e unidade são DIFERENTES — sem isso o teste não distingue nada. */
const escala = {
	id: 1,
	titulo: 'ESCALA DE PLANTÃO',
	cidade: 'Juazeiro do Norte',
	lotacao: '1ª Delegacia de Juazeiro do Norte',
	data_inicio: '2026-08-01',
	data_fim: '2026-08-31',
	hora_entrada: '08',
	hora_saida: '08',
	tipo: 'plantao'
} as unknown as Escala;

const policiais = [
	{
		id: 1,
		policial_id: 10,
		nome: 'FULANO DE TAL',
		matricula: '12345',
		cargo: 'OIP',
		telefone: '85999990000',
		lotacao: '1ª Delegacia de Juazeiro do Norte',
		data_plantao: '2026-08-01',
		hora_entrada: '08',
		hora_saida: '08',
		equipe: '1',
		observacoes: ''
	}
] as unknown as EscalaPolicialComDados[];

/** Concatena o texto de todas as células da primeira planilha. */
async function textoDoXlsx(bytes: Uint8Array): Promise<string> {
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.load(bytes.buffer as ArrayBuffer);
	const linhas: string[] = [];
	wb.worksheets[0].eachRow((row) => {
		row.eachCell({ includeEmpty: false }, (cell) => linhas.push(String(cell.value ?? '')));
	});
	return linhas.join('\n');
}

describe('cabecalhoDelegacia', () => {
	it('usa a UNIDADE, não o município', () => {
		expect(cabecalhoDelegacia(escala)).toBe('DELEGACIA: 1ª DELEGACIA DE JUAZEIRO DO NORTE');
		expect(cabecalhoDelegacia(escala)).not.toContain('JUAZEIRO DO NORTE —');
	});

	it('não confunde as duas colunas quando uma contém a outra', () => {
		// "Juazeiro do Norte" é substring do nome da unidade: um teste que só
		// procurasse a cidade passaria por engano. Daí a comparação exata acima.
		expect(escala.lotacao.toUpperCase()).toContain(escala.cidade.toUpperCase());
	});
});

describe('XLSX gerado de verdade', () => {
	it('plantão traz o nome da unidade no cabeçalho DELEGACIA', async () => {
		const texto = await textoDoXlsx(await gerarXlsxPlantao(escala, policiais));
		expect(texto).toContain('DELEGACIA: 1ª DELEGACIA DE JUAZEIRO DO NORTE');
		// A regressão original: o município sozinho após o rótulo.
		expect(texto).not.toContain('DELEGACIA: JUAZEIRO DO NORTE —');
	});

	it('expediente idem — os dois tipos usam a mesma fonte', async () => {
		const texto = await textoDoXlsx(await gerarXlsxExpediente(escala, policiais));
		expect(texto).toContain('DELEGACIA: 1ª DELEGACIA DE JUAZEIRO DO NORTE');
	});
});

/**
 * O timbre institucional é um GOLDEN, não uma verificação de lógica: as três
 * linhas nomeiam órgãos reais em documento oficial impresso e assinado, e a
 * comparação literal é o que força uma mudança de grafia a aparecer no diff em
 * vez de entrar de carona num refactor.
 *
 * O PDF já está coberto por `pdf-goldens`; o XLSX é conferido de ponta a ponta
 * aqui. O DOCX segue sem verificação de saída — ler um .docx exigiria um leitor
 * de zip que o projeto não tem como dependência direta —, mas desde a extração
 * das constantes ele não pode mais divergir sozinho: as três linhas vêm da
 * mesma fonte que o PDF e a planilha.
 */
describe('timbre institucional', () => {
	it('mantém a grafia oficial das três linhas', () => {
		expect(CORPORACAO).toBe('POLÍCIA CIVIL DO ESTADO DO CEARÁ');
		expect(DELEGACIA_GERAL).toBe('DELEGACIA GERAL DE POLÍCIA CIVIL');
		expect(DEPARTAMENTO).toBe('DEPARTAMENTO DE POLÍCIA DO INTERIOR SUL - DPI SUL');
	});

	it('não ressuscita o "Departamento de Polícia JUDICIÁRIA"', () => {
		// O cabeçalho do plantão em PDF nomeava um órgão inexistente até ago/2026.
		expect(DEPARTAMENTO).not.toContain('JUDICIÁRIA');
	});

	it('chega ao XLSX de expediente nas três linhas', async () => {
		const texto = await textoDoXlsx(await gerarXlsxExpediente(escala, policiais));
		expect(texto).toContain(CORPORACAO);
		expect(texto).toContain(DELEGACIA_GERAL);
		expect(texto).toContain(DEPARTAMENTO);
	});

	it('chega ao XLSX de plantão (que só imprime a corporação)', async () => {
		const texto = await textoDoXlsx(await gerarXlsxPlantao(escala, policiais));
		expect(texto).toContain(CORPORACAO);
	});
});
