/**
 * Gera o "Termo de Confirmação de Presença" (entrada/saída) da GISE em PDF,
 * para assinatura por Token A3 no computador. É um documento de UMA página; o
 * carimbo de verificação é adicionado depois, por `prepararPdfParaAssinatura`,
 * usando o `signatureLineY` devolvido aqui.
 *
 * Mantém-se enxuto de propósito: a força jurídica vem da assinatura qualificada
 * (CAdES-LT/PAdES) embutida, não do layout.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mascararCPF } from '../../utils/pii';
import { formatarData, dataHoraBrasilia } from '../../utils/datas';
import {
	adicionarRodapeUniversal,
	adicionarPaginaAuditoria,
	type AuditTrailOptions
} from '../assinatura/pdf-signing';
import { calcularHashBuffer } from '../assinatura/document-utils';
import { selarPdfInstitucional, tipoCarimboPrevisto } from '../assinatura/server-seal';
import { gerarCodigoValidacao } from '../../utils/formato';

export interface TermoPresencaInput {
	tipo: 'entrada' | 'saida';
	signerName: string;
	signerCpf?: string | null;
	matricula?: string | null;
	giseId: number;
	/** Data da escala GISE (YYYY-MM-DD). */
	dataInicio: string;
	unidadeNome?: string | null;
	/** Momento da confirmação (ISO). */
	timestampISO: string;
	/**
	 * Nível da assinatura, que muda apenas o TEXTO (declaração + rótulo da linha):
	 *   - `'qualificada'` (default): Token A3 ICP-Brasil (MP 2.200-2 + Lei 14.063/2020);
	 *   - `'avancada'`: confirmação em tela (Lei 14.063/2020 art. 4º II).
	 * A força jurídica vem da assinatura embutida/selo, não do layout.
	 */
	nivel?: 'qualificada' | 'avancada';
}

/** Quebra um texto em linhas que cabem em `maxWidth` (pts) na fonte/tamanho dados. */
function wrap(
	texto: string,
	font: import('pdf-lib').PDFFont,
	size: number,
	maxWidth: number
): string[] {
	const palavras = texto.split(/\s+/);
	const linhas: string[] = [];
	let atual = '';
	for (const p of palavras) {
		const tentativa = atual ? `${atual} ${p}` : p;
		if (font.widthOfTextAtSize(tentativa, size) > maxWidth && atual) {
			linhas.push(atual);
			atual = p;
		} else {
			atual = tentativa;
		}
	}
	if (atual) linhas.push(atual);
	return linhas;
}

/**
 * Gera o TERMO DE CONFIRMAÇÃO DE PRESENÇA (entrada ou saída) de um policial na
 * GISE e devolve, junto com o PDF, o `signatureLineY` — a coordenada onde a
 * assinatura será desenhada.
 *
 * Devolver a coordenada é o ponto: este termo é assinado com certificado, e o
 * fluxo de assinatura precisa saber onde ancorar o carimbo visual sem
 * redesenhar nem remedir o documento.
 */
export async function gerarTermoPresencaPdf(
	input: TermoPresencaInput
): Promise<{ pdf: Uint8Array; signatureLineY: number }> {
	const doc = await PDFDocument.create();
	const page = doc.addPage([595.28, 841.89]); // A4 em pts
	const { width, height } = page.getSize();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const bold = await doc.embedFont(StandardFonts.HelveticaBold);

	const navy = rgb(0.07, 0.14, 0.42);
	const text = rgb(0.1, 0.1, 0.15);
	const gray = rgb(0.4, 0.4, 0.45);
	const margin = 56;
	const contentW = width - 2 * margin;

	const acao = input.tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA';

	// Cabeçalho
	page.drawRectangle({ x: 0, y: height - 92, width, height: 92, color: navy });
	page.drawText('TERMO DE CONFIRMAÇÃO DE PRESENÇA', {
		x: margin,
		y: height - 50,
		size: 16,
		font: bold,
		color: rgb(1, 1, 1)
	});
	page.drawText('Grupo de Intensificação e Saturação Especial (GISE)', {
		x: margin,
		y: height - 72,
		size: 10,
		font,
		color: rgb(0.85, 0.88, 0.95)
	});

	// Campos
	let y = height - 130;
	const campo = (rotulo: string, valor: string) => {
		page.drawText(rotulo, { x: margin, y, size: 8.5, font: bold, color: gray });
		page.drawText(valor || '—', { x: margin, y: y - 15, size: 12, font, color: text });
		y -= 42;
	};

	// timestampISO é UTC real; o runtime do Worker é UTC, então é obrigatório
	// fixar o fuso de Brasília para o termo não exibir o horário em UTC.
	const dataHora = dataHoraBrasilia(input.timestampISO) || input.timestampISO;

	campo('TIPO DE REGISTRO', `Confirmação de ${acao} no serviço`);
	campo('SERVIDOR', input.signerName);
	campo('MATRÍCULA', input.matricula || '—');
	campo('CPF', input.signerCpf ? mascararCPF(input.signerCpf) : '—');
	campo('ESCALA GISE', `#${input.giseId} — ${formatarData(input.dataInicio)}`);
	if (input.unidadeNome) campo('UNIDADE', input.unidadeNome);
	campo('DATA/HORA DA CONFIRMAÇÃO', dataHora);

	// Declaração — o texto muda conforme o nível da assinatura.
	y -= 6;
	const avancada = input.nivel === 'avancada';
	const declaracao = avancada
		? `Declaro, para os devidos fins e sob as penas da lei, a veracidade do registro de ${acao.toLowerCase()} ` +
			`no serviço acima identificado, confirmado de forma eletrônica por mim, mediante assinatura eletrônica ` +
			`avançada (prova de vida e geolocalização), nos termos da Lei 14.063/2020, art. 4º, II.`
		: `Declaro, para os devidos fins e sob as penas da lei, a veracidade do registro de ${acao.toLowerCase()} ` +
			`no serviço acima identificado, confirmado de forma eletrônica por mim, mediante assinatura digital ` +
			`qualificada (certificado digital ICP-Brasil), nos termos da MP 2.200-2/2001 e da Lei 14.063/2020.`;
	for (const linha of wrap(declaracao, font, 10.5, contentW)) {
		page.drawText(linha, { x: margin, y, size: 10.5, font, color: text });
		y -= 16;
	}

	// Linha de assinatura (o carimbo é estampado depois)
	const signatureLineY = 150;
	page.drawLine({
		start: { x: margin, y: signatureLineY },
		end: { x: width - margin, y: signatureLineY },
		thickness: 1,
		color: gray
	});
	const rotuloAssinatura = avancada
		? `${input.signerName} — Assinatura Eletrônica Avançada (Lei 14.063/2020)`
		: `${input.signerName} — Assinatura Digital Qualificada (ICP-Brasil)`;
	page.drawText(rotuloAssinatura, {
		x: margin,
		y: signatureLineY - 14,
		size: 9,
		font,
		color: gray
	});

	const pdf = await doc.save();
	return { pdf, signatureLineY };
}

/**
 * Monta o **Termo de Presença AVANÇADO** (Lei 14.063/2020 art. 4º II) SOB DEMANDA,
 * a partir das evidências já persistidas em `gise_presencas` (selfie/prova de
 * vida, GPS, IP, carimbo temporal). É o comprovante da confirmação feita em tela/
 * mobile — que NÃO gera PDF no momento da confirmação (a prova fica só nas evidências).
 *
 * Nada é persistido: o PDF é reconstruído a cada download. A integridade vem do
 * selo institucional (CMS autoassinado, à prova de adulteração); a validação pública
 * autoritativa desta presença continua sendo o Relatório Extraordinário assinado
 * (que carrega hash próprio em `/validar`). Por isso o identificador aqui é o mesmo
 * pseudo-hash `PRES-<id>-<E|S>` que a presença já exibe no manifesto do relatório.
 *
 * O caller (endpoint) resolve a `selfieBase64` do R2 e passa as evidências prontas —
 * mantendo este helper livre de acesso a banco/R2.
 */
export async function montarTermoPresencaAvancado(opts: {
	tipo: 'entrada' | 'saida';
	/** `gise_presencas.id` — base do identificador de referência. */
	presencaId: number;
	giseId: number;
	dataInicio: string;
	unidadeNome?: string | null;
	signerName: string;
	signerCpf?: string | null;
	matricula?: string | null;
	/** Momento da confirmação (ISO, UTC real). */
	timestampISO?: string | null;
	/** Selfie/prova de vida (data URI), já resolvida do R2 pelo caller. */
	selfieBase64?: string;
	ip?: string | null;
	userAgent?: string | null;
	latitude?: number | null;
	longitude?: number | null;
	/** `url.origin` para montar os links de referência. */
	origin: string;
	env?: Record<string, string | undefined>;
	passkey?: { credentialId: string; vinculo: string } | null;
	/** Default true — o `preparar` da passkey passa false para assinar o hash antes do selo. */
	sela?: boolean;
}): Promise<Uint8Array> {
	const { finalPdf } = await prepararTermoPresencaAvancado(opts);
	if (opts.sela === false) return finalPdf;
	const selado = await selarPdfInstitucional(finalPdf, opts.signerName, { env: opts.env });
	return selado.ok ? selado.pdf : finalPdf;
}

/** PDF com manifesto, sem selo — o que a passkey assina. */
export async function prepararTermoPresencaAvancado(opts: {
	tipo: 'entrada' | 'saida';
	/**
	 * `gise_presencas.id` — só quando a linha JÁ existe (comprovante sob demanda
	 * do um-tiro). O `preparar` da passkey omite: a presença só nasce no
	 * `finalizar`, depois da asserção, e o código público é o mesmo gerador do
	 * Token A3 (`XXXX-XXXX`).
	 */
	presencaId?: number;
	giseId: number;
	dataInicio: string;
	unidadeNome?: string | null;
	signerName: string;
	signerCpf?: string | null;
	matricula?: string | null;
	timestampISO?: string | null;
	selfieBase64?: string;
	ip?: string | null;
	userAgent?: string | null;
	latitude?: number | null;
	longitude?: number | null;
	origin: string;
	env?: Record<string, string | undefined>;
	passkey?: { credentialId: string; vinculo: string } | null;
}): Promise<{ finalPdf: Uint8Array; verificationHash: string }> {
	const timestampISO = opts.timestampISO ?? new Date().toISOString();

	const { pdf } = await gerarTermoPresencaPdf({
		tipo: opts.tipo,
		signerName: opts.signerName,
		signerCpf: opts.signerCpf,
		matricula: opts.matricula,
		giseId: opts.giseId,
		dataInicio: opts.dataInicio,
		unidadeNome: opts.unidadeNome,
		timestampISO,
		nivel: 'avancada'
	});

	const documentHash = await calcularHashBuffer(pdf);
	const sufixo = opts.tipo === 'entrada' ? 'E' : 'S';
	const verificationHash =
		opts.presencaId != null ? `PRES-${opts.presencaId}-${sufixo}` : gerarCodigoValidacao();
	const verificationUrl = `${opts.origin}/validar/${verificationHash}`;

	// Rodapé universal (hash + base legal + identidade na página do campo). A base
	// legal da identidade é a AVANÇADA (Lei 14.063/2020) — nunca ICP-Brasil, que é
	// exclusiva do fluxo qualificado (token A3).
	const pdfComRodape = await adicionarRodapeUniversal(pdf, {
		signerName: opts.signerName,
		signerMatricula: opts.matricula ?? undefined,
		signedAtISO: timestampISO,
		documentHash,
		verificationUrl,
		verificationHash,
		baseLegalIdentidade: 'Lei 14.063/2020 – Assinatura Avançada'
	});

	// Folha de auditoria (uma assinatura avançada, com selfie + GPS/IP).
	const signers: AuditTrailOptions[] = [
		{
			signerName: `${opts.signerName} (${opts.tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA'})`,
			signerCpf: opts.signerCpf ?? undefined,
			signingTime: new Date(timestampISO),
			verificationHash,
			verificationUrl,
			documentHash,
			ip: opts.ip ?? undefined,
			userAgent: opts.userAgent ?? undefined,
			latitude: opts.latitude ?? undefined,
			longitude: opts.longitude ?? undefined,
			selfieBase64: opts.selfieBase64,
			documentName: `Termo de Presença - GISE ${opts.giseId}`,
			signatureLevel: 'avancada',
			tipoCarimoTempo: tipoCarimboPrevisto(opts.env),
			passkey: opts.passkey ?? null
		}
	];
	const pdfComAuditoria = await adicionarPaginaAuditoria(pdfComRodape, signers);

	return { finalPdf: pdfComAuditoria, verificationHash };
}
