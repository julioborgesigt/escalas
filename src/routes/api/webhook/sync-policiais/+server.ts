import { json, type RequestHandler } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { upsertPolicial } from '$lib/db/policiais';
import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { unidades } from '$lib/server/schema';

function bearerTokenValido(authHeader: string | null, expectedToken: string): boolean {
	const expected = `Bearer ${expectedToken}`;
	const a = Buffer.from((authHeader ?? '').padEnd(expected.length, ' ').slice(0, expected.length));
	const b = Buffer.from(expected);
	const valueMatch = timingSafeEqual(a, b) ? 1 : 0;
	const lenMatch = (authHeader ?? '').length === expected.length ? 1 : 0;
	return (valueMatch & lenMatch) === 1;
}

async function hmacSha256Valido(secret: string, body: string, sigHeader: string | null): Promise<boolean> {
	if (!sigHeader?.startsWith('sha256=')) return false;
	const expectedHex = sigHeader.slice(7);
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
	const computedHex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
	if (computedHex.length !== expectedHex.length) return false;
	return timingSafeEqual(Buffer.from(computedHex), Buffer.from(expectedHex));
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const SYNC_TOKEN = (platform?.env as Env | undefined)?.SYNC_TOKEN;
	if (!SYNC_TOKEN) return json({ error: 'Não autorizado' }, { status: 401 });

	const rawBody = await request.text();
	const sigHeader = request.headers.get('X-Hub-Signature-256');
	const authHeader = request.headers.get('Authorization');

	const autorizado = sigHeader
		? await hmacSha256Valido(SYNC_TOKEN, rawBody, sigHeader)
		: bearerTokenValido(authHeader, SYNC_TOKEN);

	if (!autorizado) {
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
