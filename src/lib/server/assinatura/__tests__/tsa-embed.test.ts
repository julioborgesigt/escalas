/**
 * O contrato BEST-EFFORT do carimbo de tempo.
 *
 * A regra é uma só e vale para os dois fluxos (assinatura qualificada e selo
 * institucional): **nada relacionado à TSA pode derrubar um ato de assinatura
 * já consumado**. A rede caiu, a TSA devolveu erro, o token não coube no
 * placeholder — em todos os casos o PDF sai válido, só que sem carimbo.
 *
 * Antes da extração isso vivia em duas cópias, e nenhuma tinha teste: bastava
 * alguém "melhorar" o tratamento de erro de um lado para as duas políticas
 * divergirem sem que nada acusasse. Cada `it` abaixo é um modo de falha que,
 * se propagasse, transformaria uma assinatura boa em erro 500 na cara do
 * policial que acabou de assinar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import forge from 'node-forge';

const solicitarCarimboTempo = vi.fn();
const adicionarTimestampTokenAoCms = vi.fn();
const embedCmsBytesNoPlaceholder = vi.fn();

vi.mock('../tsa', () => ({
	solicitarCarimboTempo: (...a: unknown[]) => solicitarCarimboTempo(...a)
}));
vi.mock('../cms-tst', () => ({
	adicionarTimestampTokenAoCms: (...a: unknown[]) => adicionarTimestampTokenAoCms(...a)
}));
vi.mock('../pdf-signing-prepare', () => ({
	embedCmsBytesNoPlaceholder: (...a: unknown[]) => embedCmsBytesNoPlaceholder(...a)
}));
vi.mock('../../logger', () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));

const { anexarCarimboTempo, tstEmBase64 } = await import('../tsa-embed');

const PDF = new Uint8Array([1, 2, 3]);
const CMS = new Uint8Array([9, 9]);
const PDF_CARIMBADO = new Uint8Array([4, 5, 6, 7]);
const CMS_CARIMBADO = new Uint8Array([8, 8, 8]);
const ENV = { TSA_URL: 'https://tsa.exemplo/tsr', TSA_USERNAME: 'u', TSA_PASSWORD: 'p' };

/** ASN.1 mínimo e serializável — o TST de mentira dos casos de sucesso. */
const tstAsn1 = forge.asn1.create(
	forge.asn1.Class.UNIVERSAL,
	forge.asn1.Type.OCTETSTRING,
	false,
	'tst'
);

beforeEach(() => {
	vi.clearAllMocks();
	adicionarTimestampTokenAoCms.mockReturnValue(CMS_CARIMBADO);
	embedCmsBytesNoPlaceholder.mockReturnValue(PDF_CARIMBADO);
});

describe('anexarCarimboTempo', () => {
	it('sem TSA_URL, devolve a entrada intacta e nem chama a TSA', async () => {
		const r = await anexarCarimboTempo(PDF, CMS, 'sig', {}, '[teste]');
		expect(r).toEqual({ pdf: PDF, cmsDer: CMS, aplicado: false });
		expect(solicitarCarimboTempo).not.toHaveBeenCalled();
	});

	it('env indefinido também não é erro — é instalação sem carimbo', async () => {
		const r = await anexarCarimboTempo(PDF, CMS, 'sig', undefined, '[teste]');
		expect(r.aplicado).toBe(false);
		expect(r.pdf).toBe(PDF);
	});

	it('sucesso: troca PDF e CMS, marca aplicado e guarda o token em base64', async () => {
		solicitarCarimboTempo.mockResolvedValue({ ok: true, tstAsn1 });

		const r = await anexarCarimboTempo(PDF, CMS, 'assinatura', ENV, '[teste]');

		expect(r.aplicado).toBe(true);
		expect(r.pdf).toBe(PDF_CARIMBADO);
		expect(r.cmsDer).toBe(CMS_CARIMBADO);
		expect(r.tstTokenB64).toBe(forge.util.encode64(forge.asn1.toDer(tstAsn1).getBytes()));
		// O carimbo incide sobre a ASSINATURA, não sobre o PDF: é o
		// signatureValue que a TSA atesta ter existido naquele instante.
		expect(solicitarCarimboTempo).toHaveBeenCalledWith('assinatura', {
			url: ENV.TSA_URL,
			username: 'u',
			password: 'p'
		});
		// E o TST entra no CMS que estava no PDF, não em outro.
		expect(adicionarTimestampTokenAoCms).toHaveBeenCalledWith(CMS, tstAsn1);
	});

	it('TSA respondendo erro: assinatura sobrevive sem carimbo', async () => {
		solicitarCarimboTempo.mockResolvedValue({ ok: false, error: 'TSA fora do ar' });

		const r = await anexarCarimboTempo(PDF, CMS, 'sig', ENV, '[teste]');

		expect(r).toEqual({ pdf: PDF, cmsDer: CMS, aplicado: false });
		expect(embedCmsBytesNoPlaceholder).not.toHaveBeenCalled();
	});

	it('TSA lançando (rede caiu) não propaga', async () => {
		solicitarCarimboTempo.mockRejectedValue(new Error('ECONNRESET'));
		await expect(anexarCarimboTempo(PDF, CMS, 'sig', ENV, '[teste]')).resolves.toEqual({
			pdf: PDF,
			cmsDer: CMS,
			aplicado: false
		});
	});

	it('TST que não cabe no placeholder não invalida o que já foi assinado', async () => {
		// O modo de falha mais traiçoeiro: a TSA respondeu, o carimbo é bom, e é
		// o re-embed que estoura. Sem este catch o policial receberia 500 depois
		// de a assinatura já ter sido criada.
		solicitarCarimboTempo.mockResolvedValue({ ok: true, tstAsn1 });
		embedCmsBytesNoPlaceholder.mockImplementation(() => {
			throw new Error('CMS excede o placeholder');
		});

		const r = await anexarCarimboTempo(PDF, CMS, 'sig', ENV, '[teste]');

		expect(r).toEqual({ pdf: PDF, cmsDer: CMS, aplicado: false });
	});

	it('CMS malformado na hora de anexar o TST também é absorvido', async () => {
		solicitarCarimboTempo.mockResolvedValue({ ok: true, tstAsn1 });
		adicionarTimestampTokenAoCms.mockImplementation(() => {
			throw new Error('estrutura inesperada');
		});

		const r = await anexarCarimboTempo(PDF, CMS, 'sig', ENV, '[teste]');
		expect(r.aplicado).toBe(false);
		expect(r.pdf).toBe(PDF);
	});
});

describe('tstEmBase64', () => {
	it('serializa o token', () => {
		expect(tstEmBase64(tstAsn1)).toBe(forge.util.encode64(forge.asn1.toDer(tstAsn1).getBytes()));
	});

	it('ASN.1 inserializável vira undefined, não exceção', () => {
		// É METADADO de auditoria: perdê-lo não pode derrubar um carimbo que já
		// está embutido no PDF.
		const quebrado = { tagClass: 999, type: 999, constructed: true } as unknown as forge.asn1.Asn1;
		expect(() => tstEmBase64(quebrado)).not.toThrow();
		expect(tstEmBase64(quebrado)).toBeUndefined();
	});
});
