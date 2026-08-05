/**
 * Assinatura EM TELA do relatório de serviço extraordinário de uma seccional
 * (ou do quadro de supervisão) — assinatura avançada, sem certificado.
 *
 * A ordem do fluxo é o que dá valor ao documento:
 *
 *   1. permissão + seccional realmente pertencente a esta GISE;
 *   2. **todos confirmaram a SAÍDA?** Sem isso o relatório sairia incompleto,
 *      faltando a rubrica de quem ainda estava em serviço — e um relatório
 *      assinado não se corrige, se refaz;
 *   3. gera o PDF, aplica rodapé com QR de validação e a página de auditoria;
 *   4. grava blob no R2 e a linha da assinatura;
 *   5. tenta promover a GISE a `pronta_para_finalizar`.
 *
 * A página de auditoria consolida TODAS as rubricas de presença (entrada e
 * saída) mais a assinatura do supervisor: é o manifesto que sustenta a prova, e
 * por isso não vai na cópia de conferência que circula.
 */
import { json } from '@sveltejs/kit';
import { bytesToHex } from '$lib/crypto/hex';
import type { RequestHandler } from './$types';
import {
	getDB,
	salvarAssinaturaRelatorioGise,
	buscarGiseDetalhado,
	buscarPresencasGise,
	tentarPromoverGiseProntaParaFinalizar,
	verificarSaidaCompletaSeccional,
	auditar,
	contextoDeEvento
} from '$lib/db';
import {
	gerarRelatorioExtraordinarioPdf,
	gerarRelatorioExtraordinarioSupervisaoPdf,
	toGisePdfData
} from '$lib/server/export';
import { getBreveRelatorioEnvMergido } from '$lib/server/gise/breve-relatorio-env';
import { carregarLogosGise } from '$lib/server/gise/logos';
import {
	giseAutorizaSeccionalRelatorioExtra,
	secIdEhSupervisaoExtra
} from '$lib/server/gise/supervisao-extra';
import {
	adicionarRodapeSimples,
	adicionarPaginaAuditoria
} from '$lib/server/assinatura/pdf-signing';
import { montarSignersPresencaExtra } from '$lib/server/gise/relatorio-manifesto';
import { selarPdfInstitucional, tipoCarimboPrevisto } from '$lib/server/assinatura/server-seal';
import { tryGetR2 } from '$lib/db';
import { bucketParaAssinatura, guardarPdfAssinado } from '$lib/server/assinatura/blob-assinado';
import { chaveConferencia } from '$lib/server/assinatura/copia-conferencia';
import { logger } from '$lib/server/logger';
import { uploadSelfieDataUri } from '$lib/server/assinatura/selfie-upload';
import { giseSignatureSchema } from '$lib/schemas';
import { validarEvidenciasAvancada } from '$lib/server/assinatura/signature-service';
import {
	apiError,
	ErrorCode,
	requireAuth,
	badRequest,
	notFound,
	forbidden,
	serverError,
	validateBody
} from '$lib/server/api';

export const POST: RequestHandler = async (event) => {
	const { locals, params, request, platform, getClientAddress, url } = event;
	const u = requireAuth(locals);
	if (u instanceof Response) return u;
	if (u.tipo !== 'policial' && u.tipo !== 'admin') {
		return forbidden('Somente policiais supervisores ou administradores podem assinar');
	}

	const { id, seccionalId } = params;
	const v = await validateBody(request, giseSignatureSchema);
	if (!v.ok) return v.response;

	const {
		rubrica,
		type,
		hash: inputHash,
		signerName,
		signerCpf,
		latitude,
		longitude,
		selfieBase64,
		codigoValidação,
		desafioId,
		livenessChallenge
	} = v.data;

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	// Geração de hash segura e amigável (8 caracteres hex + UUID parcial para integridade)
	const hash =
		inputHash ||
		crypto.randomUUID().slice(0, 8).toUpperCase() +
			'-' +
			crypto.randomUUID().slice(0, 8).toUpperCase();

	const db = getDB(platform);

	try {
		const giseIdNum = parseInt(id!);
		const secIdNum = parseInt(seccionalId!);

		const gise = await buscarGiseDetalhado(db, giseIdNum);
		if (!gise) return notFound('Escala');

		// Mesma regra de `preparar-assinatura` e `finalizar-assinatura`: apenas
		// o supervisor designado ou um Administrador Geral pode assinar o
		// relatório extraordinário. Sem isto, qualquer policial autenticado
		// podia POST direto neste endpoint com signerName/signerCpf arbitrário
		// e produzir um relatório "assinado" em nome do supervisor.
		if (u.tipo !== 'admin' && gise.supervisor_id !== u.id) {
			return forbidden(
				'Apenas o supervisor designado ou administradores podem assinar este relatório.'
			);
		}

		const secOk = await giseAutorizaSeccionalRelatorioExtra(db, giseIdNum, secIdNum);
		if (!secOk) return badRequest('Seccional inválida para esta GISE.');

		// O relatório de extra só pode ser assinado quando TODOS os participantes
		// confirmaram a saída (rubrica). Sem isto, o relatório seria assinado
		// incompleto, faltando a rubrica de quem ainda não saiu.
		const isSupExtraGate = await secIdEhSupervisaoExtra(db, secIdNum);
		const saidaCompleta = await verificarSaidaCompletaSeccional(
			db,
			giseIdNum,
			secIdNum,
			isSupExtraGate
		);
		if (!saidaCompleta) {
			return badRequest(
				'Todos os participantes precisam confirmar a saída (rubrica) antes de assinar o relatório.'
			);
		}

		// Validação unificada de evidências (foto/GPS/2FA segundo flags globais).
		// O fluxo SERPRO segue para o endpoint qualificado; aqui só passa
		// assinatura em tela ("simples"/"avancada" segundo classificação).
		if (type !== 'serpro') {
			const evid = await validarEvidenciasAvancada(
				db,
				u,
				{
					rubrica,
					latitude: latitude ?? undefined,
					longitude: longitude ?? undefined,
					selfieBase64,
					codigoValidação,
					desafioId,
					livenessChallenge
				},
				{ platform }
			);
			if (!evid.ok) return apiError(evid.error, evid.status, ErrorCode.VALIDATION);
		}

		const presencas = await buscarPresencasGise(db, giseIdNum, platform?.env);

		const mockSignature = {
			assinante_nome: signerName || u.nome,
			assinante_matricula: u.tipo === 'policial' ? u.matricula?.trim() || '' : '',
			verification_hash: hash,
			rubrica: rubrica || ''
		};

		const isSupervisaoExtra = await secIdEhSupervisaoExtra(db, secIdNum);
		const brEnv = await getBreveRelatorioEnvMergido(db);
		const { esq: logoEsq, dir: logoDir } = await carregarLogosGise(platform);
		const result = isSupervisaoExtra
			? await gerarRelatorioExtraordinarioSupervisaoPdf(
					gise,
					presencas,
					url.origin,
					mockSignature,
					undefined,
					false,
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
					false,
					logoEsq,
					logoDir
				);
		let finalPdf = result.pdf;
		const qrUrl = `${url.origin}/validar/${hash}`;

		finalPdf = await adicionarRodapeSimples(finalPdf, mockSignature.assinante_nome, {
			verificationHash: hash,
			verificationUrl: qrUrl
		});

		// Guarda os bytes SEM manifesto para gravar a cópia de conferência no R2
		// mais abaixo (`finalPdf` é sobrescrito pela folha de auditoria em seguida).
		const pdfConferencia = finalPdf;

		// Calcular Hash do original (Integridade)
		const originalHashBuffer = await crypto.subtle.digest('SHA-256', finalPdf.slice());
		const documentHash = bytesToHex(new Uint8Array(originalHashBuffer));

		// Manifesto: TODAS as rubricas de presença (entrada/saída) + a assinatura
		// do supervisor. Mesmo array que o fluxo por token (`preparar-assinatura`)
		// monta — antes, este fluxo mobile passava só o supervisor, e o relatório
		// assinado no celular perdia as demais assinaturas na folha de auditoria.
		const presenceSigners = await montarSignersPresencaExtra({
			db,
			gise,
			giseId: giseIdNum,
			secIdNum,
			isSupervisaoExtra,
			platform,
			presencas,
			documentHash,
			origin: url.origin,
			documentName: `Relatório Extraordinário - GISE ${id}`
		});

		// Adicionar folha de auditoria (Manifesto) profissional
		finalPdf = await adicionarPaginaAuditoria(finalPdf, [
			...presenceSigners,
			{
				signerName: signerName || u.nome,
				signerCpf: signerCpf || u.cpf || undefined,
				// new Date() (UTC real): o manifesto formata em America/Sao_Paulo.
				signingTime: new Date(),
				verificationHash: hash,
				verificationUrl: qrUrl,
				ip,
				userAgent: ua,
				latitude: latitude || undefined,
				longitude: longitude || undefined,
				selfieBase64: selfieBase64 || undefined,
				rubricBase64: rubrica || undefined,
				documentHash,
				token: crypto.randomUUID(),
				documentName: `Relatório Extraordinário - GISE ${id}`,
				signatureLevel: 'avancada',
				tipoCarimoTempo: tipoCarimboPrevisto(
					platform?.env as unknown as Record<string, string | undefined> | undefined
				)
			}
		]);

		// Selo institucional (avançada, Lei 14.063/2020 art. 4º II) + carimbo de tempo
		// grátis. Sem SELO_INSTITUCIONAL_PEM, mantém o rodapé honesto (finalPdf).
		const selado = await selarPdfInstitucional(finalPdf, signerName || u.nome, {
			env: platform?.env as unknown as Record<string, string | undefined> | undefined
		});
		const pdfParaSalvar = selado.ok ? selado.pdf : finalPdf;

		const hashBuffer = await crypto.subtle.digest('SHA-256', pdfParaSalvar.slice());
		const arquivo_hash = bytesToHex(new Uint8Array(hashBuffer));

		const p = platform as Record<string, unknown> | undefined;
		// Ver FLW-R2-003: sem bucket a assinatura é recusada, não gravada com a
		// chave apontando para nada.
		const bucketOk = bucketParaAssinatura(tryGetR2(p));
		if (!bucketOk.ok) return bucketOk.resposta;
		const r2 = bucketOk.r2;

		const [yyyy, mm, dd] = gise.data_inicio.split('-');
		const mesAno = `${yyyy}-${mm}`;
		const folder = `gise/${mesAno}/${dd}/${id}/relatorios_extra`;
		const prefixBase = `${folder}/gise_rel_${id}_sec_${seccionalId}_${hash}`;

		let selfieKey: string | undefined = undefined;

		{
			const guardado = await guardarPdfAssinado(
				r2,
				`${prefixBase}_assinada.pdf`,
				pdfParaSalvar,
				'gise-relatorio-simples'
			);
			if (!guardado.ok) return guardado.resposta;

			// Cópia de conferência (mesmos bytes, sem a folha de manifesto). Sem ela o
			// download "sem manifesto" regenerava o relatório na hora a partir dos dados
			// atuais. Best-effort: falha não aborta a assinatura.
			try {
				await r2.put(chaveConferencia(hash), pdfConferencia, {
					httpMetadata: { contentType: 'application/pdf' }
				});
			} catch (err) {
				logger.warn('[gise/relatorios/assinar] Falha ao gravar cópia de conferência', {
					gise_id: giseIdNum,
					seccional_id: secIdNum,
					error: err instanceof Error ? err.message : String(err)
				});
			}

			if (selfieBase64) {
				// Helper compartilhado: valida magic bytes, limita 5 MB, chave UUID.
				const r = await uploadSelfieDataUri(r2, `${folder}/selfies`, selfieBase64);
				if (r.ok) selfieKey = r.key;
			}
		}

		await salvarAssinaturaRelatorioGise(
			db,
			{
				gise_id: giseIdNum,
				seccional_id: secIdNum,
				tipo: 'extraordinario',
				assinante_id: u.tipo === 'policial' ? u.id : null,
				assinante_nome: signerName || u.nome,
				assinante_cpf: signerCpf || u.cpf || null,
				tipo_assinatura: (type as 'simples' | 'webpki' | 'serpro' | undefined) ?? 'simples',
				rubrica: rubrica || '',
				verification_hash: hash,
				ip_address: ip,
				user_agent: ua,
				latitude: latitude ?? undefined,
				longitude: longitude ?? undefined,
				selfie_key: selfieKey,
				r2_key: `${prefixBase}_assinada.pdf`,
				arquivo_hash: arquivo_hash
			},
			platform?.env
		);

		await tentarPromoverGiseProntaParaFinalizar(db, giseIdNum);

		const { contexto, env } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'assinar_relatorio_gise',
				usuario: u,
				entidade: 'gise',
				entidade_id: giseIdNum,
				alvo_tipo: 'seccional',
				alvo_id: secIdNum,
				detalhes: `Relatório extraordinário da GISE ${id} assinado (seccional ${seccionalId})`,
				metadados: { tipo_assinatura: type ?? 'simples', verification_hash: hash },
				...contexto
			},
			{ env }
		);

		return json({ success: true });
	} catch (e) {
		return serverError(
			`[gise/relatorios/assinar] Falha ao salvar assinatura (gise_id=${id}, seccional_id=${seccionalId})`,
			e
		);
	}
};
