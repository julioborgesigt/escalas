import { json, type RequestHandler } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { upsertPolicial } from '$lib/db/policiais';
import { eq } from 'drizzle-orm';
import { unidades } from '$lib/server/schema';
import { validarWebhookSync } from '$lib/server/webhook-auth';
import { logger } from '$lib/server/logger';

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
	const SYNC_TOKEN = (platform?.env as Env | undefined)?.SYNC_TOKEN;
	const rawBody = await request.text();
	const auth = await validarWebhookSync(SYNC_TOKEN, request, rawBody);
	if (!auth.ok) {
		logger.warn('[sync-policiais] auth rejeitada', {
			ip: getClientAddress(),
			reason: auth.reason
		});
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	try {
		const payload = JSON.parse(rawBody);
		const db = getDB(platform);

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
				const papelLower = item.papel?.toLowerCase() || '';
				if (papelLower.includes('seccional')) papelMap = 'admin_seccional';
				else if (papelLower.includes('unidade')) papelMap = 'admin_unidade';

				// Regra de negócio do sync da planilha:
				// unidade de exercício do papel deve ser a mesma lotação do servidor.
				const lotacaoMap = String(item.lotacao || '').trim();
				const papelUnidadeNome = String(item.papel_unidade || lotacaoMap).trim();
				let papelUnidadeId: number | null = null;
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
		return json(
			{
				error: 'Erro crítico no processamento',
				details: err instanceof Error ? err.message : String(err)
			},
			{ status: 400 }
		);
	}
};
