import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	salvarAssinaturaRelatorioGise,
	buscarGiseDetalhado,
	buscarPresencasGise,
	tentarPromoverGiseProntaParaFinalizar
} from '$lib/db';
import { getNowBR } from '$lib/utils';
import { gerarRelatorioExtraordinarioPdf, gerarRelatorioExtraordinarioSupervisaoPdf, toGisePdfData } from '$lib/server/export';
import { getBreveRelatorioEnvMergido } from '$lib/server/breve-relatorio-env';
import {
	giseAutorizaSeccionalRelatorioExtra,
	secIdEhSupervisaoExtra
} from '$lib/server/gise-supervisao-extra';
import { adicionarRodapeSimples, adicionarPaginaAuditoria } from '$lib/server/pdf-signing';
import { selarPdfInstitucional } from '$lib/server/server-seal';
import { getR2 } from '$lib/server/platform';
import { uploadSelfieDataUri } from '$lib/server/selfie-upload';
import { giseSignatureSchema } from '$lib/schemas';
import { validarEvidenciasAvancada } from '$lib/server/signature-service';
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

export const POST: RequestHandler = async ({
	locals,
	params,
	request,
	platform,
	getClientAddress,
	url
}) => {
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
	const hash = inputHash || crypto.randomUUID().slice(0, 8).toUpperCase() + '-' + crypto.randomUUID().slice(0, 8).toUpperCase();

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

		const presencas = await buscarPresencasGise(db, giseIdNum);

		const mockSignature = {
			assinante_nome: signerName || u.nome,
			assinante_matricula: u.tipo === 'policial' ? (u.matricula?.trim() || '') : '',
			verification_hash: hash,
			rubrica: rubrica || ''
		};

		const isSupervisaoExtra = await secIdEhSupervisaoExtra(db, secIdNum);
		const brEnv = await getBreveRelatorioEnvMergido(db);
		const result = isSupervisaoExtra
			? await gerarRelatorioExtraordinarioSupervisaoPdf(
					gise,
					presencas,
					url.origin,
					mockSignature,
					undefined,
					false,
					brEnv
				)
			: await gerarRelatorioExtraordinarioPdf(
					toGisePdfData(gise, brEnv),
					presencas,
					secIdNum,
					url.origin,
					mockSignature
				);
		let finalPdf = result.pdf;
		const qrUrl = `${url.origin}/validar/${hash}`;

		finalPdf = await adicionarRodapeSimples(finalPdf, mockSignature.assinante_nome, {
			verificationHash: hash,
			verificationUrl: qrUrl
		});

		// Calcular Hash do original (Integridade)
		const originalHashBuffer = await crypto.subtle.digest('SHA-256', finalPdf.slice());
		const documentHash = Array.from(new Uint8Array(originalHashBuffer))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		// Adicionar folha de auditoria (Manifesto) profissional
		finalPdf = await adicionarPaginaAuditoria(finalPdf, {
			signerName: signerName || u.nome,
			signerCpf: signerCpf || u.cpf || undefined,
			signingTime: getNowBR(),
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
			signatureLevel: 'avancada'
		});

		// Selo institucional (avançada, Lei 14.063/2020 art. 4º II) + carimbo de tempo
		// grátis. Sem SELO_INSTITUCIONAL_PEM, mantém o rodapé honesto (finalPdf).
		const selado = await selarPdfInstitucional(finalPdf, signerName || u.nome, {
			env: platform?.env as unknown as Record<string, string | undefined> | undefined
		});
		const pdfParaSalvar = selado.ok ? selado.pdf : finalPdf;

		const hashBuffer = await crypto.subtle.digest('SHA-256', pdfParaSalvar.slice());
		const arquivo_hash = Array.from(new Uint8Array(hashBuffer))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		const p = platform as Record<string, unknown> | undefined;
		const r2 = getR2(p);
		const [yyyy, mm, dd] = gise.data_inicio.split('-');
		const mesAno = `${yyyy}-${mm}`;
		const folder = `gise/${mesAno}/${dd}/${id}/relatorios_extra`;
		const prefixBase = `${folder}/gise_rel_${id}_sec_${seccionalId}_${hash}`;

		let selfieKey: string | undefined = undefined;

		if (r2) {
			await r2.put(`${prefixBase}_assinada.pdf`, pdfParaSalvar, { contentType: 'application/pdf' });
			if (selfieBase64) {
				// Helper compartilhado: valida magic bytes, limita 5 MB, chave UUID.
				const r = await uploadSelfieDataUri(r2, `${folder}/selfies`, selfieBase64);
				if (r.ok) selfieKey = r.key;
			}
		}

		await salvarAssinaturaRelatorioGise(db, {
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
		});

		await tentarPromoverGiseProntaParaFinalizar(db, giseIdNum);

		return json({ success: true });
	} catch (e) {
		return serverError(
			`[gise/relatorios/assinar] Falha ao salvar assinatura (gise_id=${id}, seccional_id=${seccionalId})`,
			e
		);
	}
};
