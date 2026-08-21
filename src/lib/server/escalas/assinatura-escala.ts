/**
 * Montagem e persistência do PDF assinado da escala — o miolo comum entre a
 * assinatura de UM tiro (`assinar-simples`) e a de DUAS fases (passkey).
 *
 * A de duas fases existe porque a asserção WebAuthn precisa cobrir o hash do
 * documento: o `preparar` monta o PDF e grava a intenção; a cerimônia
 * biométrica acontece sobre esse hash; o `finalizar` sela e grava. Sem esta
 * extração, o `preparar` seria uma cópia de 80 linhas do `assinar-simples` —
 * e o histórico deste projeto é claro sobre o que acontece com a cópia: uma
 * é corrigida, a outra não.
 *
 * A ordem das operações NÃO é livre e está fixada aqui:
 *
 *   1. gerar o PDF do tipo da escala;
 *   2. rodapé + QR (`pdfComRodape`) — é esta versão que vira cópia de
 *      conferência, a que circula;
 *   3. hash do documento, calculado sobre `pdfComRodape`, que é o que o
 *      manifesto exibe;
 *   4. folha de manifesto;
 *   5. selo institucional POR ÚLTIMO — ele assina os bytes, então qualquer
 *      desenho posterior invalidaria a assinatura ("documento modificado" no
 *      Adobe).
 */
import { logger } from '../logger';
import { conflict } from '../api';
import {
	salvarDocumentoEscala,
	buscarDocumentoEscala,
	type Database,
	type AssinaturaPasskeyMetadata
} from '$lib/db';
import { limparR2ObsoletoEscala } from '../r2-cleanup';
import { compensarBlobAssinado, type R2ParaAssinatura } from '../assinatura/blob-assinado';
import { chaveConferencia } from '../assinatura/copia-conferencia';
import { adicionarRodapeSimples, adicionarPaginaAuditoria } from '../assinatura/pdf-signing';
import { calcularHashBuffer } from '../assinatura/document-utils';
import { selarPdfInstitucional, tipoCarimboPrevisto } from '../assinatura/server-seal';
import { gerarPdf, gerarPdfPlantao, gerarPdfExpediente } from '../export';
import { uploadSelfieDataUri } from '../assinatura/selfie-upload';
import { gerarCodigoValidacao } from '$lib/utils/formato';
import { mensagemDeErro } from '$lib/utils/erro';

/** Subset do R2 usado aqui — `put` de bytes, como em `selfie-upload`. */
interface R2Putable {
	put(key: string, value: unknown, options?: Record<string, unknown>): Promise<unknown>;
}

/** A linha inteira da escala: `gerarPdf*` lê lotação, datas e horários, não só o título. */
type DadosEscala = Parameters<typeof gerarPdf>[0];

export interface EvidenciasMontagem {
	rubrica?: string | null;
	latitude?: number | null;
	longitude?: number | null;
	selfieBase64?: string | null;
	livenessChallenge?: {
		tipo: 'blink' | 'smile' | 'head_turn';
		cumprido: boolean;
		tentativas: number;
		duracaoMs: number;
	} | null;
	/** Política de dispositivo verificada — vira linha do manifesto. */
	politicaDispositivoMovel?: boolean;
	/** Passkey que vai assinar. Conhecida ANTES da cerimônia porque só há uma
	 *  credencial ativa por pessoa — é o que permite o manifesto sair completo. */
	passkey?: { credentialId: string; vinculo: string } | null;
}

export interface PdfEscalaMontado {
	/** Escala + rodapé + QR. A cópia de conferência, sem a folha de manifesto. */
	pdfComRodape: Uint8Array;
	/** Com a folha de manifesto. É o que a passkey assina e o que será selado. */
	finalPdf: Uint8Array;
	verificationHash: string;
	verificationUrl: string;
}

/**
 * Monta o PDF completo, pronto para selar.
 *
 * Não sela, não persiste e não autoriza — o caller já recusou quem não podia e
 * já validou as evidências com `validarEvidenciasAvancada`.
 */
export async function montarPdfEscalaAssinada(opts: {
	escala: DadosEscala;
	policiais: Parameters<typeof gerarPdf>[1];
	assinante: { nome: string; cpf?: string | null; email?: string | null };
	evidencias: EvidenciasMontagem;
	ip?: string;
	userAgent?: string;
	origin: string;
	env: Record<string, string | undefined> | undefined;
}): Promise<PdfEscalaMontado> {
	const { escala, policiais, assinante, evidencias } = opts;

	let result;
	if (escala.tipo === 'plantao') result = await Promise.resolve(gerarPdfPlantao(escala, policiais));
	else if (escala.tipo === 'expediente')
		result = await Promise.resolve(gerarPdfExpediente(escala, policiais));
	else result = await Promise.resolve(gerarPdf(escala, policiais));

	const verificationHash = gerarCodigoValidacao();
	const verificationUrl = `${opts.origin}/validar/${verificationHash}`;

	// Assinatura AVANÇADA (Lei 14.063/2020 art. 4º II): rodapé de confirmação
	// eletrônica + manifesto. NÃO embute placeholder PKCS#7 nem selo "ICP-Brasil"
	// — não há certificado nesta modalidade, e rotular como qualificada seria
	// enganoso e frágil em perícia.
	const pdfComRodape = await adicionarRodapeSimples(result.pdf, assinante.nome, {
		verificationHash,
		verificationUrl,
		rubricBase64: evidencias.rubrica ?? undefined,
		ip: opts.ip,
		latitude: evidencias.latitude,
		longitude: evidencias.longitude
	});

	// Hash do documento (conteúdo + rodapé) exibido no manifesto — calculado
	// ANTES da folha de manifesto, que é a página que o exibe.
	const documentHash = await calcularHashBuffer(pdfComRodape);

	const finalPdf = await adicionarPaginaAuditoria(pdfComRodape, {
		signerName: assinante.nome,
		signerCpf: assinante.cpf || undefined,
		signerEmail: assinante.email ?? undefined,
		signingTime: new Date(),
		verificationHash,
		verificationUrl,
		ip: opts.ip,
		userAgent: opts.userAgent,
		latitude: evidencias.latitude ?? undefined,
		longitude: evidencias.longitude ?? undefined,
		selfieBase64: evidencias.selfieBase64 ?? undefined,
		rubricBase64: evidencias.rubrica ?? undefined,
		documentHash,
		token: crypto.randomUUID(),
		documentName: `Escala de Serviço - ${escala.titulo}`,
		signatureLevel: 'avancada',
		restricaoMovelAplicada: evidencias.politicaDispositivoMovel,
		passkey: evidencias.passkey ?? null,
		tipoCarimoTempo: tipoCarimboPrevisto(opts.env),
		livenessChallenge: evidencias.livenessChallenge ?? null
	});

	return { pdfComRodape, finalPdf, verificationHash, verificationUrl };
}

/**
 * Sela, grava no R2 e registra o documento — o fim de linha das duas variantes.
 *
 * `limparR2ObsoletoEscala` roda por último com as chaves NOVAS na lista de
 * exceções: sem isso, cada reassinatura deixaria PDF e selfie órfãos no R2,
 * com dado pessoal e sem nenhuma linha que os localize (R2-1/R2-4).
 */
export async function persistirEscalaAssinada(opts: {
	db: Database;
	bucket: R2ParaAssinatura;
	escalaId: number;
	montado: {
		/**
		 * Versão sem a folha de manifesto — a cópia de conferência.
		 *
		 * `undefined` no fluxo de DUAS FASES: lá a cópia já foi gravada no
		 * `preparar`, que é quem ainda tinha esses bytes. Regravar aqui com o PDF
		 * final trocaria a cópia "sem manifesto" por uma COM manifesto, e o
		 * download de conferência passaria a entregar outra coisa.
		 */
		pdfComRodape?: Uint8Array;
		finalPdf: Uint8Array;
		verificationHash: string;
	};
	assinante: { nome: string; cpf?: string | null };
	selfieKey?: string | null;
	ip?: string;
	userAgent?: string;
	latitude?: number | null;
	longitude?: number | null;
	env: Record<string, string | undefined> | undefined;
	/**
	 * Asserção WebAuthn a guardar, no fluxo de duas fases. Sem ela o documento
	 * afirmaria no manifesto uma verificação sem contraparte reverificável.
	 */
	passkeyMeta?: AssinaturaPasskeyMetadata;
}): Promise<{ arquivoHash: string } | { recusa: Response }> {
	const { db, bucket, escalaId, montado } = opts;

	const selado = await selarPdfInstitucional(montado.finalPdf, opts.assinante.nome, {
		env: opts.env
	});
	const pdfParaSalvar = selado.ok ? selado.pdf : montado.finalPdf;

	// arquivo_hash do PDF FINAL (selado ou não) — é o que a /validar reconfere.
	const arquivoHash = await calcularHashBuffer(pdfParaSalvar);

	// R2-4: captura o documento anterior (reassinatura) para apagar seus objetos
	// obsoletos DEPOIS da nova gravação.
	const docAntigo = await buscarDocumentoEscala(db, escalaId);
	const r2Key = `escalas/${new Date().getFullYear()}/${escalaId}_${montado.verificationHash}.pdf`;
	await bucket.put(r2Key, pdfParaSalvar, { httpMetadata: { contentType: 'application/pdf' } });

	// Cópia de conferência: os MESMOS bytes de antes da folha de manifesto. Sem
	// ela, o download "sem manifesto" caía na regeneração legada (PDF refeito na
	// hora a partir dos dados ATUAIS). Best-effort: falha não aborta.
	if (montado.pdfComRodape) {
		await gravarCopiaConferencia(bucket, montado.verificationHash, montado.pdfComRodape, escalaId);
	}

	const { gravado } = await salvarDocumentoEscala(db, {
		escalaId,
		r2Key,
		assinanteNome: opts.assinante.nome,
		assinanteCpf: opts.assinante.cpf || undefined,
		verificacaoHash: montado.verificationHash,
		ipAddress: opts.ip,
		userAgent: opts.userAgent,
		latitude: opts.latitude ?? undefined,
		longitude: opts.longitude ?? undefined,
		selfieKey: opts.selfieKey ?? undefined,
		arquivoHash,
		// Sem `assinanteEmail`, `tipoCarimboTempo` nem `cadesMeta`: este é o
		// caminho AVANÇADO, sem certificado e sem carimbo qualificado.
		env: opts.env,
		passkeyMeta: opts.passkeyMeta
	});
	if (!gravado) {
		await compensarBlobAssinado(
			db,
			bucket,
			[r2Key, chaveConferencia(montado.verificationHash), opts.selfieKey],
			'escala-assinada'
		);
		return {
			recusa: conflict('Revogue a assinatura existente antes de assinar novamente')
		};
	}

	await limparR2ObsoletoEscala(db, bucket, docAntigo, [
		r2Key,
		chaveConferencia(montado.verificationHash),
		...(opts.selfieKey ? [opts.selfieKey] : [])
	]);

	return { arquivoHash };
}

/**
 * Grava a cópia de conferência. Best-effort de propósito: perder a cópia
 * degrada o download "sem manifesto", mas abortar aqui perderia a assinatura
 * inteira — que é o dano maior.
 */
export async function gravarCopiaConferencia(
	bucket: R2Putable,
	verificationHash: string,
	pdfComRodape: Uint8Array,
	escalaId: number
): Promise<void> {
	try {
		await bucket.put(chaveConferencia(verificationHash), pdfComRodape, {
			httpMetadata: { contentType: 'application/pdf' }
		});
	} catch (err) {
		logger.warn('[assinatura-escala] Falha ao gravar cópia de conferência', {
			escala_id: escalaId,
			error: mensagemDeErro(err)
		});
	}
}

/** Sobe a selfie, quando houver. `null` quando não veio ou foi recusada. */
export async function subirSelfieEscala(
	bucket: R2Putable,
	escalaId: number,
	selfieBase64: string | null | undefined
): Promise<string | null> {
	if (!selfieBase64) return null;
	const r = await uploadSelfieDataUri(
		bucket,
		`escalas/${new Date().getFullYear()}/${escalaId}/selfies`,
		selfieBase64
	);
	return r.ok ? r.key : null;
}
