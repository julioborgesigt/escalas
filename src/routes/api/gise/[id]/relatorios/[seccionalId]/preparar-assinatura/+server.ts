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
	buscarGiseSeccionalMembros,
	buscarTermosPresencaGise,
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
import { getBreveRelatorioEnvMergido } from '$lib/server/breve-relatorio-env';
import { carregarLogosGise } from '$lib/server/gise-logos';
import { listarPoliciaisSupervisaoExtra } from '$lib/gise/gise-supervisao-extra';
import {
	giseAutorizaSeccionalRelatorioExtra,
	secIdEhSupervisaoExtra
} from '$lib/server/gise-supervisao-extra';
import {
	prepararPdfParaAssinatura,
	adicionarPaginaAuditoria,
	type AuditTrailOptions,
	adicionarRodapeUniversal,
	estamparRubricaLimpa
} from '$lib/server/pdf-signing';
import { chaveConferencia } from '$lib/server/copia-conferencia';
import { PDFDocument } from 'pdf-lib';
import { gerarCodigoValidacao } from '$lib/utils';
import { tryGetR2 } from '$lib/db';
import { calcularHashBuffer } from '$lib/server/document-utils';
import { logger } from '$lib/server/logger';
import { json } from '@sveltejs/kit';

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
	if (u.tipo !== 'policial' && u.tipo !== 'admin') {
		return forbidden('Somente policiais supervisores ou administradores podem assinar');
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

	// Apenas o supervisor designado ou administradores podem assinar relatórios desta GISE
	if (u.tipo !== 'admin' && gise.supervisor_id !== u.id) {
		return forbidden(
			'Apenas o supervisor designado ou administradores podem assinar este relatório.'
		);
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

	const brEnv = await getBreveRelatorioEnvMergido(db);
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

	// Construir lista de assinantes para a folha de auditoria
	const signers: AuditTrailOptions[] = [];

	const membrosSec = isSupervisaoExtra
		? listarPoliciaisSupervisaoExtra(gise).map((r) => ({ policial_id: r.policial_id }))
		: await buscarGiseSeccionalMembros(db, id, secIdNum, platform?.env);
	const idsMembros = new Set(membrosSec.map((m) => m.policial_id));
	const presencasFiltradas = presencas.filter((p) => idsMembros.has(p.policial_id));

	const r2 = tryGetR2(platform as App.Platform | undefined);

	// Buscar selfies em paralelo
	const selfieKeys: Array<{ key: string; type: 'entrada' | 'saida'; prId: number }> = [];
	for (const pr of presencasFiltradas) {
		if (pr.entrada_rubrica && pr.entrada_selfie_key && r2) {
			selfieKeys.push({ key: pr.entrada_selfie_key, type: 'entrada', prId: pr.id });
		}
		if (pr.saida_rubrica && pr.saida_selfie_key && r2) {
			selfieKeys.push({ key: pr.saida_selfie_key, type: 'saida', prId: pr.id });
		}
	}

	const selfieResults = await Promise.all(
		selfieKeys.map(async ({ key, type, prId }) => {
			try {
				const obj = await r2!.get(key);
				if (obj) {
					const buf = await obj.arrayBuffer();
					return {
						prId,
						type,
						data: `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}`
					};
				}
			} catch {
				// objeto opcional (selfie ausente/ilegível) — segue sem ela
			}
			return { prId, type, data: undefined };
		})
	);

	const selfieMap = new Map<string, string | undefined>();
	for (const r of selfieResults) {
		selfieMap.set(`${r.prId}-${r.type}`, r.data);
	}

	// Presenças confirmadas por Token A3 (desktop) têm um termo qualificado em
	// `gise_presenca_termos`. Cruzamos por (policial, tipo) para que o manifesto
	// classifique cada rubrica como QUALIFICADA (ICP) ou AVANÇADA (tela/mobile),
	// em vez de marcar todas como avançada.
	const termosPresenca = await buscarTermosPresencaGise(db, id);

	const adicionarPresenca = (
		pr: (typeof presencasFiltradas)[number],
		tipo: 'entrada' | 'saida'
	) => {
		const rubricaPresenca = tipo === 'entrada' ? pr.entrada_rubrica : pr.saida_rubrica;
		if (!rubricaPresenca) return;

		const termo = termosPresenca.get(`${pr.policial_id}-${tipo}`);
		const qualificada = !!termo;
		const sufixo = tipo === 'entrada' ? 'E' : 'S';
		const ts = tipo === 'entrada' ? pr.entrada_timestamp : pr.saida_timestamp;
		// entrada/saida_timestamp são UTC real (ISO Z); o manifesto formata em
		// America/Sao_Paulo. Fallback para new Date() se ausente.
		const signingTime = ts ? new Date(ts) : new Date();
		// Quando qualificada, o hash de verificação é o do PRÓPRIO termo assinado
		// (resolve em /validar para o PDF qualificado); senão, o pseudo-hash da presença.
		const vHash =
			qualificada && termo!.verification_hash
				? termo!.verification_hash
				: `PRES-${pr.id}-${sufixo}`;

		signers.push({
			signerName: `${pr.policial_nome} (${tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA'})`,
			signerCpf: pr.policial_cpf ?? undefined,
			signingTime,
			verificationHash: vHash,
			verificationUrl: `${url.origin}/validar/${vHash}`,
			ip: pr.ip_address ?? undefined,
			userAgent: pr.user_agent ?? undefined,
			latitude: pr.latitude ?? undefined,
			longitude: pr.longitude ?? undefined,
			// Qualificada (Token A3): a prova é o termo/certificado — o cartão não
			// exibe rúbrica/selfie. Avançada (tela): mantém rúbrica e prova de vida.
			rubricBase64: qualificada ? undefined : (rubricaPresenca ?? undefined),
			selfieBase64: qualificada ? undefined : selfieMap.get(`${pr.id}-${tipo}`),
			signatureLevel: qualificada ? 'qualificada' : 'avancada',
			tipoCarimoTempo: qualificada
				? ((termo!.tipo_carimbo_tempo ?? 'servidor') as AuditTrailOptions['tipoCarimoTempo'])
				: undefined,
			documentName: `Relatório Extraordinário - GISE ${id}`,
			documentHash
		});
	};

	for (const pr of presencasFiltradas) {
		adicionarPresenca(pr, 'entrada');
		adicionarPresenca(pr, 'saida');
	}

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
		tipoCarimoTempo: (platform?.env as unknown as Record<string, string | undefined> | undefined)
			?.TSA_URL
			? 'tsa_externa'
			: 'servidor'
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
	const preparedPdfBase64 = Buffer.from(preparedPdf).toString('base64');

	// Cópia de conferência IDÊNTICA (mesmos bytes: pdfBase + estamparRubricaLimpa na
	// MESMA geometria centrada, sem manifesto/placeholder), gravada no R2 sob a chave
	// plana `conferencia/<hash>.pdf`. Best-effort: nunca aborta a assinatura.
	if (r2) {
		try {
			const conferenciaPdf = await estamparRubricaLimpa(pdfBase, {
				alignment: 'center',
				customBoxY: boxY_pts,
				rubricBase64: rubricaAssinatura,
				customRubricX: rx_pts,
				customRubricY: ry_pts,
				targetPageIndex: contentPageIndex
			});
			await r2.put(chaveConferencia(verificationHash), conferenciaPdf, {
				httpMetadata: { contentType: 'application/pdf' }
			});
		} catch (err) {
			logger.warn('[gise/relatorios/preparar-assinatura] Falha ao gravar cópia de conferência', {
				gise_id: id,
				seccional_id: secIdNum,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	}

	return json({
		signedAttrsHashHex,
		preparedPdf: preparedPdfBase64,
		messageDigest,
		signingTimeISO,
		dataToSignBase64,
		verificationHash,
		documentHash,
		assinanteEmail: u.email
	});
};
