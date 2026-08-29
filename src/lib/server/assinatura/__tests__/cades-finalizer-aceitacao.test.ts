/**
 * O portão de ACEITAÇÃO da assinatura — `verificarECarimbarAssinatura`, o que
 * roda em `finalizar-assinatura` e decide se a assinatura recém-embarcada
 * ENTRA no acervo.
 *
 * É o espelho de `pdf-verification-veredito`. Aquele prende o veredito sobre um
 * documento JÁ GUARDADO (o que a página `/validar` mostra); este prende a
 * decisão de guardar. Os dois rodam a mesma bateria de checagens e, até esta
 * data, só o primeiro estava preso: uma varredura de mutação sobre
 * `cades-finalizer.ts` encontrou 24 sobreviventes em 40, e o grosso deles são
 * as NEGAÇÕES dos guardas de recusa —
 *
 *     if (!integridadeOk) return { ok: false, status: 422, … }
 *
 * — onde remover o `!` inverte o portão: o PDF adulterado passa e o íntegro é
 * recusado, sem nada na suíte reclamar.
 *
 * Cada caso abaixo quebra UM check e deixa os outros de pé, senão a recusa não
 * prova qual guarda a produziu. As adulterações e o PDF realmente assinado vêm
 * de `./selo-fixture`, compartilhado com o teste do veredito.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
	gerarSelo,
	selarPdfDeTeste,
	montarTrustStore,
	trustStoreVazio,
	comConteudoAnexado,
	comBitTrocadoNaRegiaoAssinada,
	comAssinaturaCmsCorrompida,
	type TrustStoreFalso
} from './selo-fixture';

/**
 * O factory do `vi.mock` é içado para o topo do arquivo e lê esta variável de
 * forma preguiçosa, na chamada — por isso ela pode ser preenchida no
 * `beforeAll`. (Ver `selo-fixture`: o mock não pode ser importado de fora.)
 */
let trustStoreFalso: TrustStoreFalso | null = null;

vi.mock('../icp-brasil/trust-store', async (importOriginal) => {
	const real = await importOriginal<typeof import('../icp-brasil/trust-store')>();
	return {
		...real,
		loadTrustStore: () => trustStoreFalso ?? real.loadTrustStore()
	};
});

const { verificarECarimbarAssinatura, exigirTsa, tsaEmTextoClaro } =
	await import('../cades-finalizer');

let pdfSelado: Uint8Array;

beforeAll(async () => {
	const { bundle } = gerarSelo();
	pdfSelado = await selarPdfDeTeste(bundle, 'Documento para aceitacao');
	trustStoreFalso = await montarTrustStore(pdfSelado);
});

describe('verificarECarimbarAssinatura — a linha de base', () => {
	/**
	 * Sem um caso que ACEITA, nenhuma recusa adiante significa alguma coisa:
	 * um portão que recusa tudo passaria em todos os testes negativos.
	 */
	it('assinatura íntegra e com cadeia reconhecida é ACEITA', async () => {
		const r = await verificarECarimbarAssinatura(pdfSelado);
		expect(r.ok, 'ok' in r && !r.ok ? r.error : '').toBe(true);
	});
});

describe('verificarECarimbarAssinatura — cada guarda recusa sozinho', () => {
	it('PDF sem estrutura CMS é recusado com 422', async () => {
		const doc = await PDFDocument.create();
		doc.addPage([200, 200]);
		const r = await verificarECarimbarAssinatura(await doc.save());
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.status).toBe(422);
		expect(r.error).toMatch(/CMS detectável/);
	});

	it('conteúdo alterado dentro da região assinada é recusado (integridade)', async () => {
		const r = await verificarECarimbarAssinatura(await comBitTrocadoNaRegiaoAssinada(pdfSelado));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.status).toBe(422);
		expect(r.error).toMatch(/messageDigest/);
	});

	/**
	 * O caso que dá nome ao guarda: a integridade CONTINUA passando (o hash dos
	 * trechos declarados bate), e é só a cobertura que recusa. Sem ela, o
	 * shadow attack entraria no acervo como assinatura válida.
	 */
	it('conteúdo anexado após a assinatura é recusado (cobertura)', async () => {
		const r = await verificarECarimbarAssinatura(comConteudoAnexado(pdfSelado));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.status).toBe(422);
		expect(r.error).toMatch(/não cobre o documento completo/);
	});

	it('assinatura CMS corrompida é recusada, com integridade e cobertura intactas', async () => {
		const r = await verificarECarimbarAssinatura(await comAssinaturaCmsCorrompida(pdfSelado));
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.status).toBe(422);
		expect(r.error).toMatch(/SignedAttributes/);
	});

	it('chave RSA abaixo do mínimo é recusada (política criptográfica)', async () => {
		const { bundle } = gerarSelo(1024);
		const fraco = await selarPdfDeTeste(bundle, 'Chave fraca');
		const anterior = trustStoreFalso;
		trustStoreFalso = await montarTrustStore(fraco);
		try {
			const r = await verificarECarimbarAssinatura(fraco);
			expect(r.ok).toBe(false);
			if (r.ok) return;
			expect(r.status).toBe(422);
			expect(r.error).toMatch(/1024 bits/);
		} finally {
			trustStoreFalso = anterior;
		}
	});

	it('certificado fora da ICP-Brasil é recusado (cadeia)', async () => {
		const anterior = trustStoreFalso;
		// Trust store POPULADO, mas sem a âncora deste certificado: é o caso
		// `cadeia === false`, diferente do `'indisponivel'` abaixo.
		const outro = gerarSelo();
		const pdfOutro = await selarPdfDeTeste(outro.bundle, 'Outro emissor');
		trustStoreFalso = await montarTrustStore(pdfOutro);
		try {
			const r = await verificarECarimbarAssinatura(pdfSelado);
			expect(r.ok).toBe(false);
			if (r.ok) return;
			expect(r.status).toBe(422);
			expect(r.error).toMatch(/AC Raiz da ICP-Brasil/);
		} finally {
			trustStoreFalso = anterior;
		}
	});

	/**
	 * Trust store vazio é postura, não veredito: por padrão passa (implantação),
	 * e recusa quando a env exige. Em produção a env DEVE estar ligada — sem
	 * ela, um certificado autoassinado seria classificado como qualificada.
	 */
	it('trust store indisponível: passa por padrão, recusa com a env ligada', async () => {
		const anterior = trustStoreFalso;
		trustStoreFalso = trustStoreVazio();
		try {
			const solto = await verificarECarimbarAssinatura(pdfSelado);
			expect(solto.ok).toBe(true);

			const estrito = await verificarECarimbarAssinatura(pdfSelado, {
				env: { ICP_BRASIL_TRUST_STORE_REQUIRED: 'true' }
			});
			expect(estrito.ok).toBe(false);
			if (estrito.ok) return;
			expect(estrito.status).toBe(422);
		} finally {
			trustStoreFalso = anterior;
		}
	});

	/**
	 * Tempestividade oponível a terceiros (DOC-ICP-15, Decreto 10.278/2020
	 * art. 5º): com `EXIGIR_TSA_QUALIFICADA` ligada, só carimbo de ACT
	 * credenciada serve. O PDF selado carrega carimbo do SERVIDOR, então é
	 * exatamente o caso que a regra recusa — e inverter a comparação faria o
	 * portão aceitar o horário do servidor e recusar a ACT.
	 */
	it('com TSA qualificada exigida, carimbo do servidor é recusado', async () => {
		const semExigir = await verificarECarimbarAssinatura(pdfSelado);
		expect(semExigir.ok).toBe(true); // a exigência é opt-in

		const exigindo = await verificarECarimbarAssinatura(pdfSelado, {
			env: { EXIGIR_TSA_QUALIFICADA: 'true' }
		});
		expect(exigindo.ok).toBe(false);
		if (exigindo.ok) return;
		expect(exigindo.status).toBe(422);
		expect(exigindo.error).toMatch(/ACT credenciada ICP-Brasil/);
	});
});

/**
 * As duas leituras de env que decidem a postura de carimbo. São puras e
 * baratas de prender — e a varredura mostrou que nenhuma estava.
 */
describe('exigirTsa / tsaEmTextoClaro — leitura de configuração', () => {
	it('exigirTsa é opt-in e aceita as grafias usuais de verdadeiro', () => {
		expect(exigirTsa({})).toBe(false);
		expect(exigirTsa({ EXIGIR_TSA_QUALIFICADA: '' })).toBe(false);
		for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' true ']) {
			expect(exigirTsa({ EXIGIR_TSA_QUALIFICADA: v }), v).toBe(true);
		}
		for (const v of ['0', 'false', 'não', 'qualquer']) {
			expect(exigirTsa({ EXIGIR_TSA_QUALIFICADA: v }), v).toBe(false);
		}
	});

	/** `http:` é o alerta; ausência de URL não é — quem reclama disso é outro. */
	it('tsaEmTextoClaro distingue http de https e de URL ausente', () => {
		expect(tsaEmTextoClaro({ TSA_URL: 'http://timestamp.exemplo/tsa' })).toBe(true);
		expect(tsaEmTextoClaro({ TSA_URL: 'https://timestamp.exemplo/tsa' })).toBe(false);
		expect(tsaEmTextoClaro({ TSA_URL: '' })).toBe(false);
		expect(tsaEmTextoClaro({ TSA_URL: '   ' })).toBe(false);
		expect(tsaEmTextoClaro({ TSA_URL: 'nao-e-url' })).toBe(false);
	});
});
