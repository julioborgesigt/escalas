import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getDB, listarUnidades, excluirEscala, registrarAuditComContexto } from '$lib/db';
import { getNowBR } from '$lib/utils';

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
async function gerarCompliance(db: any, ano: number, mes: number): Promise<ItemCompliance[]> {
	const {
		unidades: unTable,
		escalas: escTable,
		escalaDocumentos: docTable
	} = await import('$lib/server/schema');
	const { getNowBR } = await import('$lib/utils');
	const { and, gte, lte, inArray } = await import('drizzle-orm');

	function toISO(y: number, m: number, d: number): string {
		return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
	}
	function diasNoMes(y: number, m: number): number {
		return new Date(y, m, 0).getDate();
	}
	const MESES_PT = [
		'Janeiro',
		'Fevereiro',
		'Março',
		'Abril',
		'Maio',
		'Junho',
		'Julho',
		'Agosto',
		'Setembro',
		'Outubro',
		'Novembro',
		'Dezembro'
	];

	function obterFdsDoMes(y: number, m: number) {
		const list = [];
		const days = diasNoMes(y, m);
		for (let d = 1; d <= days; d++) {
			const date = new Date(y, m - 1, d);
			if (date.getDay() === 6) {
				// Saturday
				const sab = new Date(y, m - 1, d);
				const dom = new Date(y, m - 1, d + 1);
				list.push({
					inicio: toISO(sab.getFullYear(), sab.getMonth() + 1, sab.getDate()),
					fim: toISO(dom.getFullYear(), dom.getMonth() + 1, dom.getDate()),
					label: `FDS ${String(sab.getDate()).padStart(2, '0')}/${String(sab.getMonth() + 1).padStart(2, '0')}–${String(dom.getDate()).padStart(2, '0')}/${String(dom.getMonth() + 1).padStart(2, '0')}`
				});
			}
		}
		return list;
	}

	const listaUnidades = await db.select().from(unTable).all();
	if (listaUnidades.length === 0) return [];

	const hoje = getNowBR();
	const anoAtual = hoje.getFullYear();

	// Determine which (year, month) combinations to evaluate
	const periodos: { ano: number; mes: number }[] = [];

	if (ano > 0 && mes > 0) {
		periodos.push({ ano, mes });
	} else if (ano > 0 && mes === 0) {
		for (let m = 1; m <= 12; m++) {
			periodos.push({ ano, mes: m });
		}
	} else if (ano === 0 && mes > 0) {
		const anosDisponiveis = [2024, 2025, 2026, 2027];
		for (const y of anosDisponiveis) {
			periodos.push({ ano: y, mes });
		}
	} else {
		// Both are "todos" - let's show all months of the current year
		for (let m = 1; m <= 12; m++) {
			periodos.push({ ano: anoAtual, mes: m });
		}
	}

	// Determine date range to query scales
	let minDate = '9999-12-31';
	let maxDate = '0000-01-01';
	for (const p of periodos) {
		const start = toISO(p.ano, p.mes, 1);
		const end = toISO(p.ano, p.mes, diasNoMes(p.ano, p.mes));
		if (start < minDate) minDate = start;
		if (end > maxDate) maxDate = end;
	}

	const escalasPeriodo = await db
		.select()
		.from(escTable)
		.where(and(gte(escTable.data_inicio, minDate), lte(escTable.data_inicio, maxDate)))
		.all();

	const escalaIds = escalasPeriodo.map((e: any) => e.id);
	const docs =
		escalaIds.length > 0
			? await db.select().from(docTable).where(inArray(docTable.escala_id, escalaIds)).all()
			: [];

	const docSet = new Set(docs.map((d: any) => d.escala_id));
	const result: ItemCompliance[] = [];

	for (const p of periodos) {
		const inicioMes = toISO(p.ano, p.mes, 1);
		const fimMes = toISO(p.ano, p.mes, diasNoMes(p.ano, p.mes));
		const fdsList = obterFdsDoMes(p.ano, p.mes);

		for (const unidade of listaUnidades) {
			if (!unidade.tem_plantao && !unidade.tem_expediente && !unidade.tem_fds) continue;

			if (unidade.tem_plantao) {
				const esc = escalasPeriodo.find(
					(e: any) =>
						e.lotacao === unidade.nome &&
						e.tipo === 'plantao' &&
						e.data_inicio >= inicioMes &&
						e.data_inicio <= fimMes
				);
				if (esc) {
					result.push({
						unidade_nome: unidade.nome,
						tipo_regime: 'plantao',
						periodo: `${MESES_PT[p.mes - 1]} ${p.ano}`,
						data_inicio: esc.data_inicio,
						data_fim: esc.data_fim,
						status: docSet.has(esc.id) ? 'ok' : 'nao_assinada',
						escala_id: esc.id
					});
				} else {
					result.push({
						unidade_nome: unidade.nome,
						tipo_regime: 'plantao',
						periodo: `${MESES_PT[p.mes - 1]} ${p.ano}`,
						data_inicio: inicioMes,
						data_fim: fimMes,
						status: 'nao_criada'
					});
				}
			}

			if (unidade.tem_expediente) {
				const esc = escalasPeriodo.find(
					(e: any) =>
						e.lotacao === unidade.nome &&
						e.tipo === 'expediente' &&
						e.data_inicio >= inicioMes &&
						e.data_inicio <= fimMes
				);
				if (esc) {
					result.push({
						unidade_nome: unidade.nome,
						tipo_regime: 'expediente',
						periodo: `${MESES_PT[p.mes - 1]} ${p.ano}`,
						data_inicio: esc.data_inicio,
						data_fim: esc.data_fim,
						status: docSet.has(esc.id) ? 'ok' : 'nao_assinada',
						escala_id: esc.id
					});
				} else {
					result.push({
						unidade_nome: unidade.nome,
						tipo_regime: 'expediente',
						periodo: `${MESES_PT[p.mes - 1]} ${p.ano}`,
						data_inicio: inicioMes,
						data_fim: fimMes,
						status: 'nao_criada'
					});
				}
			}

			if (unidade.tem_fds) {
				for (const fds of fdsList) {
					const esc = escalasPeriodo.find(
						(e: any) =>
							e.lotacao === unidade.nome && e.tipo === 'fds' && e.data_inicio === fds.inicio
					);
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
		}
	}

	return result;
}

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');
	if (u.tipo !== 'admin') throw redirect(302, '/');

	const db = getDB(platform);

	const hoje = getNowBR();
	const anoCorrente = hoje.getFullYear();
	const mesCorrente = hoje.getMonth() + 1;

	const qAno = url.searchParams.get('ano');
	const qMes = url.searchParams.get('mes');

	const ano = qAno === 'todos' ? 0 : qAno !== null ? Number(qAno) : anoCorrente;
	const mes = qMes === 'todos' ? 0 : qMes !== null ? Number(qMes) : mesCorrente;

	const [compliance, unidadesLista] = await Promise.all([
		gerarCompliance(db, ano, mes),
		listarUnidades(db)
	]);

	return {
		compliance,
		unidades: unidadesLista,
		filtroAno: qAno !== null ? qAno : String(anoCorrente),
		filtroMes: qMes !== null ? qMes : String(mesCorrente)
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
