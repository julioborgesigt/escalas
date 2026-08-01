/**
 * `load` do PAINEL DE COMPLIANCE (`/painel`) — apura quais unidades deviam ter
 * escala num período e não têm.
 *
 * A apuração parte do UNIVERSO DE UNIDADES, não da lista de escalas: o dado
 * que interessa é a AUSÊNCIA, e ela só aparece cruzando o que existe com o que
 * era exigível. Cada unidade contribui com uma linha por regime que ela aceita
 * (`tem_plantao`, `tem_expediente`, `tem_fds`).
 *
 * O período aceita as quatro combinações de mês/ano — inclusive "todos os meses
 * de um ano" e "o mesmo mês em vários anos" —, e é isso que explica a lista de
 * `periodos` montada antes da consulta: uma só ida ao banco cobre o intervalo
 * inteiro, em vez de uma consulta por mês.
 *
 * O resultado é devolvido como PROMISE, sem `await`: o SvelteKit faz streaming,
 * a tela pinta os filtros de imediato e o relatório preenche quando resolve.
 * Quem consome está em `+page.svelte`.
 */
import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getDB, listarUnidades, registrarAuditComContexto, contextoDeEvento } from '$lib/db';
import { excluirEscalaCompleta } from '$lib/server/escalas/escala-exclusao';
import type { Database } from '$lib/db';
import { getNowBR, MESES_PT, isoData, diasNoMes } from '$lib/utils/datas';
import type { ItemCompliance } from '$lib/types';
import { and, gte, lte, inArray } from 'drizzle-orm';
import { escalas as escTable, escalaDocumentos as docTable } from '$lib/server/schema';
import type { Unidade } from '$lib/server/schema';

// Re-exportar interface do compliance
// Importar a lógica de compliance existente.
// `listaUnidades` vem do load (já buscado para os filtros da UI) — antes a
// função refazia o mesmo SELECT em unidades, duplicando o round-trip ao D1.
async function gerarCompliance(
	db: Database,
	ano: number,
	mes: number,
	listaUnidades: Unidade[]
): Promise<ItemCompliance[]> {
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
					inicio: isoData(sab.getFullYear(), sab.getMonth() + 1, sab.getDate()),
					fim: isoData(dom.getFullYear(), dom.getMonth() + 1, dom.getDate()),
					label: `FDS ${String(sab.getDate()).padStart(2, '0')}/${String(sab.getMonth() + 1).padStart(2, '0')}–${String(dom.getDate()).padStart(2, '0')}/${String(dom.getMonth() + 1).padStart(2, '0')}`
				});
			}
		}
		return list;
	}

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
		const start = isoData(p.ano, p.mes, 1);
		const end = isoData(p.ano, p.mes, diasNoMes(p.ano, p.mes));
		if (start < minDate) minDate = start;
		if (end > maxDate) maxDate = end;
	}

	const escalasPeriodo = await db
		.select()
		.from(escTable)
		.where(and(gte(escTable.data_inicio, minDate), lte(escTable.data_inicio, maxDate)))
		.all();

	const escalaIds = escalasPeriodo.map((e) => e.id);
	const docs =
		escalaIds.length > 0
			? await db.select().from(docTable).where(inArray(docTable.escala_id, escalaIds)).all()
			: [];

	const docSet = new Set(docs.map((d) => d.escala_id));
	const result: ItemCompliance[] = [];

	for (const p of periodos) {
		const inicioMes = isoData(p.ano, p.mes, 1);
		const fimMes = isoData(p.ano, p.mes, diasNoMes(p.ano, p.mes));
		const fdsList = obterFdsDoMes(p.ano, p.mes);

		for (const unidade of listaUnidades) {
			if (!unidade.tem_plantao && !unidade.tem_expediente && !unidade.tem_fds) continue;

			if (unidade.tem_plantao) {
				const esc = escalasPeriodo.find(
					(e) =>
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
					(e) =>
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
						(e) => e.lotacao === unidade.nome && e.tipo === 'fds' && e.data_inicio === fds.inicio
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

export const load: PageServerLoad = async ({ locals, platform, url, depends }) => {
	// Chave de invalidação segmentada — também conserta o recarregar() da página:
	// `invalidate(pathname)` exige match exato de URL (incluindo query), então
	// com filtros ?ano=&mes= na URL ele silenciosamente não invalidava nada.
	depends('app:painel');

	const u = locals.usuario;
	if (!u) redirect(302, '/login');
	if (u.tipo !== 'admin') redirect(302, '/');

	const db = getDB(platform);

	const hoje = getNowBR();
	const anoCorrente = hoje.getFullYear();
	const mesCorrente = hoje.getMonth() + 1;

	const qAno = url.searchParams.get('ano');
	const qMes = url.searchParams.get('mes');

	const ano = qAno === 'todos' ? 0 : qAno !== null ? Number(qAno) : anoCorrente;
	const mes = qMes === 'todos' ? 0 : qMes !== null ? Number(qMes) : mesCorrente;

	const unidadesLista = await listarUnidades(db);

	return {
		// STREAMED (promise não aguardada): o shell do painel (filtros, cards)
		// renderiza imediatamente; o relatório chega quando a computação
		// períodos × unidades terminar e a página mostra skeleton até lá.
		compliance: gerarCompliance(db, ano, mes, unidadesLista),
		unidades: unidadesLista,
		filtroAno: qAno !== null ? qAno : String(anoCorrente),
		filtroMes: qMes !== null ? qMes : String(mesCorrente)
	};
};

export const actions: Actions = {
	excluirEscala: async (event) => {
		const { request, locals, platform } = event;
		const u = locals.usuario;
		if (u?.tipo !== 'admin') return fail(403, { error: 'Não autorizado' });

		const data = await request.formData();
		const escalaId = Number(data.get('escala_id'));
		if (isNaN(escalaId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		// A UI só oferece exclusão para escalas não assinadas, mas o servidor não
		// pode confiar nisso: o helper limpa R2 + documento antes do DELETE — sem
		// ele, excluir uma escala assinada deixava blob/conferência/selfie órfãos
		// no R2 (auditoria 2026-07-16, achado B-3).
		await excluirEscalaCompleta(db, platform, escalaId);

		const { contexto, env } = contextoDeEvento(event);
		await registrarAuditComContexto(db, {
			usuario: u,
			acao: 'excluir_escala',
			entidade: 'escala',
			entidade_id: escalaId,
			alvo_tipo: 'escala',
			alvo_id: escalaId,
			detalhes: `Escala excluída do painel de compliance: ID ${escalaId}`,
			...contexto,
			env
		});

		return { success: true };
	}
};
