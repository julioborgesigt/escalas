/**
 * PAdES-LT: embarca Document Security Store (DSS) no PDF assinado via
 * incremental update, conforme ETSI EN 319 142-1.
 *
 * O DSS contém todos os dados necessários para validar a assinatura
 * offline (cadeia de certificados + respostas OCSP + CRLs), tornando
 * o PDF auto-suficiente. Adobe Reader, Foxit e o validador da ITI
 * usam o DSS prioritariamente quando presente.
 *
 * Estratégia: o PDF original (já assinado) NÃO é alterado byte a byte;
 * apenas anexamos uma nova "revisão" ao final contendo:
 *   - novos objetos stream (1 por cert, 1 por OCSP, 1 por CRL)
 *   - novo objeto DSS dictionary
 *   - nova versão do catalog (mesmo número de objeto) com /DSS apontando
 *     para o DSS dictionary
 *   - nova xref subsection mapeando os novos objetos
 *   - novo trailer com /Prev apontando para a xref anterior
 *
 * Isso preserva o /ByteRange e /Contents da assinatura existente, mantendo-a
 * verificável.
 */

import { PDFDocument, PDFName, PDFArray, type PDFRef, type PDFDict, type PDFObject } from 'pdf-lib';
import { logger } from './logger';

export interface DssData {
	/** Certificados X.509 em DER (signatário, intermediárias, raiz). */
	certs: Uint8Array[];
	/** Respostas OCSP em DER (RFC 6960). */
	ocsps: Uint8Array[];
	/** CRLs em DER (RFC 5280). */
	crls: Uint8Array[];
}

const TE = new TextEncoder();

function concatBytes(parts: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const p of parts) total += p.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

/**
 * Serializa um objeto stream binário no formato PDF:
 *   N 0 obj
 *   << /Length L >>
 *   stream
 *   <bytes>
 *   endstream
 *   endobj
 */
function serializarStream(objNum: number, bytes: Uint8Array): Uint8Array {
	const header = TE.encode(`${objNum} 0 obj\n<< /Length ${bytes.length} >>\nstream\n`);
	const footer = TE.encode('\nendstream\nendobj\n');
	return concatBytes([header, bytes, footer]);
}

/**
 * Serializa o objeto DSS dictionary apontando para os streams de cert/OCSP/CRL.
 */
function serializarDss(
	objNum: number,
	certNums: number[],
	ocspNums: number[],
	crlNums: number[]
): Uint8Array {
	const refs = (nums: number[]) =>
		nums.length === 0 ? '[]' : `[${nums.map((n) => `${n} 0 R`).join(' ')}]`;
	const dict =
		`${objNum} 0 obj\n<< ` +
		`/Certs ${refs(certNums)} ` +
		`/OCSPs ${refs(ocspNums)} ` +
		`/CRLs ${refs(crlNums)}` +
		` >>\nendobj\n`;
	return TE.encode(dict);
}

/**
 * Serializa uma nova versão do catalog (mesmo objNum do anterior) preservando
 * todas as entradas existentes e acrescentando /DSS.
 */
function serializarCatalogPatched(
	catalog: PDFDict,
	catalogRef: PDFRef,
	dssNum: number
): Uint8Array {
	const linhas: string[] = [];
	for (const [name, val] of catalog.entries()) {
		// Filtra qualquer /DSS antigo (caso já exista, sobrescrevemos).
		if (name.toString() === '/DSS') continue;
		linhas.push(`${name.toString()} ${(val as PDFObject).toString()}`);
	}
	linhas.push(`/DSS ${dssNum} 0 R`);
	const dictTxt = `${catalogRef.objectNumber} ${catalogRef.generationNumber} obj\n<<\n${linhas.join(
		'\n'
	)}\n>>\nendobj\n`;
	return TE.encode(dictTxt);
}

function pad10(n: number): string {
	return n.toString().padStart(10, '0');
}

function pad5(n: number): string {
	return n.toString().padStart(5, '0');
}

/**
 * Constrói uma cross-reference subsection clássica para os objetos
 * passados, agrupando entradas contíguas. Sempre inclui a entrada
 * "0 1\n0000000000 65535 f " inicial (free list head).
 */
function serializarXref(entradas: { num: number; offset: number }[]): Uint8Array {
	// Agrupa por número contíguo.
	const ordenadas = [...entradas].sort((a, b) => a.num - b.num);
	const grupos: Array<{ inicio: number; offsets: number[] }> = [];
	for (const e of ordenadas) {
		const ult = grupos[grupos.length - 1];
		if (ult && e.num === ult.inicio + ult.offsets.length) {
			ult.offsets.push(e.offset);
		} else {
			grupos.push({ inicio: e.num, offsets: [e.offset] });
		}
	}

	let txt = 'xref\n';
	txt += '0 1\n0000000000 65535 f \n';
	for (const g of grupos) {
		txt += `${g.inicio} ${g.offsets.length}\n`;
		for (const off of g.offsets) {
			txt += `${pad10(off)} ${pad5(0)} n \n`;
		}
	}
	return TE.encode(txt);
}

/**
 * Aplica o DSS ao PDF assinado via incremental update. Retorna novo Uint8Array.
 * Em caso de erro, lança — caller deve tratar (logar e seguir com PDF original).
 */
export async function aplicarDss(signedPdf: Uint8Array, data: DssData): Promise<Uint8Array> {
	if (data.certs.length === 0 && data.ocsps.length === 0 && data.crls.length === 0) {
		// Nada a embarcar — devolve sem mudanças.
		return signedPdf;
	}

	// 1. Parsear estrutura existente via pdf-lib.
	const pdf = await PDFDocument.load(signedPdf, { ignoreEncryption: true, updateMetadata: false });
	const ctx = pdf.context;
	const trailer = ctx.trailerInfo;
	const rootRef = trailer.Root as PDFRef | undefined;
	if (!rootRef) throw new Error('Trailer sem /Root — PDF não rastreável');

	// IMPORTANTE: pdf-lib SUBNOTIFICA `largestObjectNumber`. Quando ele salva com
	// object streams (padrão), cria objetos extras que ocupam os MAIORES números do
	// arquivo: o(s) ObjStm (container dos objetos comprimidos — catalog, páginas…) e
	// o XRef stream. Esses containers NÃO entram em `largestObjectNumber` ao recarregar.
	// Numerar a partir de `largestObjectNumber + 1` colide com eles → sobrescrevemos o
	// ObjStm → os objetos comprimidos somem → Adobe recusa abrir ("problema ao ler este
	// documento (43)"). Derivamos o próximo número do /Size REAL declarado no arquivo.
	const sizeOriginal = descobrirProximoObjeto(signedPdf, ctx.largestObjectNumber);
	const catalog = ctx.lookup(rootRef) as PDFDict | undefined;
	if (!catalog) throw new Error('Catalog (Root) não encontrado');

	const oldStartxref = encontrarUltimoStartxref(signedPdf);

	// 2. Reservar números de objeto para os novos itens.
	let nextNum = sizeOriginal;
	const certNums = data.certs.map(() => nextNum++);
	const ocspNums = data.ocsps.map(() => nextNum++);
	const crlNums = data.crls.map(() => nextNum++);
	const dssNum = nextNum++;
	const novoSize = nextNum; // /Size = highest + 1

	// 3. Construir corpo do incremental update e calcular offsets.
	const partes: Uint8Array[] = [];
	const entradasXref: { num: number; offset: number }[] = [];
	let cursor = signedPdf.length;

	// Garantir que terminamos com newline antes dos novos objetos.
	if (signedPdf[signedPdf.length - 1] !== 0x0a) {
		partes.push(TE.encode('\n'));
		cursor += 1;
	}

	const empilhar = (num: number, bytes: Uint8Array) => {
		entradasXref.push({ num, offset: cursor });
		partes.push(bytes);
		cursor += bytes.length;
	};

	for (let i = 0; i < data.certs.length; i++) {
		empilhar(certNums[i], serializarStream(certNums[i], data.certs[i]));
	}
	for (let i = 0; i < data.ocsps.length; i++) {
		empilhar(ocspNums[i], serializarStream(ocspNums[i], data.ocsps[i]));
	}
	for (let i = 0; i < data.crls.length; i++) {
		empilhar(crlNums[i], serializarStream(crlNums[i], data.crls[i]));
	}
	empilhar(dssNum, serializarDss(dssNum, certNums, ocspNums, crlNums));

	// Catalog patcheado (mesmo número, sobrescreve a versão anterior).
	empilhar(rootRef.objectNumber, serializarCatalogPatched(catalog, rootRef, dssNum));

	// 4. Xref nova.
	const novoXrefOffset = cursor;
	const xrefBytes = serializarXref(entradasXref);
	partes.push(xrefBytes);

	// 5. Trailer com /Prev apontando para a xref antiga.
	let trailerTxt = `trailer\n<< /Size ${novoSize} /Root ${rootRef.objectNumber} ${rootRef.generationNumber} R /Prev ${oldStartxref}`;
	const idVal = trailer.ID as PDFObject | undefined;
	if (idVal) trailerTxt += ` /ID ${idVal.toString()}`;
	const infoVal = trailer.Info as PDFRef | undefined;
	if (infoVal) trailerTxt += ` /Info ${infoVal.objectNumber} ${infoVal.generationNumber} R`;
	trailerTxt += ` >>\nstartxref\n${novoXrefOffset}\n%%EOF\n`;
	partes.push(TE.encode(trailerTxt));

	// 6. Concatenar tudo: PDF original + incremental.
	const resultado = concatBytes([signedPdf, ...partes]);

	// 7. Auto-verificação estrutural (rede de segurança). Adobe é mais rígido que o
	// pdf-lib — então NUNCA devolvemos um incremental update inconsistente. Se qualquer
	// invariante falhar (colisão de objeto, offset de xref errado, DSS irrecuperável),
	// caímos de volta no PDF assinado original (sem PAdES-LT). Pior caso = PDF sem DSS,
	// jamais um PDF quebrado.
	const verif = await verificarIncremental(
		resultado,
		signedPdf,
		[...certNums, ...ocspNums, ...crlNums, dssNum],
		entradasXref,
		novoXrefOffset
	);
	if (!verif.ok) {
		logger.warn('[PAdES-LT] Incremental update reprovado na auto-verificação — DSS não embarcado', {
			motivo: verif.motivo
		});
		return signedPdf;
	}

	return resultado;
}

/**
 * Descobre o próximo número de objeto livre e SEGURO para um incremental update.
 *
 * Não confiamos só em `largestObjectNumber` do pdf-lib porque ele não conta os
 * objetos ObjStm/XRef-stream fisicamente presentes no arquivo. Tomamos o teto entre:
 *   - `largestObjectNumber + 1` (visão lógica do pdf-lib),
 *   - o maior `/Size` declarado em qualquer trailer/XRef dict (autoritativo por spec:
 *     /Size = maior número de objeto + 1), e
 *   - o maior cabeçalho `N G obj` fisicamente presente + 1.
 *
 * Superestimar é inócuo (gera no máximo lacunas legais na numeração); subestimar
 * causa colisão e corrompe o PDF — por isso pegamos sempre o MAIOR.
 */
function descobrirProximoObjeto(pdfBytes: Uint8Array, largestObjectNumber: number): number {
	const txt = new TextDecoder('latin1').decode(pdfBytes);
	let maxNum = largestObjectNumber;
	for (const m of txt.matchAll(/(?:^|[\r\n])\s*(\d+)\s+\d+\s+obj\b/g)) {
		const n = parseInt(m[1], 10);
		if (Number.isFinite(n) && n > maxNum) maxNum = n;
	}
	let maxSize = 0;
	for (const m of txt.matchAll(/\/Size\s+(\d+)/g)) {
		const n = parseInt(m[1], 10);
		if (Number.isFinite(n) && n > maxSize) maxSize = n;
	}
	return Math.max(largestObjectNumber + 1, maxNum + 1, maxSize);
}

/**
 * Rede de segurança: revalida o incremental update gerado por `aplicarDss` antes
 * de devolvê-lo. Latin1 preserva a relação 1 byte = 1 char, então índices de string
 * equivalem a offsets de byte.
 */
async function verificarIncremental(
	output: Uint8Array,
	signedOriginal: Uint8Array,
	novosNums: number[],
	entradas: { num: number; offset: number }[],
	xrefOffset: number
): Promise<{ ok: true } | { ok: false; motivo: string }> {
	const decOut = new TextDecoder('latin1').decode(output);
	const decOrig = new TextDecoder('latin1').decode(signedOriginal);

	// (a) Guard de colisão: nenhum número novo pode já existir no PDF assinado.
	for (const n of novosNums) {
		if (new RegExp(`(?:^|[\\r\\n])\\s*${n}\\s+\\d+\\s+obj\\b`).test(decOrig)) {
			return { ok: false, motivo: `colisão: objeto ${n} já existe no PDF assinado` };
		}
	}
	// (b) Guard de offset: cada offset da nova xref aponta exatamente para "N G obj".
	for (const { num, offset } of entradas) {
		if (offset < 0 || offset >= output.length) {
			return { ok: false, motivo: `offset ${offset} do objeto ${num} fora do arquivo` };
		}
		const trecho = decOut.slice(offset, offset + 24);
		if (!new RegExp(`^${num}\\s+\\d+\\s+obj\\b`).test(trecho)) {
			return {
				ok: false,
				motivo: `offset ${offset} não inicia "${num} .. obj" (achou ${JSON.stringify(trecho.slice(0, 12))})`
			};
		}
	}
	// (c) startxref aponta para a palavra-chave "xref".
	if (
		xrefOffset < 0 ||
		xrefOffset >= output.length ||
		decOut.slice(xrefOffset, xrefOffset + 4) !== 'xref'
	) {
		return { ok: false, motivo: `startxref (${xrefOffset}) não aponta para "xref"` };
	}
	// (d) Round-trip: o PDF reabre e expõe o DSS recém-embarcado.
	try {
		const dss = await detectarDss(output);
		if (!dss.presente) return { ok: false, motivo: 'DSS ausente após incremental update' };
	} catch (e) {
		return { ok: false, motivo: `reparse falhou: ${e instanceof Error ? e.message : String(e)}` };
	}
	return { ok: true };
}

/**
 * Localiza o último `startxref OFFSET` no PDF.
 */
function encontrarUltimoStartxref(pdf: Uint8Array): number {
	// Busca pelos últimos ~1024 bytes onde o trailer / startxref reside.
	const tail = pdf.subarray(Math.max(0, pdf.length - 4096));
	const str = new TextDecoder('latin1').decode(tail);
	const idx = str.lastIndexOf('startxref');
	if (idx < 0) throw new Error('startxref não encontrado no PDF');
	const m = str.substring(idx).match(/startxref\s+(\d+)/);
	if (!m) throw new Error('startxref offset não parseável');
	return parseInt(m[1]);
}

/**
 * Detecta se o PDF possui um DSS Dictionary. Usado pelo verificador
 * para sinalizar PAdES-LT na UI.
 */
export async function detectarDss(pdfBytes: Uint8Array): Promise<{
	presente: boolean;
	certCount: number;
	ocspCount: number;
	crlCount: number;
}> {
	try {
		const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
		const catalog = pdf.catalog;
		const dssRef = catalog.get(PDFName.of('DSS'));
		if (!dssRef) return { presente: false, certCount: 0, ocspCount: 0, crlCount: 0 };
		const dss = pdf.context.lookup(dssRef as PDFRef) as PDFDict | undefined;
		if (!dss) return { presente: false, certCount: 0, ocspCount: 0, crlCount: 0 };
		const arr = (k: string) => {
			const v = dss.get(PDFName.of(k));
			return v instanceof PDFArray ? v.size() : 0;
		};
		return {
			presente: true,
			certCount: arr('Certs'),
			ocspCount: arr('OCSPs'),
			crlCount: arr('CRLs')
		};
	} catch (e) {
		logger.warn('[PAdES-LT] Falha ao detectar DSS', {
			error: e instanceof Error ? e.message : String(e)
		});
		return { presente: false, certCount: 0, ocspCount: 0, crlCount: 0 };
	}
}
