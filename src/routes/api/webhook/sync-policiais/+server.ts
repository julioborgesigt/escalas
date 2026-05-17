import { json, type RequestHandler } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { upsertPolicial, buscarPolicialPorMatricula } from '$lib/db/policiais';
import { eq } from 'drizzle-orm';
import { unidades } from '$lib/server/schema';
import {
	validarWebhookSync,
	validarReplayProtection,
	replayEnforceLigado
} from '$lib/server/webhook-auth';
import { logger } from '$lib/server/logger';
import { apiError, ErrorCode, unauthorized } from '$lib/server/api';

/**
 * Safe-default contra escalada de privilégio via webhook (M-4 da auditoria):
 * o sync NÃO altera `papel`/`papel_unidade_id` a menos que
 * `WEBHOOK_ALLOW_PAPEL_CHANGES` esteja explicitamente ligado. Sem isso,
 * SYNC_TOKEN comprometido só consegue editar dados não-privilegiados
 * (nome, matrícula, lotação, e-mail, etc.) — não consegue promover ninguém
 * a admin_seccional/admin_unidade. O caminho legítimo permanece sendo o
 * endpoint dedicado `salvarPapel` em /policiais/[id] (Admin Geral via UI).
 */
function papelChangesAllowed(env: unknown): boolean {
	if (!env || typeof env !== 'object') return false;
	const raw = (env as Record<string, unknown>).WEBHOOK_ALLOW_PAPEL_CHANGES;
	if (typeof raw !== 'string') return false;
	const v = raw.trim().toLowerCase();
	return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const env = platform?.env as Env | undefined;
	const SYNC_TOKEN = env?.SYNC_TOKEN;
	const rawBody = await request.text();
	const auth = await validarWebhookSync(SYNC_TOKEN, request, rawBody);
	if (!auth.ok) {
		logger.warn('[sync-policiais] auth rejeitada', {
			ip: getClientAddress(),
			reason: auth.reason
		});
		return unauthorized();
	}

	// Replay protection (P1.3): roda APÓS HMAC para não gastar D1 com payloads
	// não autenticados. Headers ausentes → comportamento controlado pela env
	// WEBHOOK_REPLAY_ENFORCE (rollout staged: log only → enforce).
	const replay = await validarReplayProtection(getDB(platform), request);
	if (!replay.ok) {
		const ctx = { ip: getClientAddress(), reason: replay.reason };
		if (replay.reason === 'missing-headers' && !replayEnforceLigado(env)) {
			logger.info('[sync-policiais] sem headers de replay protection — rollout', ctx);
		} else {
			logger.warn('[sync-policiais] replay protection rejeitou', ctx);
			return unauthorized();
		}
	}

	try {
		const payload = JSON.parse(rawBody);
		const db = getDB(platform);
		const papelLiberado = papelChangesAllowed(env);

		// O payload pode ser um objeto (linha única) ou um array (bulk)
		const data = Array.isArray(payload) ? payload : [payload];
		let successCount = 0;
		const errors: string[] = [];

		for (const item of data) {
			const rowId = item.matricula || item.nome || 'Linha desconhecida';
			try {
				// Validações básicas antes do banco
				if (!item.matricula || String(item.matricula).trim() === '') continue; // Pula linha vazia silenciosamente
				if (!item.nome || String(item.nome).trim() === '') continue;

				const cargo = String(item.cargo || '').toUpperCase().trim();
				if (!['DPC', 'OIP'].includes(cargo)) {
					throw new Error(`Cargo inválido: "${cargo}". Use DPC ou OIP.`);
				}

				// Normalização de telefone: Pega apenas o primeiro número se houver vários
				let telefoneMap = String(item.telefone || '').trim();
				const phoneMatch = telefoneMap.match(/\(?\d{2}\)?\s?\d{4,5}-?\d{4}/);
				if (phoneMatch) {
					telefoneMap = phoneMatch[0];
				} else if (telefoneMap.length > 15) {
					// Fallback: se não deu match mas é longo, pega os primeiros 15 caracteres
					telefoneMap = telefoneMap.substring(0, 15).trim();
				}

				// Ignorando a coluna H (status) a pedido do usuário: todos ficam ativos = 1
				const statusMap = 1;
				const regimeMap = (item.regime?.toLowerCase() === 'expediente') ? 'expediente' : 'plantao';

				let papelMap: string | null = null;
				let papelUnidadeId: number | null = null;
				const lotacaoMap = String(item.lotacao || '').trim();

				if (papelLiberado) {
					// Modo legado/explícito: planilha é canônica também para papel.
					const papelLower = item.papel?.toLowerCase() || '';
					if (papelLower.includes('seccional')) papelMap = 'admin_seccional';
					else if (papelLower.includes('unidade')) papelMap = 'admin_unidade';

					const papelUnidadeNome = String(item.papel_unidade || lotacaoMap).trim();
					if (papelMap) {
						if (!papelUnidadeNome) {
							throw new Error('Papel administrativo informado sem lotação/unidade de exercício.');
						}
						const unidade = await db
							.select({ id: unidades.id })
							.from(unidades)
							.where(eq(unidades.nome, papelUnidadeNome))
							.get();
						if (!unidade) {
							throw new Error(
								`Unidade de exercício do papel não encontrada: "${papelUnidadeNome}". ` +
								'Garanta que a lotação exista em DB_UNIDADES e esteja sincronizada.'
							);
						}
						papelUnidadeId = unidade.id;
					}
				} else {
					// Safe-default (M-4): preserva o `papel`/`papel_unidade_id` atual.
					// Se o registro existe, lê do DB; se não existe, fica null. Sem isto,
					// SYNC_TOKEN comprometido conseguia promover qualquer matrícula a admin.
					const atual = await buscarPolicialPorMatricula(db, String(item.matricula));
					if (atual) {
						papelMap = atual.papel ?? null;
						papelUnidadeId = atual.papel_unidade_id ?? null;
					}
					// Se o payload TENTOU trocar papel, registra para forense.
					const payloadTentaTrocar = (item.papel || item.papel_unidade) && (
						!atual ||
						(item.papel ?? null) !== (atual.papel ?? null) ||
						String(item.papel_unidade ?? '') !== (atual.papel_unidade_id == null ? '' : '*')
					);
					if (payloadTentaTrocar) {
						logger.warn('[sync-policiais] tentativa de alterar papel via webhook ignorada (WEBHOOK_ALLOW_PAPEL_CHANGES off)', {
							matricula: String(item.matricula),
							papelTentado: item.papel ?? null,
							papelUnidadeTentado: item.papel_unidade ?? null
						});
					}
				}

				await upsertPolicial(db, {
					matricula: String(item.matricula).trim(),
					nome: String(item.nome).trim(),
					cargo: cargo as 'DPC' | 'OIP',
					telefone: telefoneMap,
					cpf: String(item.cpf || '').trim(),
					classe: String(item.classe || '').trim(),
					lotacao: lotacaoMap,
					ativo: statusMap,
					email: String(item.email || '').toLowerCase().trim(),
					regime: regimeMap,
					papel: papelMap,
					papel_unidade_id: papelUnidadeId
				});
				successCount++;
			} catch (err: unknown) {
				errors.push(`${rowId}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		return json({
			success: errors.length === 0,
			processed: data.length,
			imported: successCount,
			failed: errors.length,
			errorDetails: errors.length > 0 ? errors : undefined
		});
	} catch (err: unknown) {
		// 400 (não 500): payload do webhook é input inválido do caller, não bug
		// interno. Preserva o behavior anterior + adiciona errorType VALIDATION.
		return apiError(
			`Erro crítico no processamento: ${err instanceof Error ? err.message : String(err)}`,
			400,
			ErrorCode.VALIDATION
		);
	}
};
