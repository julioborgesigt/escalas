/**
 * FASE 1 da assinatura avançada por passkey do relatório extraordinário.
 *
 * Duas fases porque a asserção WebAuthn acontece NO NAVEGADOR, entre elas: esta
 * monta o PDF e emite a INTENÇÃO, o `finalizar-assinatura-avancada` confere a
 * asserção contra ela e sela. Nada é persistido como assinado aqui — cancelar o
 * Face ID não pode deixar relatório meio-assinado no banco.
 *
 * A ordem dos portões é deliberada e vale a pena não mexer: papel → seccional
 * pertence a esta GISE → **todos confirmaram a saída** → chave ativa → corpo →
 * evidências. A checagem de saída completa vem ANTES da cerimônia porque é a
 * mais provável de recusar, e recusar depois queimaria a asserção de quem já
 * encostou o dedo no leitor.
 *
 * `verificarSaidaCompletaSeccional` recebe `isSupExtraGate` porque o quadro de
 * supervisão é uma "seccional" sintética: quem conta ali são supervisor,
 * assessor e SEINT, não os membros das equipes.
 *
 * A cópia de CONFERÊNCIA (sem manifesto) vai para o R2 já nesta fase, e a falha
 * dela é `warn`, não erro: é a via que circula, não o documento com valor
 * probatório. Perder a cópia não pode impedir a assinatura.
 *
 * **Só o supervisor DESIGNADO assina. Admin Geral não entra, e isso é decisão
 * de ago/2026, não descuido.** As CINCO rotas desta família aceitavam
 * `u.tipo === 'admin'`; nenhuma tela jamais ofereceu isso. O `load` de
 * `gise/[id]` define `isSupervisor = u.tipo === 'policial' ? … : false`, e os
 * dois pontos de entrada da assinatura estão atrás dele — `SupervisaoDocExtra`
 * e `SeccionalRelatoriosDownloads`. O lote (`GiseLoteAssinaturas`) chega a
 * renderizar para o admin, mas recebe `podeAssinar={isSupervisor}`. O que o
 * admin alcança é "Conferência": baixar, não assinar.
 *
 * O que decidiu não foi a tela — foi o que o documento CARREGARIA. A sessão de
 * admin é montada sem `cpf`, sem `matrícula` e sem `cargo` (`mapearAdmin`).
 * Assinando por POST direto, o relatório sairia com matrícula `null` e com o
 * CPF que o CLIENTE mandasse, ou vazio. Num documento com valor jurídico, a
 * afirmação de identidade seria a única coisa que ninguém verificou.
 *
 * O detalhe que fecha: o Admin Geral VINCULADO é a mesma pessoa com duas linhas
 * (`policiais` + `administradores`). Em modo usuário ela assina com CPF e
 * matrícula; em modo admin, sem nenhum dos dois. A identidade no documento
 * dependeria de qual cookie estava ativo. A UI já a encaminha certo — só o
 * servidor não encaminhava.
 *
 * Mesma remoção que o portão da ESCALA GISE recebeu antes, pelo mesmo motivo
 * (`CLAUDE.md`, §Duplicação). Coberto por `relatorio-extra-gise.spec.ts`.
 * */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, tryGetR2 } from '$lib/db';
import { apiError, ErrorCode, serverError, requireAuth, validateBody } from '$lib/server/api';
import { giseSignatureSchema } from '$lib/schemas';
import { validarEvidenciasAvancada } from '$lib/server/assinatura/signature-service';
import { carregarRelatorioExtraParaAssinatura } from '$lib/server/gise/permissao';
import { criarIntencaoAssinatura } from '$lib/server/assinatura/intencao';
import { descreverVinculoCredencial } from '$lib/server/assinatura/webauthn/authenticator-data';
import { credencialDoUsuario } from '$lib/server/auth/credencial';
import { exigirChaveAtiva } from '$lib/server/assinatura/chave-assinatura';
import { bucketParaAssinatura } from '$lib/server/assinatura/blob-assinado';
import { montarPdfExtraAssinado, subirSelfieExtra } from '$lib/server/gise/assinatura-extra';
import { chaveConferencia } from '$lib/server/assinatura/copia-conferencia';
import { calcularHashBuffer, envComoRegistro } from '$lib/server/assinatura/document-utils';
import { bytesToBase64 } from '$lib/crypto/bin';
import { logger } from '$lib/server/logger';
import { mensagemDeErro } from '$lib/utils/erro';

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

	const ua = request.headers.get('user-agent') || '';
	const ip = getClientAddress();
	const db = getDB(platform);
	const portao = await carregarRelatorioExtraParaAssinatura(db, params, u);
	if (portao.recusa) return portao.recusa;
	const { gise, giseId: giseIdNum, secId: secIdNum } = portao;

	const chave = await exigirChaveAtiva(db, credencialDoUsuario(u), ua);
	if ('recusa' in chave) return chave.recusa;
	const credencial = chave.credencial;

	const v = await validateBody(request, giseSignatureSchema);
	if (!v.ok) return v.response;
	const {
		latitude,
		longitude,
		selfieBase64,
		codigoValidação,
		desafioId,
		livenessChallenge,
		reauthId,
		hash: inputHash
	} = v.data;

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
		{ platform, sessaoToken: cookies.get('session_token') }
	);
	if (!evid.ok) return apiError(evid.error, evid.status, evid.code ?? ErrorCode.VALIDATION);

	const hash =
		inputHash ||
		crypto.randomUUID().slice(0, 8).toUpperCase() +
			'-' +
			crypto.randomUUID().slice(0, 8).toUpperCase();

	try {
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
			evidencias: {
				latitude: evid.validated.latitude,
				longitude: evid.validated.longitude,
				selfieBase64: evid.validated.selfieBase64,
				livenessChallenge: evid.validated.livenessChallenge,
				politicaDispositivoMovel: evid.validated.politicaDispositivoMovel,
				passkey: {
					credentialId: credencial.credentialId,
					vinculo: descreverVinculoCredencial(credencial)
				}
			},
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
			evid.validated.selfieBase64
		);
		try {
			await bucketOk.r2.put(chaveConferencia(hash), montado.pdfComRodape, {
				httpMetadata: { contentType: 'application/pdf' }
			});
		} catch (err) {
			logger.warn('[extra/preparar-assinatura-avancada] Falha na cópia de conferência', {
				error: mensagemDeErro(err)
			});
		}

		const intencao = await criarIntencaoAssinatura(
			db,
			{ recurso: 'gise_relatorio', recursoId: giseIdNum, escopoId: secIdNum },
			{ id: u.id, tipo: u.tipo },
			montado.finalPdf,
			montado.verificationHash,
			{ selfieKey, latitude: evid.validated.latitude, longitude: evid.validated.longitude }
		);

		return json({
			intencao,
			preparedPdf: bytesToBase64(montado.finalPdf),
			documentHash: await calcularHashBuffer(montado.finalPdf),
			credentialId: credencial.credentialId
		});
	} catch (err) {
		return serverError(
			`[extra/preparar-assinatura-avancada] Falha (gise=${giseIdNum}, sec=${secIdNum})`,
			err
		);
	}
};
