import { json } from '@sveltejs/kit';
import { getDB } from '$lib/db';
import { unidades, escalas, escalaDocumentos } from '$lib/server/schema';
import { and, eq, gte, lte, inArray, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export interface ItemCompliance {
	unidade_nome: string;
	tipo_regime: 'plantao' | 'expediente' | 'fds';
	periodo: string;
	data_inicio: string;
	data_fim: string;
	status: 'ok' | 'nao_assinada' | 'nao_criada';
	escala_id?: number;
}

function toISO(y: number, m: number, d: number): string {
	return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function diasNoMes(y: number, m: number): number {
	return new Date(y, m, 0).getDate();
}

const MESES_PT = [
	'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
	'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

/** Retorna o FDS (Sáb–Dom) da semana corrente */
function fdsAtualSemana(hoje: Date): { inicio: string; fim: string; label: string } {
	const dayOfWeek = hoje.getDay(); // 0=Dom, 6=Sáb
	// Offset para o sábado desta semana ISO (Seg–Dom)
	const offsetToSat = dayOfWeek === 0 ? -1 : 6 - dayOfWeek;

	const sabado = new Date(hoje);
	sabado.setDate(hoje.getDate() + offsetToSat);
	const domingo = new Date(sabado);
	domingo.setDate(sabado.getDate() + 1);

	const anoS = sabado.getFullYear();
	const mesS = sabado.getMonth() + 1;
	const diaS = sabado.getDate();
	const anoD = domingo.getFullYear();
	const mesD = domingo.getMonth() + 1;
	const diaD = domingo.getDate();

	return {
		inicio: toISO(anoS, mesS, diaS),
		fim: toISO(anoD, mesD, diaD),
		label: `FDS ${String(diaS).padStart(2, '0')}/${String(mesS).padStart(2, '0')}–${String(diaD).padStart(2, '0')}/${String(mesD).padStart(2, '0')}`
	};
}

export const GET: RequestHandler = async ({ platform, locals, url }) => {
	if (locals.usuario?.tipo !== 'admin') {
		return json({ error: 'Acesso restrito' }, { status: 403 });
	}

	const db = getDB(platform);
	const hoje = new Date();
	const diaHoje = hoje.getDate();
	const mesHoje = hoje.getMonth() + 1; // 1-12
	const anoHoje = hoje.getFullYear();

	const showAll = url.searchParams.get('todos') === '1';

	// ── Mês relevante (apenas 1): próximo se dia >= 20, atual se dia < 20 ──
	const mesRelAno = diaHoje >= 20
		? (mesHoje === 12 ? anoHoje + 1 : anoHoje)
		: anoHoje;
	const mesRelMes = diaHoje >= 20
		? (mesHoje === 12 ? 1 : mesHoje + 1)
		: mesHoje;

	let inicioMesRel = toISO(mesRelAno, mesRelMes, 1);
	let fimMesRel = toISO(mesRelAno, mesRelMes, diasNoMes(mesRelAno, mesRelMes));

	if (showAll) {
		const inicioDate = new Date(hoje);
		inicioDate.setMonth(hoje.getMonth() - 1);
		inicioMesRel = toISO(inicioDate.getFullYear(), inicioDate.getMonth() + 1, 1);
		
		const fimDate = new Date(hoje);
		fimDate.setMonth(hoje.getMonth() + 1);
		fimMesRel = toISO(fimDate.getFullYear(), fimDate.getMonth() + 1, diasNoMes(fimDate.getFullYear(), fimDate.getMonth() + 1));
	}

	// ── FDS: apenas semana corrente ──
	const fdsHoje = fdsAtualSemana(hoje);

	// Buscar todas as unidades com pelo menos 1 regime
	const todasUnidades = await db.select().from(unidades).all();
	const unidadesComRegime = todasUnidades.filter(
		(u) => u.tem_plantao || u.tem_expediente || u.tem_fds
	);
	if (unidadesComRegime.length === 0) return json([]);

	const rangeMin = fdsHoje.inicio < inicioMesRel ? fdsHoje.inicio : inicioMesRel;
	const rangeMax = fdsHoje.fim > fimMesRel ? fdsHoje.fim : fimMesRel;

	const nomesUnidades = unidadesComRegime.map((u) => u.nome);
	const escalasEncontradas = await db
		.select({
			id: escalas.id,
			lotacao: escalas.lotacao,
			data_inicio: escalas.data_inicio,
			tipo: escalas.tipo,
			is_assinada: sql<number>`CASE WHEN ${escalaDocumentos.id} IS NOT NULL THEN 1 ELSE 0 END`
		})
		.from(escalas)
		.leftJoin(escalaDocumentos, eq(escalas.id, escalaDocumentos.escala_id))
		.where(
			and(
				inArray(escalas.lotacao, nomesUnidades),
				gte(escalas.data_inicio, rangeMin),
				lte(escalas.data_inicio, rangeMax)
			)
		)
		.all();

	const resultado: ItemCompliance[] = [];

	for (const unidade of unidadesComRegime) {
		const escalasUnidade = escalasEncontradas.filter((e) => e.lotacao === unidade.nome);

		// ── PLANTÃO ──
		if (unidade.tem_plantao) {
			const escala = escalasUnidade.find(
				(e) => e.data_inicio >= inicioMesRel && e.data_inicio <= fimMesRel && e.tipo === 'plantao'
			);
			resultado.push({
				unidade_nome: unidade.nome,
				tipo_regime: 'plantao',
				periodo: `${MESES_PT[mesRelMes - 1]} ${mesRelAno}`,
				data_inicio: inicioMesRel,
				data_fim: fimMesRel,
				status: !escala ? 'nao_criada' : escala.is_assinada ? 'ok' : 'nao_assinada',
				escala_id: escala?.id
			});
		}

		// ── EXPEDIENTE ──
		if (unidade.tem_expediente) {
			const escala = escalasUnidade.find(
				(e) => e.data_inicio >= inicioMesRel && e.data_inicio <= fimMesRel && e.tipo === 'expediente'
			);
			resultado.push({
				unidade_nome: unidade.nome,
				tipo_regime: 'expediente',
				periodo: `${MESES_PT[mesRelMes - 1]} ${mesRelAno}`,
				data_inicio: inicioMesRel,
				data_fim: fimMesRel,
				status: !escala ? 'nao_criada' : escala.is_assinada ? 'ok' : 'nao_assinada',
				escala_id: escala?.id
			});
		}

		// ── FDS ──
		if (unidade.tem_fds) {
			const escala = escalasUnidade.find((e) => e.data_inicio === fdsHoje.inicio && e.tipo === 'fds');
			resultado.push({
				unidade_nome: unidade.nome,
				tipo_regime: 'fds',
				periodo: fdsHoje.label,
				data_inicio: fdsHoje.inicio,
				data_fim: fdsHoje.fim,
				status: !escala ? 'nao_criada' : escala.is_assinada ? 'ok' : 'nao_assinada',
				escala_id: escala?.id
			});
		}
	}

	return json(resultado);
};
