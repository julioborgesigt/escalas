import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	criarEscala,
	verificarEscalaExistente,
	listarLotacoes
} from '$lib/db';
import { escalaSchema } from '$lib/schemas';
import { eq } from 'drizzle-orm';
import { unidades } from '$lib/server/schema';
import { logger } from '$lib/server/logger';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const db = getDB(platform);
	const isAdmin = u.tipo === 'admin';

	// Carrega lotações (para admin) ou unidade do policial
	const [lotacoes, unidadesComRegime] = await Promise.all([
		isAdmin ? listarLotacoes(db) : [u.lotacao!],
		u.tipo === 'policial'
			? db.select().from(unidades).where(eq(unidades.nome, u.lotacao!)).get().then((r) => (r ? [r] : []))
			: db
					.select({
						nome: unidades.nome,
						tem_plantao: unidades.tem_plantao,
						tem_expediente: unidades.tem_expediente,
						tem_fds: unidades.tem_fds,
						cidade: unidades.cidade
					})
					.from(unidades)
					.all()
	]);

	return {
		lotacoes,
		unidadesComRegime,
		isAdmin,
		lotacaoUsuario: u.lotacao
	};
};

export const actions: Actions = {
	criar: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const data = await request.formData();
		const titulo = data.get('titulo')?.toString() || '';
		const cidade = data.get('cidade')?.toString() || '';
		const data_inicio = data.get('data_inicio')?.toString() || '';
		const data_fim = data.get('data_fim')?.toString() || '';
		const hora_entrada = data.get('hora_entrada')?.toString() || '08';
		const hora_saida = data.get('hora_saida')?.toString() || '08';
		const lotacao = data.get('lotacao')?.toString() || '';
		const tipo = data.get('tipo')?.toString() as 'plantao' | 'expediente' | 'fds' | '';

		const parsed = escalaSchema.safeParse({
			titulo,
			cidade,
			data_inicio,
			data_fim,
			horario: `${hora_entrada}H A ${hora_saida}H`,
			hora_entrada,
			hora_saida,
			lotacao: u.tipo === 'policial' ? u.lotacao : lotacao,
			tipo: tipo || undefined
		});

		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0].message,
				fields: { titulo, cidade, data_inicio, data_fim, lotacao, tipo, hora_entrada, hora_saida }
			});
		}

		const validated = parsed.data;
		const db = getDB(platform);

		// Valida unicidade
		if (validated.tipo && validated.lotacao) {
			const existente = await verificarEscalaExistente(
				db,
				validated.lotacao,
				validated.tipo as 'plantao' | 'expediente' | 'fds',
				validated.data_inicio,
				validated.data_fim
			);
			if (existente) {
				const periodo = validated.tipo === 'fds' ? 'nesta semana' : 'neste mês';
				const tipoLabel =
					validated.tipo === 'plantao'
						? 'Plantão'
						: validated.tipo === 'expediente'
							? 'Expediente'
							: 'Final de Semana';
				return fail(409, {
					error: `Já existe uma Escala de ${tipoLabel} para ${validated.lotacao} ${periodo}.`,
					fields: { titulo, cidade, data_inicio, data_fim, lotacao, tipo }
				});
			}
		}

		try {
			const result = await criarEscala(db, {
				titulo: validated.titulo,
				cidade: validated.cidade,
				data_inicio: validated.data_inicio,
				data_fim: validated.data_fim,
				horario: validated.horario,
				hora_entrada: validated.hora_entrada,
				hora_saida: validated.hora_saida,
				lotacao: validated.lotacao,
				tipo: validated.tipo
			});

			return { success: true, id: result[0]?.id };
		} catch (err) {
			logger.error('[escalas/nova/criar] Erro interno ao criar escala', {
				lotacao,
				tipo,
				error: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack : undefined
			});
			return fail(500, {
				error: 'Erro interno ao criar escala',
				fields: { titulo, cidade, data_inicio, data_fim, lotacao, tipo }
			});
		}
	}
};
