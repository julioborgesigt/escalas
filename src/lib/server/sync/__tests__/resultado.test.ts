/**
 * Sincronização parcial não é sucesso — FLW-WEBHOOK-002.
 *
 * Os dois webhooks descartavam em silêncio a linha que não sabiam classificar,
 * e `sync-unidades` respondia `success: true` mesmo com falhas. Do lado de quem
 * opera a planilha, o efeito era o pior possível: a sincronização "deu certo" e
 * o policial simplesmente não estava lá.
 *
 * A distinção que decide tudo é a do primeiro bloco. Recusar o lote por causa
 * de linha em branco tornaria o webhook inútil — planilha do Google manda
 * linhas vazias no fim da faixa o tempo todo. Recusar por causa de linha
 * INCOMPLETA é o oposto: alguém digitou ali.
 */
import { describe, it, expect } from 'vitest';
import { linhaVazia, respostaDeSync } from '../resultado';

describe('linhaVazia — o único descarte legítimo', () => {
	it('linha sem nenhuma célula preenchida é vazia', () => {
		expect(linhaVazia({ matricula: '', nome: '', cargo: null })).toBe(true);
		expect(linhaVazia({ a: '   ', b: undefined })).toBe(true);
		expect(linhaVazia({})).toBe(true);
	});

	it('linha com QUALQUER dado não é vazia — nem na coluna errada', () => {
		// É o caso do achado: alguém digitou o nome e esqueceu a matrícula. A
		// linha some, e nada avisa.
		expect(linhaVazia({ matricula: '', nome: 'Fulano' })).toBe(false);
		expect(linhaVazia({ observacao: 'x' })).toBe(false);
		expect(linhaVazia({ n: 0 }), '0 é dado').toBe(false);
	});
});

describe('respostaDeSync', () => {
	it('lote inteiro importado → 200', async () => {
		const r = respostaDeSync({ processadas: 3, importadas: 3, vazias: 0, erros: [] });
		expect(r.status).toBe(200);
		const corpo = await r.json();
		expect(corpo).toEqual({
			success: true,
			processed: 3,
			imported: 3,
			skippedEmpty: 0,
			failed: 0,
			errors: undefined
		});
	});

	it('linhas vazias não estragam o sucesso', async () => {
		const r = respostaDeSync({ processadas: 5, importadas: 3, vazias: 2, erros: [] });
		expect(r.status).toBe(200);
		expect((await r.json()).skippedEmpty).toBe(2);
	});

	it('sucesso PARCIAL responde 422, não 200', async () => {
		// O Apps Script remoto lê `error`/`details` e ignora `errors`; não dá para
		// corrigi-lo daqui. Mas dá para parar de dizer "200 OK" quando metade do
		// lote não entrou — um cliente que ignore o corpo ainda vê o status.
		const r = respostaDeSync({
			processadas: 3,
			importadas: 2,
			vazias: 0,
			erros: ['Linha 2: sem matrícula']
		});
		expect(r.status).toBe(422);
		const corpo = await r.json();
		expect(corpo.success).toBe(false);
		expect(corpo.failed).toBe(1);
		expect(corpo.errors).toEqual(['Linha 2: sem matrícula']);
	});

	it('o erro identifica a linha, não só o total', async () => {
		// Um contador não permite corrigir a planilha; o rótulo permite.
		const r = respostaDeSync({
			processadas: 2,
			importadas: 0,
			vazias: 0,
			erros: ['Delegacia "DP 5": falta o nome ou a seccional pai']
		});
		expect((await r.json()).errors[0]).toContain('DP 5');
	});
});
