/**
 * FASE 2 da assinatura avançada por passkey da escala.
 *
 * Recebe a asserção WebAuthn produzida sobre o hash do PDF preparado, confere
 * e só então sela e grava o documento.
 *
 * **A intenção não substitui a permissão.** Ela prova que ESTE ator preparou
 * ESTE documento para ESTE alvo — não que ele ainda pode assiná-lo. Permissão
 * pode ter sido revogada entre as duas fases, e por isso as mesmas recusas do
 * `preparar` são refeitas aqui. É a lição que `intencao.ts` já registra.
 *
 * Ordem das checagens, e ela importa:
 *   1. permissão (barata, e recusa quem nem deveria estar aqui);
 *   2. documento já existente (409 — reassinatura exige revogar antes);
 *   3. intenção: consome, confere alvo/ator e que o PDF do corpo é o preparado;
 *   4. credencial: existe, é do titular e não está revogada;
 *   5. asserção: desafio, origem, RP ID, UV, contador e assinatura.
 *
 * O passo 3 vem antes do 5 de propósito: sem ele, a asserção seria verificada
 * contra um PDF que o cliente escolheu.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarEscala,
	buscarDocumentoEscala,
	buscarCredencialPorId,
	registrarUsoCredencial,
	registrarAuditComContexto,
	getR2,
	hasR2
} from '$lib/db';
import {
	apiError,
	ErrorCode,
	badRequest,
	notFound,
	forbidden,
	conflict,
	serverError,
	requireAuth,
	validateBody
} from '$lib/server/api';
import { finalizarPasskeyEscalaSchema } from '$lib/schemas';
import { persistirEscalaAssinada } from '$lib/server/escalas/assinatura-escala';
import {
	consumirIntencaoAssinatura,
	mensagemRecusaIntencao
} from '$lib/server/assinatura/intencao';
import {
	verificarAssercao,
	mensagemRecusaAssercao
} from '$lib/server/assinatura/webauthn/assercao';
import { descreverVinculoCredencial } from '$lib/server/assinatura/webauthn/authenticator-data';
import { credencialDoUsuario } from '$lib/server/auth/credencial';
import { resolverAppOrigin } from '$lib/server/app-origin';
import { verificarPermissaoEscala, podeAssinarEscala } from '$lib/server/escalas/permissao';
import { calcularHashBuffer } from '$lib/server/assinatura/document-utils';
import { base64ToBytes, base64UrlToBytes } from '$lib/crypto/bin';
import { hexToBytes } from '$lib/crypto/hex';

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

	const ip = getClientAddress();
	const ua = request.headers.get('user-agent') || '';

	const id = parseInt(params.id!);
	if (isNaN(id)) return badRequest('ID inválido');

	const db = getDB(platform);
	const escala = await buscarEscala(db, id);
	if (!escala) return notFound('Escala');

	const perm = await verificarPermissaoEscala(db, id, escala.lotacao, u);
	if (!perm.permitido) return forbidden(perm.motivo ?? 'Sem permissão para assinar esta escala');
	if (!podeAssinarEscala(u)) {
		return forbidden('Apenas Admin Geral ou DPC com papel administrativo pode assinar esta escala');
	}
	if (await buscarDocumentoEscala(db, id)) {
		return conflict('Revogue a assinatura existente antes de assinar novamente');
	}

	// Permissão ANTES do Zod: o corpo carrega o PDF preparado (até 10 MB). Ler
	// isso de quem já seria recusado só para devolver 400 mascara o gate — e é
	// exatamente o que `e2e/autorizacao-negativa` recusa (400 ≠ 401/403/404).
	const validated = await validateBody(request, finalizarPasskeyEscalaSchema);
	if (!validated.ok) return validated.response;
	const { intencao, preparedPdf, assercao } = validated.data;

	const pdfBytes = base64ToBytes(preparedPdf);

	const consumo = await consumirIntencaoAssinatura(
		db,
		intencao,
		{ recurso: 'escala', recursoId: id },
		{ id: u.id, tipo: u.tipo },
		pdfBytes
	);
	if (!consumo.ok) return badRequest(mensagemRecusaIntencao());

	// A credencial precisa ser a do PRÓPRIO titular. Sem esta checagem, uma
	// asserção válida feita por outra pessoa (com a chave dela, sobre o mesmo
	// PDF público) seria aceita como assinatura desta.
	const credencial = await buscarCredencialPorId(db, assercao.credentialId);
	const dono = credencialDoUsuario(u);
	if (
		!credencial ||
		credencial.revogadaEm ||
		credencial.dono.tipo !== dono.tipo ||
		credencial.dono.id !== dono.id
	) {
		return apiError(
			'Chave de assinatura não reconhecida ou revogada. Registre-a novamente em Meu Perfil.',
			403,
			ErrorCode.FORBIDDEN
		);
	}

	// O desafio é o hash do PDF preparado — o mesmo valor que a intenção guardou
	// e que o passo anterior acabou de conferir contra estes bytes.
	const desafio = hexToBytes(await calcularHashBuffer(pdfBytes));
	if (!desafio) return serverError('[finalizar-passkey] hash do PDF inválido', new Error('HASH'));

	const verificacao = await verificarAssercao({
		clientDataJSON: base64UrlToBytes(assercao.clientDataJSON),
		authenticatorData: base64UrlToBytes(assercao.authenticatorData),
		assinatura: base64UrlToBytes(assercao.assinatura),
		publicKeySpki: credencial.publicKeySpki,
		desafioEsperado: desafio,
		origemEsperada: resolverAppOrigin(url, platform),
		contadorArmazenado: credencial.contador
	});
	if (!verificacao.ok) {
		return apiError(mensagemRecusaAssercao(), 403, ErrorCode.FORBIDDEN);
	}

	try {
		if (!hasR2(platform)) {
			return serverError(
				'[finalizar-assinatura-avancada] R2 não configurado',
				new Error('R2_NOT_CONFIGURED')
			);
		}
		const bucket = getR2(platform);

		await registrarUsoCredencial(db, credencial.id, verificacao.dados.contador);

		await persistirEscalaAssinada({
			db,
			bucket,
			escalaId: id,
			montado: {
				// Sem `pdfComRodape`: a cópia de conferência já foi gravada no
				// `preparar`, que é quem tinha a versão sem manifesto. Regravar
				// aqui trocaria a cópia de conferência pelo PDF COM manifesto.
				finalPdf: pdfBytes,
				verificationHash: consumo.verificacaoHash
			},
			assinante: { nome: u.nome, cpf: u.cpf },
			selfieKey: consumo.contexto.selfieKey,
			ip: ip ?? undefined,
			userAgent: ua || undefined,
			latitude: consumo.contexto.latitude,
			longitude: consumo.contexto.longitude,
			env: platform?.env as unknown as Record<string, string | undefined> | undefined
		});

		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'assinar_escala',
			entidade: 'escala',
			entidade_id: id,
			detalhes:
				`Escala ${id} assinada com passkey (avançada) por ${u.nome} — ` +
				`credencial ${descreverVinculoCredencial(verificacao.dados)}`
		});

		return json({ success: true, message: 'Escala assinada com sucesso' });
	} catch (err) {
		return serverError(
			`[finalizar-assinatura-avancada] Falha ao gravar assinatura (escala_id=${id})`,
			err
		);
	}
};
