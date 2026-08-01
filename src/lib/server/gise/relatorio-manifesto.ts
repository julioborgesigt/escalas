import type { AuditTrailOptions } from '$lib/server/assinatura/pdf-signing';
import type { Database } from '$lib/db';
import type { GiseDetalhado } from '$lib/db/gise';
import {
	buscarPresencasGise,
	buscarGiseSeccionalMembros,
	buscarTermosPresencaGise,
	tryGetR2
} from '$lib/db';
import { listarPoliciaisSupervisaoExtra } from '$lib/gise/supervisao-extra';

type Presencas = Awaited<ReturnType<typeof buscarPresencasGise>>;

/**
 * Monta a lista de assinantes das PRESENÇAS (entrada/saída de cada participante)
 * para a folha de auditoria (manifesto) do Relatório Extraordinário — cada rubrica
 * vira um cartão no manifesto, classificado como QUALIFICADA (Token A3 / termo em
 * `gise_presenca_termos`) ou AVANÇADA (tela/mobile).
 *
 * Fonte ÚNICA usada pelos DOIS fluxos de assinatura do supervisor: token A3
 * (`preparar-assinatura`) e tela/mobile (`assinar`). Antes, só o token montava
 * este array; o fluxo mobile passava apenas o supervisor ao manifesto, de modo
 * que o relatório assinado no celular perdia todas as rubricas de presença.
 * O caller acrescenta a assinatura do próprio supervisor ao final.
 */
export async function montarSignersPresencaExtra(opts: {
	db: Database;
	gise: GiseDetalhado;
	giseId: number;
	secIdNum: number;
	isSupervisaoExtra: boolean;
	platform: App.Platform | undefined;
	/** Presenças já carregadas pelo caller — evita refetch no mesmo request. */
	presencas: Presencas;
	documentHash: string;
	/** `url.origin` para montar os links de validação (`/validar/<hash>`). */
	origin: string;
	documentName: string;
}): Promise<AuditTrailOptions[]> {
	const {
		db,
		gise,
		giseId,
		secIdNum,
		isSupervisaoExtra,
		platform,
		presencas,
		documentHash,
		origin,
		documentName
	} = opts;

	const membrosSec = isSupervisaoExtra
		? listarPoliciaisSupervisaoExtra(gise).map((r) => ({ policial_id: r.policial_id }))
		: await buscarGiseSeccionalMembros(db, giseId, secIdNum, platform?.env);
	const idsMembros = new Set(membrosSec.map((m) => m.policial_id));
	const presencasFiltradas = presencas.filter((p) => idsMembros.has(p.policial_id));

	const r2 = tryGetR2(platform as App.Platform | undefined);

	// Selfies do R2 em paralelo (só das presenças avançadas com rubrica).
	const selfieKeys: Array<{ key: string; type: 'entrada' | 'saida'; prId: number }> = [];
	for (const pr of presencasFiltradas) {
		if (pr.entrada_rubrica && pr.entrada_selfie_key && r2) {
			selfieKeys.push({ key: pr.entrada_selfie_key, type: 'entrada', prId: pr.id });
		}
		if (pr.saida_rubrica && pr.saida_selfie_key && r2) {
			selfieKeys.push({ key: pr.saida_selfie_key, type: 'saida', prId: pr.id });
		}
	}
	const selfieResults = await Promise.all(
		selfieKeys.map(async ({ key, type, prId }) => {
			try {
				const obj = await r2!.get(key);
				if (obj) {
					const buf = await obj.arrayBuffer();
					return {
						prId,
						type,
						data: `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}` as
							string | undefined
					};
				}
			} catch {
				// objeto opcional (selfie ausente/ilegível) — segue sem ela
			}
			return { prId, type, data: undefined as string | undefined };
		})
	);
	const selfieMap = new Map<string, string | undefined>();
	for (const r of selfieResults) selfieMap.set(`${r.prId}-${r.type}`, r.data);

	// Presenças confirmadas por Token A3 (desktop) têm termo qualificado em
	// `gise_presenca_termos` — cruzamos por (policial, tipo) para classificar.
	const termosPresenca = await buscarTermosPresencaGise(db, giseId);

	const signers: AuditTrailOptions[] = [];
	const adicionarPresenca = (
		pr: (typeof presencasFiltradas)[number],
		tipo: 'entrada' | 'saida'
	) => {
		const rubricaPresenca = tipo === 'entrada' ? pr.entrada_rubrica : pr.saida_rubrica;
		if (!rubricaPresenca) return;

		const termo = termosPresenca.get(`${pr.policial_id}-${tipo}`);
		const qualificada = !!termo;
		const sufixo = tipo === 'entrada' ? 'E' : 'S';
		const ts = tipo === 'entrada' ? pr.entrada_timestamp : pr.saida_timestamp;
		// entrada/saida_timestamp são UTC real (ISO Z); o manifesto formata em
		// America/Sao_Paulo. Fallback para new Date() se ausente.
		const signingTime = ts ? new Date(ts) : new Date();
		// Quando qualificada, o hash de verificação é o do PRÓPRIO termo assinado;
		// senão, o pseudo-hash da presença.
		const vHash =
			qualificada && termo!.verification_hash
				? termo!.verification_hash
				: `PRES-${pr.id}-${sufixo}`;

		signers.push({
			signerName: `${pr.policial_nome} (${tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA'})`,
			signerCpf: pr.policial_cpf ?? undefined,
			signingTime,
			verificationHash: vHash,
			verificationUrl: `${origin}/validar/${vHash}`,
			ip: pr.ip_address ?? undefined,
			userAgent: pr.user_agent ?? undefined,
			latitude: pr.latitude ?? undefined,
			longitude: pr.longitude ?? undefined,
			// Qualificada (Token A3): a prova é o termo/certificado — sem rubrica/selfie.
			rubricBase64: qualificada ? undefined : (rubricaPresenca ?? undefined),
			selfieBase64: qualificada ? undefined : selfieMap.get(`${pr.id}-${tipo}`),
			signatureLevel: qualificada ? 'qualificada' : 'avancada',
			tipoCarimoTempo: qualificada
				? ((termo!.tipo_carimbo_tempo ?? 'servidor') as AuditTrailOptions['tipoCarimoTempo'])
				: undefined,
			documentName,
			documentHash
		});
	};

	for (const pr of presencasFiltradas) {
		adicionarPresenca(pr, 'entrada');
		adicionarPresenca(pr, 'saida');
	}

	return signers;
}
