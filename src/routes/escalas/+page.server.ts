import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	listarEscalas,
	criarEscala,
	excluirEscala,
	listarUnidades,
	verificarEscalaExistente
} from '$lib/db';
import { escalaSchema } from '$lib/schemas';
import { registrarAuditComContexto } from '$lib/db';
import { logger } from '$lib/server/logger';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	if (u.tipo !== 'admin' && u.papel !== 'admin_seccional' && u.papel !== 'admin_unidade') {
		throw redirect(302, '/');
	}

	const db = getDB(platform);

	// Parâmetros de filtro
	const isAdmin = u.tipo === 'admin';
	const lotacaoParam = url.searchParams.get('lotacao') || undefined;
	const mes = url.searchParams.get('mes') ? Number(url.searchParams.get('mes')) : undefined;
	const ano = url.searchParams.get('ano') ? Number(url.searchParams.get('ano')) : undefined;
	const tipo = url.searchParams.get('tipo') || undefined;
	const busca = url.searchParams.get('busca') || undefined;
	const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined;

	// Se for admin sem lotacao selecionada, nao busca dados
	const skipLoad = isAdmin && !lotacaoParam;

	const [resultado, unidades] = await Promise.all([
		skipLoad
			? { escalas: [], total: 0, page: 1, limit: 20, totalPages: 1 }
			: listarEscalas(db, lotacaoParam, undefined, mes, ano, tipo, undefined, undefined, {
				busca,
				page,
				limit: 20
			}),
		listarUnidades(db)
	]);

	return {
		escalas: resultado.escalas,
		pagination: {
			page: resultado.page,
			limit: resultado.limit,
			total: resultado.total,
			totalPages: resultado.totalPages
		},
		unidades,
		filtros: {
			lotacao: lotacaoParam ?? '',
			mes: mes ?? 0,
			ano: ano ?? 0,
			tipo: tipo ?? 'todos',
			busca: busca ?? ''
		},
		isAdmin,
		skipLoad
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
				fields: { titulo, cidade, data_inicio, data_fim, lotacao, tipo }
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
				validated.data_inicio
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
			logger.error('[escalas/criar] Erro interno ao criar escala', {
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
	},

	excluir: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const data = await request.formData();
		const escalaId = Number(data.get('escala_id'));
		if (isNaN(escalaId)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);

		// Policial só pode excluir escalas da sua lotação
		if (u.tipo === 'policial') {
			const { buscarEscala } = await import('$lib/db');
			const escala = await buscarEscala(db, escalaId);
			if (escala && escala.lotacao !== u.lotacao) {
				return fail(403, { error: 'Sem permissão' });
			}
		}

		await excluirEscala(db, escalaId);

		if (u) {
			await registrarAuditComContexto(db, {
				usuario: u,
				acao: 'excluir_escala',
				entidade: 'escala',
				entidade_id: escalaId,
				detalhes: `Escala excluída: ID ${escalaId}`
			});
		}

		return { success: true };
	}
};
