/**
 * Assinatura EM TELA do relatório de serviço extraordinário de uma seccional
 * (ou do quadro de supervisão) — assinatura avançada, sem certificado.
 *
 * Com a flag de chave ligada, este um-tiro morre (403); o titular usa o par
 * preparar/finalizar. O miolo do PDF vive em `assinatura-extra.ts`.
 *
 * Só o supervisor DESIGNADO, como as outras quatro rotas da família — o porquê
 * da remoção do Admin Geral está no cabeçalho de
 * `preparar-assinatura-avancada/+server.ts`.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, auditar, contextoDeEvento, tryGetR2 } from '$lib/db';
import { carregarRelatorioExtraParaAssinatura } from '$lib/server/gise/permissao';
import { giseSignatureSchema } from '$lib/schemas';
import { validarEvidenciasAvancada } from '$lib/server/assinatura/signature-service';
import { bucketParaAssinatura } from '$lib/server/assinatura/blob-assinado';
import {
	montarPdfExtraAssinado,
	persistirExtraAssinado,
	subirSelfieExtra
} from '$lib/server/gise/assinatura-extra';
import type { EvidenciasMontagem } from '$lib/server/escalas/assinatura-escala';
import { envComoRegistro } from '$lib/server/assinatura/document-utils';
import { apiError, ErrorCode, requireAuth, serverError, validateBody } from '$lib/server/api';

export const POST: RequestHandler = async (event) => {
	const { locals, params, request, platform, cookies, getClientAddress, url } = event;
	const u = requireAuth(locals);
	if (u instanceof Response) return u;
	const v = await validateBody(request, giseSignatureSchema);
	if (!v.ok) return v.response;

	const {
		type,
		hash: inputHash,
		latitude,
		longitude,
		selfieBase64,
		codigoValidação,
		desafioId,
		livenessChallenge,
		reauthId
	} = v.data;

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';
	const hash =
		inputHash ||
		crypto.randomUUID().slice(0, 8).toUpperCase() +
			'-' +
			crypto.randomUUID().slice(0, 8).toUpperCase();

	const db = getDB(platform);

	const portao = await carregarRelatorioExtraParaAssinatura(db, params, u);
	if (portao.recusa) return portao.recusa;
	const { gise, giseId: giseIdNum, secId: secIdNum } = portao;

	try {
		let evidenciasMontagem: EvidenciasMontagem = {};
		if (type !== 'serpro') {
			const evid = await validarEvidenciasAvancada(
				db,
				u,
				{
					latitude: latitude ?? undefined,
					longitude: longitude ?? undefined,
					selfieBase64,
					codigoValidação,
					desafioId,
					livenessChallenge,
					userAgent: ua,
					reauthId
				},
				{
					platform,
					sessaoToken: cookies.get('session_token'),
					recusarSePasskeyExigida: true
				}
			);
			if (!evid.ok) return apiError(evid.error, evid.status, evid.code ?? ErrorCode.VALIDATION);
			evidenciasMontagem = {
				latitude: evid.validated.latitude,
				longitude: evid.validated.longitude,
				selfieBase64: evid.validated.selfieBase64,
				livenessChallenge: evid.validated.livenessChallenge,
				politicaDispositivoMovel: evid.validated.politicaDispositivoMovel
			};
		} else {
			evidenciasMontagem = { politicaDispositivoMovel: false };
		}

		const bucketOk = bucketParaAssinatura(tryGetR2(platform));
		if (!bucketOk.ok) return bucketOk.resposta;

		const env = envComoRegistro(platform);
		const montado = await montarPdfExtraAssinado({
			db,
			gise,
			giseId: giseIdNum,
			secId: secIdNum,
			assinante: {
				// Identidade do assinante vem da SESSÃO, não do corpo. No fluxo avançado
				// não há certificado que ateste nada: `signerCpf`/`signerName` seriam
				// texto livre do cliente (`z.string().max(20)`, sem formato e sem
				// cruzamento) gravados num documento com valor jurídico. A rota irmã
				// de PRESENÇA sempre fez assim (`signerCpf: u.cpf`); esta confiava no
				// corpo primeiro, e as duas ficaram opostas até ago/2026.
				//
				// No fluxo QUALIFICADO é diferente e continua como está: lá o
				// `signerCpf` é o CPF lido do certificado e existe conferência.
				nome: u.nome,
				cpf: u.cpf,
				matricula: u.tipo === 'policial' ? u.matricula : null
			},
			evidencias: evidenciasMontagem,
			ip: ip ?? undefined,
			userAgent: ua,
			origin: url.origin,
			env,
			platform,
			verificationHash: hash
		});

		const selfieKey = await subirSelfieExtra(
			bucketOk.r2,
			{ id: giseIdNum, data_inicio: gise.data_inicio },
			secIdNum,
			hash,
			evidenciasMontagem.selfieBase64
		);

		const persistido = await persistirExtraAssinado({
			db,
			r2: bucketOk.r2,
			giseId: giseIdNum,
			secId: secIdNum,
			assinante: {
				id: u.tipo === 'policial' ? u.id : null,
				nome: u.nome,
				cpf: u.cpf
			},
			montado,
			selfieKey,
			ip: ip ?? undefined,
			userAgent: ua,
			latitude: evidenciasMontagem.latitude,
			longitude: evidenciasMontagem.longitude,
			env
		});
		if (!persistido.ok) return persistido.resposta;

		const { contexto, env: envAudit } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'assinar_relatorio_gise',
				usuario: u,
				entidade: 'gise',
				entidade_id: giseIdNum,
				alvo_tipo: 'seccional',
				alvo_id: secIdNum,
				detalhes: `Relatório extraordinário da GISE ${giseIdNum} assinado (seccional ${secIdNum})`,
				metadados: { tipo_assinatura: type ?? 'simples', verification_hash: hash },
				...contexto
			},
			{ env: envAudit }
		);

		return json({ success: true });
	} catch (e) {
		return serverError(
			`[gise/relatorios/assinar] Falha ao salvar assinatura (gise_id=${giseIdNum}, seccional_id=${secIdNum})`,
			e
		);
	}
};
