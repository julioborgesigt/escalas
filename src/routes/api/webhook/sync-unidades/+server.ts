import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, auditar, contextoDeEvento } from '$lib/db';
import { upsertUnidade, buscarUnidadePorNome } from '$lib/db/unidades';
import {
	validarWebhookSync,
	validarReplayProtection,
	replayEnforceLigado,
	logFaltaReplayHeaders
} from '$lib/server/webhook-auth';
import { logger } from '$lib/server/logger';
import { apiError, ErrorCode, unauthorized } from '$lib/server/api';

/**
 * POST /api/webhook/sync-unidades — espelha a estrutura organizacional vinda da
 * planilha institucional (Google Apps Script; ver `scripts/README.md`).
 *
 * Contrato com sistema externo, então tudo aqui é defensivo:
 *
 * - autenticação por Bearer (`SYNC_TOKEN`) + HMAC do corpo cru, e proteção de
 *   replay por nonce — o `rawBody` é lido ANTES de qualquer parse porque a
 *   assinatura cobre os bytes exatos;
 * - a planilha manda a hierarquia achatada, uma linha por unidade, e a coluna
 *   `nivel` é recente: as linhas sem ela caem na heurística legada (coluna A
 *   vazia = seccional raiz; A e B preenchidas = delegacia);
 * - linhas incompletas são PULADAS, não rejeitadas: uma célula em branco na
 *   planilha não pode derrubar a sincronização inteira;
 * - a gravação é upsert por nome (`upsertUnidade`), que preserva os regimes
 *   configurados na tela — a planilha não conhece plantão/expediente/FDS.
 *
 * Os quatro níveis são processados em ordem (departamento → sub → seccional →
 * delegacia) porque cada um referencia o anterior como pai.
 */
type SyncNivel = 'DEPARTAMENTO' | 'SUB_DEPARTAMENTO' | 'SECCIONAL' | 'DELEGACIA';

/** Lê a coluna `nivel` (aceita maiúsculas/minúsculas); `null` = linha legada. */
function parseNivel(item: Record<string, unknown>): SyncNivel | null {
	const raw = String(item.nivel ?? item.NIVEL ?? '')
		.trim()
		.toUpperCase();
	if (
		raw === 'DEPARTAMENTO' ||
		raw === 'SUB_DEPARTAMENTO' ||
		raw === 'SECCIONAL' ||
		raw === 'DELEGACIA'
	) {
		return raw;
	}
	return null;
}

function trimCol(item: Record<string, unknown>, key: string): string {
	return String(item[key] ?? '').trim();
}

export const POST: RequestHandler = async (event) => {
	const { request, platform, getClientAddress } = event;
	const env = platform?.env as Env | undefined;
	const SYNC_TOKEN = env?.SYNC_TOKEN;
	const rawBody = await request.text();
	const auth = await validarWebhookSync(SYNC_TOKEN, request, rawBody);
	if (!auth.ok) {
		logger.warn('[sync-unidades] auth rejeitada', {
			ip: getClientAddress(),
			reason: auth.reason
		});
		return unauthorized();
	}

	// Replay protection (P1.3): mesmo padrão dos demais webhooks.
	const replay = await validarReplayProtection(getDB(platform), request);
	if (!replay.ok) {
		const ctx = { ip: getClientAddress(), reason: replay.reason };
		if (replay.reason === 'missing-headers' && !replayEnforceLigado(env)) {
			logFaltaReplayHeaders('sync-unidades', ctx, import.meta.env.PROD);
		} else {
			logger.warn('[sync-unidades] replay protection rejeitou', ctx);
			return unauthorized();
		}
	}

	try {
		const payload = JSON.parse(rawBody);
		const db = getDB(platform);

		const data = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];

		const departamentos: Record<string, unknown>[] = [];
		const subDepartamentos: Record<string, unknown>[] = [];
		const seccionais: Record<string, unknown>[] = [];
		const delegacias: Record<string, unknown>[] = [];

		// Separa por nível antes de gravar: a ordem de inserção importa (o pai
		// precisa existir para a filha referenciá-lo).
		for (const item of data) {
			const nivel = parseNivel(item);
			const colUnidade = trimCol(item, 'unidade');
			const colSeccional = trimCol(item, 'seccional');

			if (nivel === 'DEPARTAMENTO') {
				if (!colSeccional) continue;
				departamentos.push(item);
				continue;
			}
			if (nivel === 'SUB_DEPARTAMENTO') {
				if (!colUnidade || !colSeccional) continue;
				subDepartamentos.push(item);
				continue;
			}
			if (nivel === 'SECCIONAL') {
				if (!colSeccional) continue;
				// Raiz: A vazio, B = nome da seccional (igual ao legado)
				if (!colUnidade) {
					seccionais.push({ ...item, __legacyRaiz: true });
				} else {
					seccionais.push(item);
				}
				continue;
			}
			if (nivel === 'DELEGACIA') {
				if (!colUnidade || !colSeccional) continue;
				delegacias.push(item);
				continue;
			}

			// Legado (sem coluna nivel): A vazio + B = seccional raiz; A + B = delegacia
			if (!colUnidade && colSeccional) {
				seccionais.push({ ...item, seccional: colSeccional, unidade: '', __legacyRaiz: true });
			} else if (colUnidade && colSeccional) {
				delegacias.push(item);
			}
		}

		let successCount = 0;
		const errors: string[] = [];

		// 1) Departamentos (raiz)
		for (const item of departamentos) {
			const nome = trimCol(item, 'seccional');
			if (!nome) continue;
			try {
				await upsertUnidade(db, {
					nome,
					tipo: 'departamento',
					seccional_id: null,
					cidade: trimCol(item, 'cidade')
				});
				successCount++;
			} catch (err: unknown) {
				errors.push(`Departamento ${nome}: ${messageFromUnknown(err)}`);
			}
		}

		// 2) Subdepartamentos (pai obrigatoriamente departamento)
		for (const item of subDepartamentos) {
			const nome = trimCol(item, 'unidade');
			const nomePai = trimCol(item, 'seccional');
			if (!nome || !nomePai) continue;
			try {
				const pai = await buscarUnidadePorNome(db, nomePai);
				if (!pai || pai.tipo !== 'departamento') {
					errors.push(
						`Subdepartamento ${nome}: pai "${nomePai}" não é um departamento cadastrado.`
					);
					continue;
				}
				await upsertUnidade(db, {
					nome,
					tipo: 'sub_departamento',
					seccional_id: pai.id,
					cidade: trimCol(item, 'cidade')
				});
				successCount++;
			} catch (err: unknown) {
				errors.push(`Subdepartamento ${nome}: ${messageFromUnknown(err)}`);
			}
		}

		// 3) Seccionais (com ou sem pai organizacional)
		for (const item of seccionais) {
			const legacyRaiz = Boolean(item.__legacyRaiz);
			const nomeSec = legacyRaiz ? trimCol(item, 'seccional') : trimCol(item, 'unidade');
			const nomeOrgPai = legacyRaiz ? '' : trimCol(item, 'seccional');

			if (!nomeSec) continue;

			try {
				let parentId: number | null = null;
				if (nomeOrgPai) {
					const org = await buscarUnidadePorNome(db, nomeOrgPai);
					if (!org || (org.tipo !== 'departamento' && org.tipo !== 'sub_departamento')) {
						errors.push(
							`Seccional ${nomeSec}: organização pai "${nomeOrgPai}" não encontrada ou não é departamento/subdepartamento.`
						);
						continue;
					}
					parentId = org.id;
				}

				await upsertUnidade(db, {
					nome: nomeSec,
					tipo: 'seccional',
					seccional_id: parentId,
					cidade: trimCol(item, 'cidade')
				});
				successCount++;
			} catch (err: unknown) {
				errors.push(`Seccional ${nomeSec}: ${messageFromUnknown(err)}`);
			}
		}

		// 4) Delegacias (pai = seccional)
		for (const item of delegacias) {
			try {
				const nomeUni = trimCol(item, 'unidade');
				const nomeSec = trimCol(item, 'seccional');
				if (!nomeUni || !nomeSec) continue;

				const sec = await buscarUnidadePorNome(db, nomeSec);
				if (!sec || sec.tipo !== 'seccional') {
					errors.push(
						`Delegacia ${nomeUni}: seccional "${nomeSec}" não encontrada ou não é seccional.`
					);
					continue;
				}

				await upsertUnidade(db, {
					nome: nomeUni,
					tipo: 'delegacia',
					seccional_id: sec.id,
					cidade: trimCol(item, 'cidade')
				});
				successCount++;
			} catch (err: unknown) {
				errors.push(`Delegacia ${trimCol(item, 'unidade')}: ${messageFromUnknown(err)}`);
			}
		}

		const { contexto, env: cryptoEnv } = contextoDeEvento(event);
		await auditar(
			db,
			{
				acao: 'sync_unidades',
				usuario: null,
				actor_tipo: 'webhook',
				entidade: 'unidade',
				resultado: errors.length === 0 ? 'sucesso' : 'falha',
				detalhes: `Sync de unidades: ${successCount}/${data.length} importadas, ${errors.length} falha(s)`,
				metadados: { processed: data.length, imported: successCount, failed: errors.length },
				...contexto
			},
			{ env: cryptoEnv }
		);

		return json({
			success: true,
			processed: data.length,
			imported: successCount,
			errors: errors.length > 0 ? errors : undefined
		});
	} catch (err: unknown) {
		// 400 (não 500): payload do webhook é input do caller, não bug interno.
		return apiError(
			`Erro ao processar payload: ${messageFromUnknown(err)}`,
			400,
			ErrorCode.VALIDATION
		);
	}
};

function messageFromUnknown(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
