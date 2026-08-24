/**
 * Montagem e persistência do PDF assinado da escala GISE — o miolo comum
 * entre a assinatura de UM tiro (`assinar-simples`) e a de DUAS fases
 * (passkey). Mesma extração da escala (`assinatura-escala.ts`): sem isto o
 * `preparar` nasceria como cópia, e a cópia é onde este projeto já quebrou.
 *
 * Ordem fixa: gerar PDF → rodapé/QR → hash → manifesto (com a chave, se
 * houver) → NÃO sela. O selo é o `persistir`, por último, para a asserção
 * cobrir o PDF que ainda vai ser selado.
 */
import { logger } from '../logger';
import {
	salvarGiseDocumento,
	atualizarGiseEscala,
	circunstanciaDePersistir,
	type Database,
	type AssinaturaPasskeyMetadata
} from '$lib/db';
import { chaveConferencia } from '../assinatura/copia-conferencia';
import { adicionarRodapeSimples, adicionarPaginaAuditoria } from '../assinatura/pdf-signing';
import { calcularHashBuffer } from '../assinatura/document-utils';
import { selarPdfInstitucional, tipoCarimboPrevisto } from '../assinatura/server-seal';
import { gerarPdfGise, toGisePdfData } from '../export';
import { uploadSelfieDataUri } from '../assinatura/selfie-upload';
import { gerarCodigoValidacao } from '$lib/utils/formato';
import {
	guardarPdfAssinado,
	recusarPorDocumentoJaGravado,
	type R2ParaAssinatura
} from '../assinatura/blob-assinado';
import type { EvidenciasMontagem } from '../escalas/assinatura-escala';
import { mensagemDeErro } from '$lib/utils/erro';

export interface PdfGiseMontado {
	pdfComRodape: Uint8Array;
	finalPdf: Uint8Array;
	verificationHash: string;
}

export async function montarPdfGiseAssinado(opts: {
	gise: { id: number; data_inicio: string };
	/** Já passou por `giseDetalhadoComMatriculaSupervisorSessao`. */
	gisePdf: Parameters<typeof toGisePdfData>[0];
	brEnv: Parameters<typeof toGisePdfData>[1];
	logos: { esq: Uint8Array | undefined; dir: Uint8Array | undefined };
	assinante: { nome: string; cpf?: string | null; email?: string | null };
	evidencias: EvidenciasMontagem;
	ip?: string;
	userAgent?: string;
	origin: string;
	env: Record<string, string | undefined> | undefined;
}): Promise<PdfGiseMontado> {
	const result = await gerarPdfGise(
		toGisePdfData(opts.gisePdf, opts.brEnv),
		opts.logos.esq,
		opts.logos.dir
	);
	const verificationHash = gerarCodigoValidacao();
	const verificationUrl = `${opts.origin}/validar/${verificationHash}`;

	const rubW_pts = 130;
	const rx_pts = 222.75 * 2.8346 - rubW_pts / 2;
	const ry_pts = (210 - result.finalY + 2) * 2.8346;

	const pdfComRodape = await adicionarRodapeSimples(result.pdf, opts.assinante.nome, {
		verificationHash,
		verificationUrl,
		rubricBase64: opts.evidencias.rubrica ?? undefined,
		customRubricX: rx_pts,
		customRubricY: ry_pts,
		ip: opts.ip,
		latitude: opts.evidencias.latitude,
		longitude: opts.evidencias.longitude
	});

	const documentHash = await calcularHashBuffer(pdfComRodape);

	const finalPdf = await adicionarPaginaAuditoria(pdfComRodape, {
		signerName: opts.assinante.nome,
		signerCpf: opts.assinante.cpf ?? undefined,
		signingTime: new Date(),
		verificationHash,
		verificationUrl,
		ip: opts.ip,
		userAgent: opts.userAgent,
		latitude: opts.evidencias.latitude ?? undefined,
		longitude: opts.evidencias.longitude ?? undefined,
		selfieBase64: opts.evidencias.selfieBase64 ?? undefined,
		rubricBase64: opts.evidencias.rubrica ?? undefined,
		documentHash,
		token: crypto.randomUUID(),
		documentName: `Escala de Serviço GISE - ${opts.gise.data_inicio}`,
		signatureLevel: 'avancada',
		restricaoMovelAplicada: opts.evidencias.politicaDispositivoMovel,
		passkey: opts.evidencias.passkey ?? null,
		tipoCarimoTempo: tipoCarimboPrevisto(opts.env),
		livenessChallenge: opts.evidencias.livenessChallenge ?? null
	});

	return { pdfComRodape, finalPdf, verificationHash };
}

export async function persistirGiseAssinada(opts: {
	db: Database;
	r2: R2ParaAssinatura;
	gise: { id: number; data_inicio: string };
	assinante: { id: number; nome: string };
	montado: {
		pdfComRodape?: Uint8Array;
		finalPdf: Uint8Array;
		verificationHash: string;
	};
	rubrica?: string | null;
	selfieKey?: string | null;
	ip?: string;
	userAgent?: string;
	latitude?: number | null;
	longitude?: number | null;
	env: Record<string, string | undefined> | undefined;
	passkeyMeta?: AssinaturaPasskeyMetadata;
}): Promise<
	{ ok: true; arquivoHash: string; pdfComRodape?: Uint8Array } | { ok: false; resposta: Response }
> {
	const selado = await selarPdfInstitucional(opts.montado.finalPdf, opts.assinante.nome, {
		env: opts.env
	});
	const pdfParaSalvar = selado.ok ? selado.pdf : opts.montado.finalPdf;
	const arquivoHash = await calcularHashBuffer(pdfParaSalvar);

	const [yyyy, mm, dd] = opts.gise.data_inicio.split('-');
	const folder = `gise/${yyyy}-${mm}/${dd}/${opts.gise.id}/escala`;
	const documentKey = `${folder}/gise_${opts.gise.id}_${opts.montado.verificationHash}_assinada.pdf`;

	const guardado = await guardarPdfAssinado(opts.r2, documentKey, pdfParaSalvar, 'gise-simples');
	if (!guardado.ok) return { ok: false, resposta: guardado.resposta };

	if (opts.montado.pdfComRodape) {
		try {
			await opts.r2.put(
				chaveConferencia(opts.montado.verificationHash),
				opts.montado.pdfComRodape,
				{
					httpMetadata: { contentType: 'application/pdf' }
				}
			);
		} catch (err) {
			logger.warn('[assinatura-gise] Falha ao gravar cópia de conferência', {
				gise_id: opts.gise.id,
				error: mensagemDeErro(err)
			});
		}
	}

	const { gravado } = await salvarGiseDocumento(opts.db, {
		giseId: opts.gise.id,
		r2Key: documentKey,
		assinanteId: opts.assinante.id,
		assinanteNome: opts.assinante.nome,
		// CPF vazio de propósito no caminho avançado: quem o preenche é o
		// fluxo qualificado, a partir do certificado.
		assinanteCpf: '',
		verificacaoHash: opts.montado.verificationHash,
		rubrica: opts.rubrica ?? undefined,
		arquivoHash,
		...circunstanciaDePersistir(opts)
	});
	if (!gravado) {
		return {
			ok: false,
			resposta: await recusarPorDocumentoJaGravado(
				opts.db,
				opts.r2,
				[documentKey, chaveConferencia(opts.montado.verificationHash), opts.selfieKey],
				'gise-simples'
			)
		};
	}
	await atualizarGiseEscala(opts.db, opts.gise.id, { status: 'em_andamento' });

	return { ok: true, arquivoHash, pdfComRodape: opts.montado.pdfComRodape };
}

export async function subirSelfieGise(
	r2: R2ParaAssinatura,
	gise: { id: number; data_inicio: string },
	selfieBase64: string | null | undefined
): Promise<string | null> {
	if (!selfieBase64) return null;
	const [yyyy, mm, dd] = gise.data_inicio.split('-');
	const folder = `gise/${yyyy}-${mm}/${dd}/${gise.id}/escala/selfies`;
	const r = await uploadSelfieDataUri(r2, folder, selfieBase64);
	return r.ok ? r.key : null;
}
