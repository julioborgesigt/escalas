/**
 * GET /api/gise/[id]/presenca/termo?tipo=entrada|saida
 *
 * Baixa o comprovante (Termo de Presença) da confirmação de entrada/saída do
 * PRÓPRIO policial autenticado. Dois caminhos, transparentes para o cliente:
 *
 *   - QUALIFICADA (Token A3): há termo assinado em `gise_presenca_termos` — o PDF
 *     já existe no R2 (não é reproduzível); servimos os bytes guardados.
 *   - AVANÇADA (tela/mobile): não há PDF salvo; geramos o termo SOB DEMANDA a
 *     partir das evidências em `gise_presencas` (rubrica + selfie + GPS/IP), com
 *     selo institucional. Nada é persistido.
 */

import type { RequestHandler } from './$types';
import {
	getDB,
	buscarGiseEscala,
	buscarPresencasGise,
	buscarTermoPresencaGise,
	resolverParticipacaoGisePolicial,
	tryGetR2
} from '$lib/db';
import { requireAuth, badRequest, notFound, forbidden, serverError } from '$lib/server/api';
import { montarTermoPresencaAvancado } from '$lib/server/gise/gise-termo-presenca';

function respostaPdf(data: ArrayBuffer | Uint8Array, filename: string): Response {
	return new Response(data as BodyInit, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-store'
		}
	});
}

export const GET: RequestHandler = async ({ platform, params, locals, url }) => {
	const u = requireAuth(locals);
	if (u instanceof Response) return u;
	if (u.tipo !== 'policial') {
		return forbidden('Apenas policiais podem baixar o comprovante de presença.');
	}

	const giseId = parseInt(params.id!);
	if (isNaN(giseId)) return badRequest('Parâmetro inválido');

	const tipo = url.searchParams.get('tipo');
	if (tipo !== 'entrada' && tipo !== 'saida') {
		return badRequest('Tipo inválido (use entrada|saida).');
	}

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, giseId);
	if (!gise) return notFound('Escala GISE');

	// Autorização: só o próprio participante baixa o seu comprovante.
	const part = await resolverParticipacaoGisePolicial(db, giseId, u.id);
	if (!part.participa) return forbidden('Você não participa desta escala GISE.');

	const p = platform as App.Platform | undefined;
	const filename = `comprovante_presenca_${tipo}_gise_${giseId}.pdf`;

	// 1) Token A3 (qualificada): serve o PDF já assinado e guardado no R2.
	const termo = await buscarTermoPresencaGise(db, giseId, u.id, tipo);
	if (termo?.r2_key) {
		const r2 = tryGetR2(p);
		const obj = r2 ? await r2.get(termo.r2_key) : null;
		if (!obj) return notFound('Comprovante de presença');
		return respostaPdf(await obj.arrayBuffer(), filename);
	}

	// 2) Assinatura em tela (avançada): gera sob demanda a partir das evidências.
	const presencas = await buscarPresencasGise(db, giseId, p?.env);
	const presenca = presencas.find((pr) => pr.policial_id === u.id);
	if (!presenca) return notFound('Confirmação de presença');

	const rubrica = tipo === 'entrada' ? presenca.entrada_rubrica : presenca.saida_rubrica;
	const ts = tipo === 'entrada' ? presenca.entrada_timestamp : presenca.saida_timestamp;
	if (!rubrica || !ts) {
		return notFound(
			`Confirmação de ${tipo === 'entrada' ? 'entrada' : 'saída'} ainda não registrada.`
		);
	}

	// Selfie (prova de vida) opcional, guardada no R2 como imagem.
	const selfieKey = tipo === 'entrada' ? presenca.entrada_selfie_key : presenca.saida_selfie_key;
	let selfieBase64: string | undefined;
	const r2 = tryGetR2(p);
	if (selfieKey && r2) {
		try {
			const obj = await r2.get(selfieKey);
			if (obj) {
				selfieBase64 = `data:image/jpeg;base64,${Buffer.from(await obj.arrayBuffer()).toString('base64')}`;
			}
		} catch {
			// selfie opcional (ausente/ilegível) — segue sem ela
		}
	}

	try {
		const pdf = await montarTermoPresencaAvancado({
			tipo,
			presencaId: presenca.id,
			giseId,
			dataInicio: gise.data_inicio,
			unidadeNome: part.unidadeNome,
			signerName: presenca.policial_nome,
			signerCpf: presenca.policial_cpf,
			matricula: presenca.policial_matricula,
			timestampISO: ts,
			rubricaBase64: rubrica,
			selfieBase64,
			ip: presenca.ip_address,
			userAgent: presenca.user_agent,
			latitude: presenca.latitude,
			longitude: presenca.longitude,
			origin: url.origin,
			env: p?.env as unknown as Record<string, string | undefined> | undefined
		});
		return respostaPdf(pdf, filename);
	} catch (e) {
		return serverError(
			`[gise/presenca/termo] Falha ao gerar comprovante (gise_id=${giseId}, tipo=${tipo})`,
			e
		);
	}
};
