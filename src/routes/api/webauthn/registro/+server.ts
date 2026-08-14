/**
 * Cerimônia de REGISTRO da passkey de assinatura.
 *
 *   GET  → emite o desafio e as opções que o navegador precisa
 *   POST → confere a cerimônia e grava a credencial
 *
 * **Quem pode:** qualquer sessão autenticada, e só para si mesma. A credencial
 * é registrada para o `dono` de quem está logado (`credencialDoUsuario`),
 * nunca para um id vindo do corpo — é o que impede registrar passkey na conta
 * alheia. Não há caminho administrativo de REGISTRO por design: um admin que
 * pudesse cadastrar a chave de outra pessoa esvaziaria o "controle exclusivo"
 * que a passkey existe para provar (Lei 14.063/2020 art. 4º II "b"). Admin
 * revoga (`DELETE`), e a pessoa registra de novo do próprio aparelho.
 *
 * Registrar substitui a credencial anterior — ver `lib/db/webauthn.ts` para o
 * porquê de uma só credencial ativa por pessoa.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarCredencialAtiva,
	criarDesafioWebauthn,
	consumirDesafioWebauthn,
	registrarCredencial,
	revogarCredenciaisAtivas,
	registrarAuditComContexto
} from '$lib/db';
import { requireAuth, apiError, ErrorCode, badRequest, validateBody } from '$lib/server/api';
import { webauthnRegistroSchema } from '$lib/schemas';
import { credencialDoUsuario } from '$lib/server/auth/credencial';
import { resolverAppOrigin } from '$lib/server/app-origin';
import {
	verificarRegistro,
	mensagemRecusaRegistro,
	ALG_ES256
} from '$lib/server/assinatura/webauthn/registro';
import { descreverVinculoCredencial } from '$lib/server/assinatura/webauthn/authenticator-data';
import { base64UrlToBytes } from '$lib/crypto/bin';

export const GET: RequestHandler = async ({ platform, locals, url }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const db = getDB(platform);
	const dono = credencialDoUsuario(u);
	const { desafioId, desafio } = await criarDesafioWebauthn(db, dono);
	const atual = await buscarCredencialAtiva(db, dono);

	return json({
		desafioId,
		desafio,
		// RP ID é o HOST da origem canônica. Credencial criada em `*.pages.dev`
		// não funciona no domínio próprio — por isso `APP_ORIGIN` precisa estar
		// definida em produção, e não só implícita no header Host.
		rpId: new URL(resolverAppOrigin(url, platform)).hostname,
		usuario: {
			// `id` do WebAuthn é opaco e não pode ser um identificador reutilizável
			// fora do sistema: vai o par tipo/id do DONO, não o CPF nem a matrícula.
			id: `${dono.tipo}:${dono.id}`,
			nome: u.nome
		},
		algoritmos: [ALG_ES256],
		/** Já registrada? A tela usa para avisar que registrar de novo substitui. */
		credencialAtual: atual
			? {
					criadoEm: atual.criadoEm,
					apelido: atual.apelido,
					vinculo: descreverVinculoCredencial(atual)
				}
			: null
	});
};

export const POST: RequestHandler = async ({ platform, locals, request, url }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const v = await validateBody(request, webauthnRegistroSchema);
	if (!v.ok) return v.response;
	const dados = v.data;

	const db = getDB(platform);
	const dono = credencialDoUsuario(u);

	// Consome ANTES de verificar: desafio é de uso único, e uma cerimônia
	// recusada não deve deixar o desafio vivo para nova tentativa com outro
	// payload.
	const desafio = await consumirDesafioWebauthn(db, dados.desafioId, dono);
	if (!desafio) {
		return apiError(
			'Desafio de registro inválido ou expirado. Recarregue a página e tente novamente.',
			400,
			ErrorCode.VALIDATION
		);
	}

	const resultado = await verificarRegistro({
		clientDataJSON: base64UrlToBytes(dados.clientDataJSON),
		authenticatorData: base64UrlToBytes(dados.authenticatorData),
		publicKeySpki: base64UrlToBytes(dados.publicKey),
		algoritmo: dados.algoritmo,
		desafioEsperado: desafio,
		origemEsperada: resolverAppOrigin(url, platform)
	});
	if (!resultado.ok) {
		return badRequest(mensagemRecusaRegistro(resultado.motivo));
	}

	await registrarCredencial(db, dono, {
		credentialId: dados.credentialId,
		publicKeySpki: resultado.credencial.publicKeySpki,
		contador: resultado.credencial.contador,
		aaguid: resultado.credencial.aaguid,
		backupElegivel: resultado.credencial.backupElegivel,
		backupAtivo: resultado.credencial.backupAtivo,
		apelido: dados.apelido ?? null
	});

	await registrarAuditComContexto(db, {
		usuario: u,
		acao: 'passkey_registrada',
		entidade: 'policial',
		entidade_id: dono.id,
		// O vínculo entra na trilha porque é o que distingue "chave deste
		// aparelho" de "chave sincronizada na conta" — e é o que o manifesto
		// vai afirmar depois.
		detalhes: `Passkey registrada (${descreverVinculoCredencial(resultado.credencial)})`
	});

	return json({
		success: true,
		vinculo: descreverVinculoCredencial(resultado.credencial)
	});
};

/**
 * Revoga a própria credencial. O titular sempre pode — é o caminho de quem
 * trocou de aparelho e quer limpar o anterior antes de registrar o novo.
 */
export const DELETE: RequestHandler = async ({ platform, locals }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;

	const db = getDB(platform);
	const dono = credencialDoUsuario(u);
	const quantas = await revogarCredenciaisAtivas(db, dono);

	if (quantas > 0) {
		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'passkey_revogada',
			entidade: 'policial',
			entidade_id: dono.id,
			detalhes: 'Passkey revogada pelo próprio titular'
		});
	}

	return json({ success: true, revogadas: quantas });
};
