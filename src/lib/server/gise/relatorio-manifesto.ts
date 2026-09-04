/**
 * O manifesto de auditoria do Relatório Extraordinário — a lista de quem
 * assinou o quê, montada uma vez para os dois fluxos.
 *
 * Existe como módulo próprio porque a mesma folha é anexada por caminhos
 * diferentes: o supervisor que assina por Token A3 (`preparar-assinatura`) e o
 * que assina em tela (`assinar`). Enquanto cada rota montava a sua lista, uma
 * delas incluía as presenças e a outra não — o mesmo documento saía com dois
 * conteúdos dependendo de como foi assinado, o que é exatamente o que um
 * manifesto de auditoria não pode fazer.
 *
 * A classificação por modalidade (QUALIFICADA quando há termo em
 * `gise_presenca_termos`, AVANÇADA quando a confirmação foi em tela) vive aqui
 * pelo mesmo motivo: é a informação que dá valor probatório a cada cartão, e
 * duplicá-la faria as duas cópias divergirem na primeira mudança de regra.
 */
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
 * para a folha de auditoria (manifesto) do Relatório Extraordinário — cada
 * confirmação vira um cartão no manifesto, classificada como QUALIFICADA
 * (Token A3 / termo em `gise_presenca_termos`) ou AVANÇADA (tela/mobile).
 *
 * Fonte ÚNICA usada pelos DOIS fluxos de assinatura do supervisor: token A3
 * (`preparar-assinatura`) e tela/mobile (`assinar`). Antes, só o token montava
 * este array; o fluxo mobile passava apenas o supervisor ao manifesto, de modo
 * que o relatório assinado no celular perdia todas as confirmações de presença.
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

	// Selfies do R2 em paralelo (só das confirmações já registradas).
	const selfieKeys: Array<{ key: string; type: 'entrada' | 'saida'; prId: number }> = [];
	for (const pr of presencasFiltradas) {
		if (pr.entrada_timestamp && pr.entrada_selfie_key && r2) {
			selfieKeys.push({ key: pr.entrada_selfie_key, type: 'entrada', prId: pr.id });
		}
		if (pr.saida_timestamp && pr.saida_selfie_key && r2) {
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

	// Presenças que geraram TERMO (Token A3 ou passkey) estão em
	// `gise_presenca_termos` — cruzamos por (policial, tipo). Existir termo diz
	// que há documento em `/validar`; QUEM assinou é outra pergunta, respondida
	// pelo `cms_sha256` abaixo.
	const termosPresenca = await buscarTermosPresencaGise(db, giseId);

	const signers: AuditTrailOptions[] = [];
	const adicionarPresenca = (
		pr: (typeof presencasFiltradas)[number],
		tipo: 'entrada' | 'saida'
	) => {
		// O carimbo de tempo é o que diz que a confirmação existe: sem ele não há
		// ato a manifestar. Era `entrada_rubrica`/`saida_rubrica` que fazia esse
		// papel, e as duas colunas saíram junto com a rubrica.
		const ts = tipo === 'entrada' ? pr.entrada_timestamp : pr.saida_timestamp;
		if (!ts) return;

		const termo = termosPresenca.get(`${pr.policial_id}-${tipo}`);
		// QUALIFICADA exige CMS de certificado do titular (Token A3). Era
		// `!!termo`, e isso rotulava "QUALIFICADA · ICP-BRASIL" toda presença
		// por PASSKEY — que também grava em `gise_presenca_termos`, sem
		// certificado nenhum. O documento passava a afirmar ICP-Brasil onde não
		// há ICP-Brasil, com a flag `exigir_passkey_assinatura` ligada.
		const qualificada = !!termo?.cms_sha256;
		const sufixo = tipo === 'entrada' ? 'E' : 'S';
		// entrada/saida_timestamp são UTC real (ISO Z); o manifesto formata em
		// America/Sao_Paulo.
		const signingTime = new Date(ts);
		// Havendo termo (A3 ou passkey), o identificador é o do PRÓPRIO termo —
		// esse resolve em `/validar`. Sem termo (um-tiro), sobra o pseudo-hash da
		// presença, que NÃO resolve: daí o `identificadorValidavel` abaixo.
		const vHash = termo?.verification_hash ?? `PRES-${pr.id}-${sufixo}`;
		const identificadorValidavel = !!termo?.verification_hash;

		signers.push({
			signerName: `${pr.policial_nome} (${tipo === 'entrada' ? 'ENTRADA' : 'SAÍDA'})`,
			signerCpf: pr.policial_cpf ?? undefined,
			signingTime,
			verificationHash: vHash,
			verificationUrl: `${origin}/validar/${vHash}`,
			identificadorValidavel,
			ip: pr.ip_address ?? undefined,
			userAgent: pr.user_agent ?? undefined,
			latitude: pr.latitude ?? undefined,
			longitude: pr.longitude ?? undefined,
			// Qualificada (Token A3): a prova é o termo/certificado — sem selfie.
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
