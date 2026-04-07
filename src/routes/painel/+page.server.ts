import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	listarUnidades,
	excluirEscala,
	registrarAuditComContexto
} from '$lib/db';

// Re-exportar interface do compliance
export interface ItemCompliance {
	unidade_nome: string;
	tipo_regime: 'plantao' | 'expediente' | 'fds';
	periodo: string;
	data_inicio: string;
	data_fim: string;
	status: 'ok' | 'nao_assinada' | 'nao_criada';
	escala_id?: number;
}

// Importar a lógica de compliance existente
async function gerarCompliance(db: any, todos = false): Promise<ItemCompliance[]> {
	const { unidades: unTable, escalas: escTable, escalaDocumentos: docTable } = await import('$lib/server/schema');
	const { getNowBR } = await import('$lib/utils');
	const { and, eq, gte, lte, inArray, sql } = await import('drizzle-orm');

	function toISO(y: number, m: number, d: number): string {
		return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
	}
	function diasNoMes(y: number, m: number): number { return new Date(y, m, 0).getDate(); }
	const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
	function fdsAtualSemana(hoje: Date) {
		const dow = hoje.getDay();
		const offset = dow === 0 ? -1 : 6 - dow;
		const sab = new Date(hoje); sab.setDate(hoje.getDate() + offset);
		const dom = new Date(sab); dom.setDate(sab.getDate() + 1);
		return {
			inicio: toISO(sab.getFullYear(), sab.getMonth() + 1, sab.getDate()),
			fim: toISO(dom.getFullYear(), dom.getMonth() + 1, dom.getDate()),
			label: `FDS ${String(sab.getDate()).padStart(2, '0')}/${String(sab.getMonth() + 1).padStart(2, '0')}–${String(dom.getDate()).padStart(2, '0')}/${String(dom.getMonth() + 1).padStart(2, '0')}`
		};
	}

	const listaUnidades = await db.select().from(unTable).all();
	if (listaUnidades.length === 0) return [];

	const hoje = getNowBR();
	const anoAtual = hoje.getFullYear();
	const mesAtual = hoje.getMonth() + 1;
	const diasAtual = diasNoMes(anoAtual, mesAtual);
	const inicioMes = toISO(anoAtual, mesAtual, 1);
	const fimMes = toISO(anoAtual, mesAtual, diasAtual);

	const fds = fdsAtualSemana(hoje);

	// Buscar escalas do mês (ou todas)
	const escalasMes = await db.select().from(escTable)
		.where(todos ? undefined : gte(escTable.data_inicio, inicioMes))
		.all();

	const escalaIds = escalasMes.map((e: any) => e.id);
	const docs = escalaIds.length > 0
		? await db.select().from(docTable).where(inArray(docTable.escala_id, escalaIds)).all()
		: [];

	const docSet = new Set(docs.map((d: any) => d.escala_id));

	const result: ItemCompliance[] = [];

	for (const unidade of listaUnidades) {
		if (!unidade.tem_plantao && !unidade.tem_expediente && !unidade.tem_fds) continue;

		if (unidade.tem_plantao) {
			const esc = escalasMes.find((e: any) => e.lotacao === unidade.nome && e.tipo === 'plantao');
			if (esc) {
				result.push({
					unidade_nome: unidade.nome,
					tipo_regime: 'plantao',
					periodo: `${MESES_PT[mesAtual - 1]} ${anoAtual}`,
					data_inicio: esc.data_inicio,
					data_fim: esc.data_fim,
					status: docSet.has(esc.id) ? 'ok' : 'nao_assinada',
					escala_id: esc.id
				});
			} else {
				result.push({
					unidade_nome: unidade.nome,
					tipo_regime: 'plantao',
					periodo: `${MESES_PT[mesAtual - 1]} ${anoAtual}`,
					data_inicio: inicioMes,
					data_fim: fimMes,
					status: 'nao_criada'
				});
			}
		}

		if (unidade.tem_expediente) {
			const esc = escalasMes.find((e: any) => e.lotacao === unidade.nome && e.tipo === 'expediente');
			if (esc) {
				result.push({
					unidade_nome: unidade.nome,
					tipo_regime: 'expediente',
					periodo: `${MESES_PT[mesAtual - 1]} ${anoAtual}`,
					data_inicio: esc.data_inicio,
					data_fim: esc.data_fim,
					status: docSet.has(esc.id) ? 'ok' : 'nao_assinada',
					escala_id: esc.id
				});
			} else {
				result.push({
					unidade_nome: unidade.nome,
					tipo_regime: 'expediente',
					periodo: `${MESES_PT[mesAtual - 1]} ${anoAtual}`,
					data_inicio: inicioMes,
					data_fim: fimMes,
					status: 'nao_criada'
				});
			}
		}

		if (unidade.tem_fds) {
			const esc = escalasMes.find((e: any) => e.lotacao === unidade.nome && e.tipo === 'fds' && e.data_inicio === fds.inicio);
			if (esc) {
				result.push({
					unidade_nome: unidade.nome,
					tipo_regime: 'fds',
					periodo: fds.label,
					data_inicio: esc.data_inicio,
					data_fim: esc.data_fim,
					status: docSet.has(esc.id) ? 'ok' : 'nao_assinada',
					escala_id: esc.id
				});
			} else {
				result.push({
					unidade_nome: unidade.nome,
					tipo_regime: 'fds',
					periodo: fds.label,
					data_inicio: fds.inicio,
					data_fim: fds.fim,
					status: 'nao_criada'
				});
			}
		}
	}

	return result;
}

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');
	if (u.tipo !== 'admin') throw redirect(302, '/');

	const db = getDB(platform);
	const todos = url.searchParams.get('todos') === 'true';

	const [compliance, unidadesLista] = await Promise.all([
		gerarCompliance(db, todos),
		listarUnidades(db)
	]);

	return {
		compliance,
		unidades: unidadesLista,
		todos
	};
};

export const actions: Actions = {
	excluirEscala: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (u?.tipo !== 'admin') return fail(403, { error: 'Não autorizado' });

		const data = await request.formData();
		const escalaId = Number(data.get('escala_id'));
		if (isNaN(escalaId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		await excluirEscala(db, escalaId);

		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'excluir_escala',
			entidade: 'escala',
			entidade_id: escalaId,
			detalhes: `Escala excluída do painel de compliance: ID ${escalaId}`
		});

		return { success: true };
	}
};
