/**
 * POST /api/gise/[id]/relatorios/[seccionalId]/preparar-assinatura
 *
 * Prepara o PDF do Relatório Extraordinário (GISE) com placeholder de assinatura digital.
 * A folha de auditoria é adicionada aqui (antes da assinatura) para preservar a validade da assinatura.
 */

import type { RequestHandler } from './$types';
import {
	getDB,
	buscarGiseDetalhado,
	buscarPresencasGise,
	verificarSaidaCompletaSeccional,
	buscarPolicial
} from '$lib/db';
import { prepararAssinaturaSchema } from '$lib/schemas';
import { requireAuth, badRequest, notFound, forbidden, validateBody } from '$lib/server/api';
import {
	gerarRelatorioExtraordinarioPdf,
	gerarRelatorioExtraordinarioSupervisaoPdf,
	toGisePdfData
} from '$lib/server/export';
import { getBreveRelatorioEnvMergido } from '$lib/server/gise/breve-relatorio-env';
import { carregarLogosGise } from '$lib/server/gise/logos';
import { montarSignersPresencaExtra } from '$lib/server/gise/relatorio-manifesto';
import {
	giseAutorizaSeccionalRelatorioExtra,
	secIdEhSupervisaoExtra
} from '$lib/server/gise/supervisao-extra';
import {
	prepararPdfParaAssinatura,
	adicionarPaginaAuditoria,
	type AuditTrailOptions,
	adicionarRodapeUniversal
} from '$lib/server/assinatura/pdf-signing';
import { PDFDocument } from 'pdf-lib';
import { gerarCodigoValidacao } from '$lib/utils/formato';
import {
	calcularHashBuffer,
	resolverTipoCarimboTempo
} from '$lib/server/assinatura/document-utils';
import { fecharPreparacaoAssinatura } from '$lib/server/assinatura/preparar-ciclo';

export const POST: RequestHandler = async ({
	platform,
	params,
	locals,
	url,
	request,
	getClientAddress
}) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;
	if (u.tipo !== 'policial') {
		return forbidden('Apenas o supervisor designado pode assinar este relatório.');
	}

	const validated = await validateBody(request, prepararAssinaturaSchema);
	if (!validated.ok) return validated.response;
	// `rubrica` do body é ignorada: vem do cadastro do perfil (server-side).
	const { signerName, signerCpf, latitude, longitude } = validated.data;
	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	const secIdNum = parseInt(params.seccionalId!);

	if (isNaN(id) || isNaN(secIdNum)) return badRequest('Parâmetros inválidos');

	const db = getDB(platform);
	const gise = await buscarGiseDetalhado(db, id);
	if (!gise) return notFound('Escala GISE');

	const secOk = await giseAutorizaSeccionalRelatorioExtra(db, id, secIdNum);
	if (!secOk) return badRequest('Seccional inválida para esta GISE.');

	// Só o supervisor DESIGNADO. Admin Geral não entra: ver o cabeçalho de
	// `preparar-assinatura-avancada`.
	if (gise.supervisor_id !== u.id) {
		return forbidden('Apenas o supervisor designado pode assinar este relatório.');
	}

	const presencas = await buscarPresencasGise(db, id, platform?.env);

	const finalSignerName = signerName && signerName.trim() ? signerName : u.nome;
	const finalSignerCpf = signerCpf && signerCpf.trim() ? signerCpf : u.cpf || '';

	// Rubrica + matrícula do signatário (supervisor) para o campo + rodapé.
	const polAss = await buscarPolicial(db, u.id);
	const rubricaAssinatura = polAss?.rubrica ?? undefined;
	const matriculaAssinatura = u.matricula ?? polAss?.matricula ?? undefined;

	const mockSignature = {
		assinante_nome: finalSignerName,
		assinante_matricula: u.matricula || '—'
	};

	const isSupervisaoExtra = await secIdEhSupervisaoExtra(db, secIdNum);

	// Só prepara a assinatura quando TODOS os participantes confirmaram a saída
	// (rubrica) — o relatório de extra exige a rubrica de todos.
	const saidaCompleta = await verificarSaidaCompletaSeccional(db, id, secIdNum, isSupervisaoExtra);
	if (!saidaCompleta) {
		return badRequest(
			'Todos os participantes precisam confirmar a saída (rubrica) antes de assinar o relatório.'
		);
	}

	const brEnv = await getBreveRelatorioEnvMergido(db, gise.operacao_id);
	const { esq: logoEsq, dir: logoDir } = await carregarLogosGise(platform);
	const result = isSupervisaoExtra
		? await gerarRelatorioExtraordinarioSupervisaoPdf(
				gise,
				presencas,
				url.origin,
				mockSignature,
				undefined,
				true,
				brEnv,
				logoEsq,
				logoDir
			)
		: await gerarRelatorioExtraordinarioPdf(
				toGisePdfData(gise, brEnv),
				presencas,
				secIdNum,
				url.origin,
				mockSignature,
				undefined,
				true,
				logoEsq,
				logoDir
			);
	const pdfBytes = result.pdf;
	const sigY = result.finalY;

	const verificationHash = gerarCodigoValidacao();
	const verificationUrl = `${url.origin}/validar/${verificationHash}`;

	// CALCULAR HASH SHA-256 DO PDF ORIGINAL (Antes de carimbos/assinatura)
	// Isso garante a integridade jurídica do conteúdo
	const documentHash = await calcularHashBuffer(pdfBytes);

	// INJETAR RODAPÉ UNIVERSAL EM TODAS AS PÁGINAS DE CONTEÚDO
	const pdfComRodape = await adicionarRodapeUniversal(pdfBytes, {
		documentHash,
		verificationUrl,
		verificationHash,
		signerName: finalSignerName,
		signerMatricula: matriculaAssinatura,
		signedAtISO: new Date().toISOString()
	});

	// Usar o PDF com rodapé para os próximos passos
	const pdfBase = pdfComRodape;

	// Construir lista de assinantes para a folha de auditoria. As presenças
	// (entrada/saída de cada participante) vêm do helper compartilhado — mesma
	// fonte usada pelo fluxo de assinatura em tela/mobile (`assinar`), para que o
	// manifesto sempre contenha TODAS as rubricas, não só a do supervisor.
	const signers: AuditTrailOptions[] = await montarSignersPresencaExtra({
		db,
		gise,
		giseId: id,
		secIdNum,
		isSupervisaoExtra,
		platform,
		presencas,
		documentHash,
		origin: url.origin,
		documentName: `Relatório Extraordinário - GISE ${id}`
	});

	// Assinatura do Supervisor (qualificada via token A3)
	signers.push({
		signerName: finalSignerName,
		signerCpf: finalSignerCpf || undefined,
		signerEmail: u.email || undefined,
		signingTime: new Date(),
		verificationHash,
		verificationUrl,
		documentHash,
		ip: ip ?? undefined,
		userAgent: ua || undefined,
		latitude: latitude ?? undefined,
		longitude: longitude ?? undefined,
		token: crypto.randomUUID(),
		documentName: `Relatório Extraordinário - GISE ${id}`,
		signatureLevel: 'qualificada',
		tipoCarimoTempo: resolverTipoCarimboTempo(platform)
	});

	// Conta páginas do PDF de conteúdo antes de adicionar a folha de auditoria
	const origDoc = await PDFDocument.load(pdfBytes);
	const contentPageIndex = origDoc.getPageCount() - 1;

	// Adicionar folha de auditoria ANTES de assinar (preserva a validade da assinatura)
	const pdfWithAudit = await adicionarPaginaAuditoria(pdfBase, signers);

	// Conversão de mm (jsPDF) para pts (pdf-lib)
	const mmToPts = 2.8346;
	const rubW_pts = 130;
	const rx_pts = (297 / 2 - rubW_pts / mmToPts / 2) * mmToPts; // Centralizado

	// A linha de assinatura está em sigY (mm do topo).
	// Em pdf-lib (pts da base):
	const sigY_pts = (210 - sigY) * mmToPts;

	// Queremos a rubrica logo acima da linha
	const ry_pts = sigY_pts + 2 * mmToPts;

	// O carimbo (box azul) deve ficar acima da linha também.
	const boxY_pts = sigY_pts + 5 * mmToPts;

	const prepResult = await prepararPdfParaAssinatura(
		pdfWithAudit,
		finalSignerName,
		'center',
		verificationHash,
		verificationUrl,
		boxY_pts,
		rubricaAssinatura,
		rx_pts,
		ry_pts,
		contentPageIndex,
		'rubrica'
	);

	const { preparedPdf, signedAttrsHashHex, messageDigest, signingTimeISO, dataToSignBase64 } =
		prepResult;

	return fecharPreparacaoAssinatura({
		db,
		platform,
		alvo: { recurso: 'gise_relatorio', recursoId: id, escopoId: secIdNum },
		ator: { id: u.id, tipo: u.tipo },
		preparedPdf,
		verificationHash,
		campos: {
			signedAttrsHashHex,
			messageDigest,
			signingTimeISO,
			dataToSignBase64,
			documentHash,
			assinanteEmail: u.email
		},
		conferencia: {
			pdfComRodape: pdfBase,
			stamp: {
				alignment: 'center',
				customBoxY: boxY_pts,
				rubricBase64: rubricaAssinatura,
				customRubricX: rx_pts,
				customRubricY: ry_pts,
				targetPageIndex: contentPageIndex
			},
			logTag: 'gise/relatorios/preparar-assinatura',
			logFields: { gise_id: id, seccional_id: secIdNum }
		}
	});
};
