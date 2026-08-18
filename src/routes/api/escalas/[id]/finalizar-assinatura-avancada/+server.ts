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
import { getDB, registrarUsoCredencial, registrarAuditComContexto, getR2, hasR2 } from '$lib/db';
import { serverError, requireAuth, validateBody } from '$lib/server/api';
import { finalizarPasskeyEscalaSchema } from '$lib/schemas';
import { persistirEscalaAssinada } from '$lib/server/escalas/assinatura-escala';
import { descreverVinculoCredencial } from '$lib/server/assinatura/webauthn/authenticator-data';
import {
	conferirFinalizacaoPasskey,
	evidenciasDaProva
} from '$lib/server/assinatura/webauthn/finalizar-avancada';
import { carregarEscalaParaAssinatura } from '$lib/server/escalas/permissao';

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

	const db = getDB(platform);
	const portao = await carregarEscalaParaAssinatura(
		db,
		params.id,
		u,
		'Revogue a assinatura existente antes de assinar novamente'
	);
	if (portao.recusa) return portao.recusa;
	const { id } = portao;

	// Permissão ANTES do Zod: o corpo carrega o PDF preparado (até 10 MB). Ler
	// isso de quem já seria recusado só para devolver 400 mascara o gate — e é
	// exatamente o que `e2e/autorizacao-negativa` recusa (400 ≠ 401/403/404).
	const validated = await validateBody(request, finalizarPasskeyEscalaSchema);
	if (!validated.ok) return validated.response;
	const prova = await conferirFinalizacaoPasskey({
		db,
		alvo: { recurso: 'escala', recursoId: id },
		usuario: u,
		corpo: validated.data,
		url,
		platform,
		logTag: 'finalizar-passkey'
	});
	if (!prova.ok) return prova.recusa;
	const { credencial, pdfBytes } = prova;

	try {
		if (!hasR2(platform)) {
			return serverError(
				'[finalizar-assinatura-avancada] R2 não configurado',
				new Error('R2_NOT_CONFIGURED')
			);
		}
		const bucket = getR2(platform);

		await registrarUsoCredencial(db, credencial.id, prova.dados.contador);

		await persistirEscalaAssinada({
			db,
			bucket,
			escalaId: id,
			montado: {
				// Sem `pdfComRodape`: a cópia de conferência já foi gravada no
				// `preparar`, que é quem tinha a versão sem manifesto. Regravar
				// aqui trocaria a cópia de conferência pelo PDF COM manifesto.
				finalPdf: pdfBytes,
				verificationHash: prova.verificacaoHash
			},
			assinante: { nome: u.nome, cpf: u.cpf },
			...evidenciasDaProva(prova, {
				ip,
				userAgent: ua,
				platform,
				assercao: validated.data.assercao
			})
		});

		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'assinar_escala',
			entidade: 'escala',
			entidade_id: id,
			detalhes:
				`Escala ${id} assinada com passkey (avançada) por ${u.nome} — ` +
				`credencial ${descreverVinculoCredencial(prova.dados)}`
		});

		return json({ success: true, message: 'Escala assinada com sucesso' });
	} catch (err) {
		return serverError(
			`[finalizar-assinatura-avancada] Falha ao gravar assinatura (escala_id=${id})`,
			err
		);
	}
};
