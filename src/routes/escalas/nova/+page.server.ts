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
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';

export const load: PageServerLoad = async ({ locals, platform }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const db = getDB(platform);
	const isAdmin = u.tipo === 'admin';

	const [lotacoes, unidadesComRegime, form] = await Promise.all([
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
					.all(),
		superValidate(zod4(escalaSchema))
	]);

	return {
		lotacoes,
		unidadesComRegime,
		isAdmin,
		lotacaoUsuario: u.lotacao,
		form
	};
};

export const actions: Actions = {
	criar: async ({ request, locals, platform }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const form = await superValidate(request, zod4(escalaSchema));

		if (!form.valid) {
			return fail(400, { form });
		}

		// Policial sempre usa a própria lotação
		if (u.tipo === 'policial') {
			form.data.lotacao = u.lotacao!;
		}

		// Compor horario a partir de hora_entrada e hora_saida
		form.data.horario = `${form.data.hora_entrada}H A ${form.data.hora_saida}H`;

		const db = getDB(platform);

		// Validar unicidade
		if (form.data.tipo && form.data.lotacao) {
			const existente = await verificarEscalaExistente(
				db,
				form.data.lotacao,
				form.data.tipo as 'plantao' | 'expediente' | 'fds',
				form.data.data_inicio
			);
			if (existente) {
				const periodo = form.data.tipo === 'fds' ? 'nesta semana' : 'neste mês';
				const tipoLabel =
					form.data.tipo === 'plantao'
						? 'Plantão'
						: form.data.tipo === 'expediente'
							? 'Expediente'
							: 'Final de Semana';
				return message(
					form,
					JSON.stringify({
						type: 'error',
						error: `Já existe uma Escala de ${tipoLabel} para ${form.data.lotacao} ${periodo}.`
					}),
					{ status: 409 }
				);
			}
		}

		try {
			const result = await criarEscala(db, {
				titulo: form.data.titulo,
				cidade: form.data.cidade,
				data_inicio: form.data.data_inicio,
				data_fim: form.data.data_fim,
				horario: form.data.horario,
				hora_entrada: form.data.hora_entrada,
				hora_saida: form.data.hora_saida,
				lotacao: form.data.lotacao,
				tipo: form.data.tipo
			});

			return message(form, JSON.stringify({ type: 'success', id: result[0]?.id }));
		} catch (err) {
			console.error('[escalas/nova actions.criar] erro:', err);
			return message(form, JSON.stringify({ type: 'error', error: 'Erro interno ao criar escala' }), {
				status: 500
			});
		}
	}
};
