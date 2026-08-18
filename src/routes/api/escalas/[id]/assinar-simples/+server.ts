/**
 * Assinatura EM TELA da escala (avançada, sem certificado) — o caminho usado
 * pela maioria: rubrica desenhada, mais foto, GPS e código por e-mail conforme
 * as flags de configuração.
 *
 * Produz e persiste os dois artefatos da escala assinada:
 *   - o PDF com o rodapé e o QR de `/validar`, gravado no R2;
 *   - a CÓPIA DE CONFERÊNCIA, em chave própria (`chaveConferencia`), que é a
 *     versão que circula.
 *
 * Reassinar substitui o documento anterior, e `limparR2ObsoletoEscala` remove
 * os blobs da assinatura antiga — mantendo os recém-gravados na lista de
 * exceções. Sem isso, cada reassinatura deixaria PDF e selfie órfãos no R2, com
 * dado pessoal e sem nenhuma linha que os localize (R2-1).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, listarPoliciaisEscala, registrarAuditComContexto, getR2, hasR2 } from '$lib/db';
import {
	apiError,
	ErrorCode,
	badRequest,
	serverError,
	requireAuth,
	validateBody
} from '$lib/server/api';
import { assinarSimplesSchema } from '$lib/schemas';
import { validarEvidenciasAvancada } from '$lib/server/assinatura/signature-service';
import {
	montarPdfEscalaAssinada,
	persistirEscalaAssinada,
	subirSelfieEscala
} from '$lib/server/escalas/assinatura-escala';
import { carregarEscalaParaAssinatura } from '$lib/server/escalas/permissao';

export const POST: RequestHandler = async ({
	platform,
	params,
	locals,
	url,
	request,
	cookies,
	getClientAddress
}) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const validated = await validateBody(request, assinarSimplesSchema);
	if (!validated.ok) return validated.response;
	const {
		rubrica,
		latitude,
		longitude,
		selfieBase64,
		codigoValidação,
		desafioId,
		livenessChallenge,
		reauthId
	} = validated.data;

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const db = getDB(platform);
	const portao = await carregarEscalaParaAssinatura(
		db,
		params.id,
		u,
		'Revogue a assinatura existente antes de assinar novamente'
	);
	if (portao.recusa) return portao.recusa;
	const { escala, id } = portao;

	const policiais = await listarPoliciaisEscala(db, id);
	if (!policiais || policiais.length === 0) {
		return badRequest('A escala está vazia e não pode ser assinada');
	}

	// Validação de evidências unificada: aplica TODAS as flags globais
	// (foto/GPS/2FA) — antes da consolidação, este endpoint ignorava silenciosamente
	// foto e 2FA, fazendo escala mensal cair para nível SIMPLES (Lei 14.063 art. 4º I)
	// mesmo com flags ligadas no admin.
	const evid = await validarEvidenciasAvancada(
		db,
		u,
		{
			rubrica,
			latitude,
			longitude,
			selfieBase64,
			codigoValidação,
			desafioId,
			livenessChallenge,
			userAgent: ua,
			reauthId
		},
		{ platform, recusarSePasskeyExigida: true, sessaoToken: cookies.get('session_token') }
	);
	if (!evid.ok) return apiError(evid.error, evid.status, evid.code ?? ErrorCode.VALIDATION);
	const validatedEv = evid.validated;

	try {
		const montado = await montarPdfEscalaAssinada({
			escala,
			policiais,
			assinante: { nome: u.nome, cpf: u.cpf, email: u.email },
			evidencias: {
				rubrica: validatedEv.rubrica,
				latitude: validatedEv.latitude,
				longitude: validatedEv.longitude,
				selfieBase64: validatedEv.selfieBase64,
				livenessChallenge: validatedEv.livenessChallenge,
				politicaDispositivoMovel: validatedEv.politicaDispositivoMovel
			},
			ip: ip ?? undefined,
			userAgent: ua || undefined,
			origin: url.origin,
			env: platform?.env as unknown as Record<string, string | undefined> | undefined
		});

		if (!hasR2(platform)) {
			return serverError('[assinar-simples] R2 não configurado', new Error('R2_NOT_CONFIGURED'));
		}
		const bucket = getR2(platform);

		const selfieKey = await subirSelfieEscala(bucket, id, validatedEv.selfieBase64);

		await persistirEscalaAssinada({
			db,
			bucket,
			escalaId: id,
			montado,
			assinante: { nome: u.nome, cpf: u.cpf },
			selfieKey,
			ip: ip ?? undefined,
			userAgent: ua || undefined,
			latitude: validatedEv.latitude,
			longitude: validatedEv.longitude,
			env: platform?.env as unknown as Record<string, string | undefined> | undefined
		});

		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'assinar_escala',
			entidade: 'escala',
			entidade_id: id,
			detalhes: `Escala ${id} assinada via rubrica (avançada) por ${u.nome}`
		});

		return json({ success: true, message: 'Escala assinada manualmente com sucesso' });
	} catch (err) {
		return serverError(`[assinar-simples] Falha ao processar assinatura (escala_id=${id})`, err);
	}
};
