/**
 * FASE 2 da presença avançada por passkey: confere a asserção, persiste a
 * entrada/saída, sela e grava o termo em `gise_presenca_termos` (o GET do
 * comprovante passa a servir o R2).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDB,
	buscarGiseEscala,
	resolverParticipacaoGisePolicial,
	registrarUsoCredencial,
	registrarAuditComContexto,
	tryGetR2,
	passkeyMetaDeAssercao,
	salvarTermoPresencaGise,
	salvarEntradaGise,
	salvarSaidaGise,
	sincronizarStatusGiseAposPresencaRelatorios
} from '$lib/db';
import {
	badRequest,
	notFound,
	forbidden,
	conflict,
	serverError,
	requireAuth,
	validateBody
} from '$lib/server/api';
import { finalizarPasskeyEscalaSchema } from '$lib/schemas';
import { gateDePresenca } from '$lib/server/gise/presenca-gate';
import { invalidarPapelGise } from '$lib/server/gise/papel-cache';
import { descreverVinculoCredencial } from '$lib/server/assinatura/webauthn/authenticator-data';
import { conferirFinalizacaoPasskey } from '$lib/server/assinatura/webauthn/finalizar-avancada';
import {
	bucketParaAssinatura,
	compensarBlobAssinado,
	guardarPdfAssinado
} from '$lib/server/assinatura/blob-assinado';
import { selarPdfInstitucional } from '$lib/server/assinatura/server-seal';
import { calcularHashBuffer, envComoRegistro } from '$lib/server/assinatura/document-utils';

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
	if (u.tipo !== 'policial') return forbidden('Apenas policiais confirmam presença.');

	const ua = request.headers.get('user-agent') || '';
	const ip = getClientAddress();
	const giseId = parseInt(params.id!);
	if (isNaN(giseId)) return badRequest('ID inválido');

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return notFound('Escala GISE');

	const part = await resolverParticipacaoGisePolicial(db, giseId, u.id);
	if (!part.participa) return forbidden('Você não participa desta escala GISE.');

	const tipoParam = url.searchParams.get('tipo');
	const tipo = tipoParam === 'saida' ? 'saida' : tipoParam === 'entrada' ? 'entrada' : null;
	if (!tipo) return badRequest('Informe ?tipo=entrada|saida');

	const gate = await gateDePresenca(db, { ...part, statusGise: gise.status }, giseId, u.id, tipo);
	if (!gate.ok) return gate.resposta;

	const validated = await validateBody(request, finalizarPasskeyEscalaSchema);
	if (!validated.ok) return validated.response;

	const prova = await conferirFinalizacaoPasskey({
		db,
		alvo: { recurso: 'gise_presenca', recursoId: giseId, escopoId: tipo === 'entrada' ? 1 : 2 },
		usuario: u,
		corpo: validated.data,
		url,
		platform,
		logTag: 'presenca/finalizar-passkey'
	});
	if (!prova.ok) return prova.recusa;
	const { credencial, pdfBytes } = prova;

	try {
		const bucketOk = bucketParaAssinatura(tryGetR2(platform));
		if (!bucketOk.ok) return bucketOk.resposta;

		await registrarUsoCredencial(db, credencial.id, prova.dados.contador);

		const env = envComoRegistro(platform);
		const selado = await selarPdfInstitucional(pdfBytes, u.nome, { env });
		const pdfParaSalvar = selado.ok ? selado.pdf : pdfBytes;
		const arquivoHash = await calcularHashBuffer(pdfParaSalvar);

		const [yyyy, mm, dd] = gise.data_inicio.split('-');
		const folder = `gise/${yyyy}-${mm}/${dd}/${giseId}/presencas_termos`;
		const r2Key = `${folder}/termo_${tipo}_pol_${u.id}_${prova.verificacaoHash}.pdf`;

		const guardado = await guardarPdfAssinado(bucketOk.r2, r2Key, pdfParaSalvar, 'gise-presenca');
		if (!guardado.ok) return guardado.resposta;

		const rubrica = prova.contexto.rubrica || '';
		if (tipo === 'entrada') {
			await salvarEntradaGise(
				db,
				giseId,
				u.id,
				rubrica,
				ip,
				ua,
				prova.contexto.latitude ?? undefined,
				prova.contexto.longitude ?? undefined,
				prova.contexto.selfieKey ?? undefined
			);
		} else {
			const saida = await salvarSaidaGise(
				db,
				giseId,
				u.id,
				rubrica,
				ip,
				ua,
				prova.contexto.latitude ?? undefined,
				prova.contexto.longitude ?? undefined,
				prova.contexto.selfieKey ?? undefined
			);
			if (!saida.registrada) {
				await compensarBlobAssinado(db, bucketOk.r2, [r2Key], 'gise-presenca');
				return conflict(
					'Não há confirmação de ENTRADA registrada — a saída não pode ser assinada.'
				);
			}
		}

		await salvarTermoPresencaGise(
			db,
			{
				gise_id: giseId,
				policial_id: u.id,
				tipo,
				assinante_nome: u.nome,
				assinante_cpf: u.cpf,
				assinante_email: u.email,
				verification_hash: prova.verificacaoHash,
				r2_key: r2Key,
				arquivo_hash: arquivoHash,
				ip_address: ip,
				user_agent: ua,
				latitude: prova.contexto.latitude ?? undefined,
				longitude: prova.contexto.longitude ?? undefined,
				passkeyMeta: passkeyMetaDeAssercao(validated.data.assercao, prova.dados.backupAtivo)
			},
			platform?.env
		);

		await sincronizarStatusGiseAposPresencaRelatorios(db, giseId);
		await invalidarPapelGise(u.id);

		await registrarAuditComContexto(db, {
			usuario: u,
			acao: tipo === 'entrada' ? 'presenca_gise_entrada' : 'presenca_gise_saida',
			entidade: 'gise',
			entidade_id: giseId,
			detalhes:
				`Presença ${tipo} GISE ${giseId} com passkey — ` +
				`credencial ${descreverVinculoCredencial(prova.dados)}`
		});

		return json({ success: true });
	} catch (err) {
		return serverError(`[presenca/finalizar-assinatura-avancada] Falha (gise=${giseId})`, err);
	}
};
