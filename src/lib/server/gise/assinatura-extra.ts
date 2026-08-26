/**
 * Montagem e persistência do relatório extraordinário assinado — um tiro e
 * duas fases. Sem extrair, o `preparar` copiaria 80 linhas do `assinar`.
 *
 * Selo por último, no `persistir`. O `preparar` devolve `finalPdf` sem selo
 * para a passkey assinar o hash.
 */
import { logger } from '../logger';
import {
	salvarAssinaturaRelatorioGise,
	tentarPromoverGiseProntaParaFinalizar,
	buscarPresencasGise,
	type Database,
	type AssinaturaPasskeyMetadata
} from '$lib/db';
import {
	gerarRelatorioExtraordinarioPdf,
	gerarRelatorioExtraordinarioSupervisaoPdf,
	toGisePdfData
} from '../export';
import { carregarLogosGise } from './logos';
import { secIdEhSupervisaoExtra } from './supervisao-extra';
import { getBreveRelatorioEnvMergido } from './breve-relatorio-env';
import { adicionarRodapeSimples, adicionarPaginaAuditoria } from '../assinatura/pdf-signing';
import { montarSignersPresencaExtra } from './relatorio-manifesto';
import { calcularHashBuffer } from '../assinatura/document-utils';
import { selarPdfInstitucional, tipoCarimboPrevisto } from '../assinatura/server-seal';
import { chaveConferencia } from '../assinatura/copia-conferencia';
import { uploadSelfieDataUri } from '../assinatura/selfie-upload';
import {
	guardarPdfAssinado,
	recusarPorDocumentoJaGravado,
	type R2ParaAssinatura
} from '../assinatura/blob-assinado';
import type { EvidenciasMontagem } from '../escalas/assinatura-escala';
import { mensagemDeErro } from '$lib/utils/erro';

export function chaveDocumentoExtra(
	gise: { id: number; data_inicio: string },
	secId: number,
	verificationHash: string
): string {
	const [yyyy, mm, dd] = gise.data_inicio.split('-');
	const folder = `gise/${yyyy}-${mm}/${dd}/${gise.id}/relatorios_extra`;
	return `${folder}/gise_rel_${gise.id}_sec_${secId}_${verificationHash}_assinada.pdf`;
}

export interface PdfExtraMontado {
	pdfComRodape: Uint8Array;
	finalPdf: Uint8Array;
	verificationHash: string;
	documentKey: string;
}

export async function montarPdfExtraAssinado(opts: {
	db: Database;
	gise: Parameters<typeof gerarRelatorioExtraordinarioSupervisaoPdf>[0] & {
		id: number;
		data_inicio: string;
		operacao_id: number | null;
	};
	giseId: number;
	secId: number;
	assinante: { nome: string; cpf?: string | null; matricula?: string | null };
	evidencias: EvidenciasMontagem;
	ip?: string;
	userAgent?: string;
	origin: string;
	env: Record<string, string | undefined> | undefined;
	platform: App.Platform | undefined;
	verificationHash: string;
}): Promise<PdfExtraMontado> {
	const presencas = await buscarPresencasGise(opts.db, opts.giseId, opts.platform?.env);
	const mockSignature = {
		assinante_nome: opts.assinante.nome,
		assinante_matricula: opts.assinante.matricula?.trim() || '',
		verification_hash: opts.verificationHash
	};

	const isSupervisaoExtra = await secIdEhSupervisaoExtra(opts.db, opts.secId);
	const brEnv = await getBreveRelatorioEnvMergido(opts.db, opts.gise.operacao_id);
	const { esq: logoEsq, dir: logoDir } = await carregarLogosGise(opts.platform);
	const result = isSupervisaoExtra
		? await gerarRelatorioExtraordinarioSupervisaoPdf(
				opts.gise,
				presencas,
				opts.origin,
				mockSignature,
				undefined,
				false,
				brEnv,
				logoEsq,
				logoDir
			)
		: await gerarRelatorioExtraordinarioPdf(
				toGisePdfData(opts.gise, brEnv),
				presencas,
				opts.secId,
				opts.origin,
				mockSignature,
				undefined,
				false,
				logoEsq,
				logoDir
			);

	const qrUrl = `${opts.origin}/validar/${opts.verificationHash}`;
	const pdfComRodape = await adicionarRodapeSimples(result.pdf, mockSignature.assinante_nome, {
		verificationHash: opts.verificationHash,
		verificationUrl: qrUrl
	});
	const documentHash = await calcularHashBuffer(pdfComRodape);

	const presenceSigners = await montarSignersPresencaExtra({
		db: opts.db,
		gise: opts.gise,
		giseId: opts.giseId,
		secIdNum: opts.secId,
		isSupervisaoExtra,
		platform: opts.platform,
		presencas,
		documentHash,
		origin: opts.origin,
		documentName: `Relatório Extraordinário - GISE ${opts.giseId}`
	});

	const finalPdf = await adicionarPaginaAuditoria(pdfComRodape, [
		...presenceSigners,
		{
			signerName: opts.assinante.nome,
			signerCpf: opts.assinante.cpf ?? undefined,
			signingTime: new Date(),
			verificationHash: opts.verificationHash,
			verificationUrl: qrUrl,
			ip: opts.ip,
			userAgent: opts.userAgent,
			latitude: opts.evidencias.latitude ?? undefined,
			longitude: opts.evidencias.longitude ?? undefined,
			selfieBase64: opts.evidencias.selfieBase64 ?? undefined,
			documentHash,
			token: crypto.randomUUID(),
			documentName: `Relatório Extraordinário - GISE ${opts.giseId}`,
			signatureLevel: 'avancada',
			restricaoMovelAplicada: opts.evidencias.politicaDispositivoMovel,
			passkey: opts.evidencias.passkey ?? null,
			tipoCarimoTempo: tipoCarimboPrevisto(opts.env)
		}
	]);

	const documentKey = chaveDocumentoExtra(
		{ id: opts.giseId, data_inicio: opts.gise.data_inicio },
		opts.secId,
		opts.verificationHash
	);

	return { pdfComRodape, finalPdf, verificationHash: opts.verificationHash, documentKey };
}

export async function persistirExtraAssinado(opts: {
	db: Database;
	r2: R2ParaAssinatura;
	giseId: number;
	secId: number;
	assinante: { id: number | null; nome: string; cpf?: string | null };
	montado: {
		pdfComRodape?: Uint8Array;
		finalPdf: Uint8Array;
		verificationHash: string;
		documentKey: string;
	};
	selfieKey?: string | null;
	ip?: string;
	userAgent?: string;
	latitude?: number | null;
	longitude?: number | null;
	env?: Record<string, string | undefined>;
	passkeyMeta?: AssinaturaPasskeyMetadata;
}): Promise<{ ok: true; arquivoHash: string } | { ok: false; resposta: Response }> {
	const selado = await selarPdfInstitucional(opts.montado.finalPdf, opts.assinante.nome, {
		env: opts.env
	});
	const pdfParaSalvar = selado.ok ? selado.pdf : opts.montado.finalPdf;
	const arquivoHash = await calcularHashBuffer(pdfParaSalvar);

	const guardado = await guardarPdfAssinado(
		opts.r2,
		opts.montado.documentKey,
		pdfParaSalvar,
		'gise-relatorio-simples'
	);
	if (!guardado.ok) return { ok: false, resposta: guardado.resposta };

	if (opts.montado.pdfComRodape) {
		try {
			await opts.r2.put(
				chaveConferencia(opts.montado.verificationHash),
				opts.montado.pdfComRodape,
				{ httpMetadata: { contentType: 'application/pdf' } }
			);
		} catch (err) {
			logger.warn('[assinatura-extra] Falha ao gravar cópia de conferência', {
				gise_id: opts.giseId,
				seccional_id: opts.secId,
				error: mensagemDeErro(err)
			});
		}
	}

	const { gravado } = await salvarAssinaturaRelatorioGise(
		opts.db,
		{
			gise_id: opts.giseId,
			seccional_id: opts.secId,
			tipo: 'extraordinario',
			assinante_id: opts.assinante.id,
			assinante_nome: opts.assinante.nome,
			assinante_cpf: opts.assinante.cpf ?? null,
			tipo_assinatura: 'simples',
			verification_hash: opts.montado.verificationHash,
			ip_address: opts.ip,
			user_agent: opts.userAgent,
			latitude: opts.latitude ?? undefined,
			longitude: opts.longitude ?? undefined,
			selfie_key: opts.selfieKey ?? undefined,
			r2_key: opts.montado.documentKey,
			arquivo_hash: arquivoHash,
			passkeyMeta: opts.passkeyMeta
		},
		opts.env
	);
	if (!gravado) {
		return {
			ok: false,
			resposta: await recusarPorDocumentoJaGravado(
				opts.db,
				opts.r2,
				[opts.montado.documentKey, chaveConferencia(opts.montado.verificationHash), opts.selfieKey],
				'gise-relatorio-simples'
			)
		};
	}
	await tentarPromoverGiseProntaParaFinalizar(opts.db, opts.giseId);
	return { ok: true, arquivoHash };
}

export async function subirSelfieExtra(
	r2: R2ParaAssinatura,
	gise: { id: number; data_inicio: string },
	secId: number,
	hash: string,
	selfieBase64: string | null | undefined
): Promise<string | null> {
	if (!selfieBase64) return null;
	const [yyyy, mm, dd] = gise.data_inicio.split('-');
	const folder = `gise/${yyyy}-${mm}/${dd}/${gise.id}/relatorios_extra/selfies`;
	const r = await uploadSelfieDataUri(r2, folder, selfieBase64);
	return r.ok ? r.key : null;
}
