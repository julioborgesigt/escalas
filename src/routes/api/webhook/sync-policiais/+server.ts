import { json, type RequestHandler } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { upsertPolicial } from '$lib/db/policiais';

export const POST: RequestHandler = async ({ request, platform }) => {
	const authHeader = request.headers.get('Authorization');
	const SYNC_TOKEN = (platform?.env as any)?.SYNC_TOKEN;

	// Validação de segurança básica: Bearer Token
	if (!SYNC_TOKEN || authHeader !== `Bearer ${SYNC_TOKEN}`) {
		return json({ error: 'Não autorizado' }, { status: 401 });
	}

	try {
		const payload = await request.json();
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

				await upsertPolicial(db, {
					matricula: String(item.matricula).trim(),
					nome: String(item.nome).trim(),
					cargo: cargo as 'DPC' | 'OIP',
					telefone: telefoneMap,
					cpf: String(item.cpf || '').trim(),
					classe: String(item.classe || '').trim(),
					lotacao: String(item.lotacao || '').trim(),
					ativo: statusMap,
					email: String(item.email || '').toLowerCase().trim(),
					regime: regimeMap,
					papel: papelMap
				});
				successCount++;
			} catch (err: any) {
				errors.push(`${rowId}: ${err.message}`);
			}
		}

		return json({
			success: errors.length === 0,
			processed: data.length,
			imported: successCount,
			failed: errors.length,
			errorDetails: errors.length > 0 ? errors : undefined
		});
	} catch (err: any) {
		return json({ error: 'Erro crítico no processamento', details: err.message }, { status: 400 });
	}
};
