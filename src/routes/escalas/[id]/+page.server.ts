import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getDB,
	buscarEscala,
	listarPoliciaisEscala,
	listarPoliciais,
	buscarDocumentoEscala,
	adicionarPolicialEscala,
	adicionarMultiplasDatasPlantao,
	atualizarEscalaPolicial,
	removerPolicialEscala,
	adicionarTodosPoliciais,
	criarEscala,
	verificarEscalaExistente,
	registrarAuditComContexto
} from '$lib/db';
import {
	calcularProximoMesDias,
	proximoMes,
	primeiroDiaDoMes,
	ultimoDiaDoMes,
	calcularDataSaida,
	MESES_PT
} from '$lib/rotacao';

function calcularDataSaidaInicial(
	dataEntrada: string,
	horaEntrada: string,
	horaSaida: string
): string {
	const he = Number(horaEntrada.split(':')[0]);
	const hs = Number(horaSaida.split(':')[0]);
	if (hs <= he) {
		const d = new Date(dataEntrada + 'T00:00:00');
		d.setDate(d.getDate() + 1);
		return d.toISOString().split('T')[0];
	}
	return dataEntrada;
}

export const load: PageServerLoad = async ({ locals, platform, params }) => {
	const u = locals.usuario;
	if (!u) throw redirect(302, '/login');

	const db = getDB(platform);
	const escalaId = Number(params.id);
	if (isNaN(escalaId)) throw redirect(302, '/escalas');

	// Verificar acesso
	if (u.tipo === 'policial') {
		const escala = await buscarEscala(db, escalaId);
		if (!escala || escala.lotacao !== u.lotacao) {
			throw redirect(302, '/escalas');
		}
	}

	const [escala, policiaisEscala, todosPoliciais, docInfo] = await Promise.all([
		buscarEscala(db, escalaId),
		listarPoliciaisEscala(db, escalaId),
		listarPoliciais(db, undefined, false, { busca: undefined, page: undefined, limit: undefined }).then(r => r.policiais),
		buscarDocumentoEscala(db, escalaId).then(d => d ? {
			existe: true,
			assinante_nome: d.assinante_nome,
			assinante_cpf: d.assinante_cpf,
			data: d.created_at
		} : { existe: false })
	]);

	if (!escala) throw redirect(302, '/escalas');

	return {
		escala,
		policiaisEscala,
		todosPoliciais,
		documentoAssinadoInfo: docInfo,
		escalaId
	};
};

export const actions: Actions = {
	adicionar: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const data = await request.formData();
		const escalaId = Number(params.id);
		const policial_id = Number(data.get('policial_id'));
		const data_plantao = data.get('data_plantao')?.toString() || '';
		const hora_entrada = data.get('hora_entrada')?.toString() || '08';
		const minuto_entrada = data.get('minuto_entrada')?.toString() || '00';
		const hora_saida = data.get('hora_saida')?.toString() || '08';
		const minuto_saida = data.get('minuto_saida')?.toString() || '00';
		const equipe = data.get('equipe')?.toString() || '';

		if (isNaN(policial_id) || !data_plantao) {
			return fail(400, { error: 'Dados inválidos' });
		}

		const db = getDB(platform);
		const horaEnt = `${hora_entrada}:${minuto_entrada}`;
		const horaSai = `${hora_saida}:${minuto_saida}`;
		const dataSaida = calcularDataSaidaInicial(data_plantao, horaEnt, horaSai);

		try {
			await adicionarPolicialEscala(db, escalaId, policial_id, data_plantao, dataSaida, horaEnt, horaSai, '', equipe);
			const policiais = await listarPoliciaisEscala(db, escalaId);
			return { success: true, policiais };
		} catch {
			return fail(500, { error: 'Erro ao adicionar policial' });
		}
	},

	adicionarPlantao: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const data = await request.formData();
		const escalaId = Number(params.id);
		const policial_id = Number(data.get('policial_id'));
		const hora_entrada = data.get('hora_entrada')?.toString() || '08';
		const minuto_entrada = data.get('minuto_entrada')?.toString() || '00';
		const hora_saida = data.get('hora_saida')?.toString() || '08';
		const minuto_saida = data.get('minuto_saida')?.toString() || '00';
		const equipe = data.get('equipe')?.toString() || '';

		// Parse datas selecionadas (JSON string no hidden field)
		const datasJson = data.get('datas')?.toString() || '[]';
		let datas: Array<{ data_plantao: string; data_saida: string }>;
		try {
			datas = JSON.parse(datasJson);
		} catch {
			return fail(400, { error: 'Datas inválidas' });
		}

		if (isNaN(policial_id) || datas.length === 0) {
			return fail(400, { error: 'Selecione pelo menos uma data' });
		}

		const db = getDB(platform);
		const he = `${hora_entrada}:${minuto_entrada}`;
		const hs = `${hora_saida}:${minuto_saida}`;

		try {
			await adicionarMultiplasDatasPlantao(db, escalaId, policial_id, datas, he, hs, equipe);
			const policiais = await listarPoliciaisEscala(db, escalaId);
			return { success: true, policiais };
		} catch {
			return fail(500, { error: 'Erro ao adicionar policial à escala de plantão' });
		}
	},

	adicionarTodos: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const escalaId = Number(params.id);
		const db = getDB(platform);
		const escala = await buscarEscala(db, escalaId);
		if (!escala) return fail(404, { error: 'Escala não encontrada' });

		if (escala.tipo !== 'plantao' && escala.tipo !== 'expediente') {
			return fail(400, { error: 'Operação inválida para este tipo de escala' });
		}

		const he = escala.hora_entrada || '08:00';
		const hs = escala.hora_saida || '08:00';
		const ds = calcularDataSaidaInicial(escala.data_inicio, he, hs);

		try {
			const quantidade = await adicionarTodosPoliciais(
				db, escalaId, escala.lotacao, escala.tipo,
				escala.data_inicio, ds, he, hs
			);
			const policiais = await listarPoliciaisEscala(db, escalaId);
			return { success: true, quantidade, policiais };
		} catch {
			return fail(500, { error: 'Erro ao adicionar servidores' });
		}
	},

	gerarProximoMes: async ({ locals, platform, params }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const escalaId = Number(params.id);
		const db = getDB(platform);
		const escalaAtual = await buscarEscala(db, escalaId);
		if (!escalaAtual) return fail(404, { error: 'Escala não encontrada' });

		if (escalaAtual.tipo !== 'plantao' && escalaAtual.tipo !== 'expediente') {
			return fail(400, { error: 'Operação inválida para este tipo de escala' });
		}

		const [anoAtual, mesAtual] = escalaAtual.data_inicio.split('-').map(Number);
		const { ano: novoAno, mes: novoMes } = proximoMes(anoAtual, mesAtual);
		const novaDataInicio = primeiroDiaDoMes(novoAno, novoMes);
		const novaDataFim = ultimoDiaDoMes(novoAno, novoMes);

		const existente = await verificarEscalaExistente(
			db, escalaAtual.lotacao, escalaAtual.tipo, novaDataInicio
		);
		if (existente) {
			return fail(409, {
				error: `Já existe uma Escala de ${escalaAtual.tipo === 'plantao' ? 'Plantão' : 'Expediente'} para ${escalaAtual.lotacao} em ${MESES_PT[novoMes - 1]} ${novoAno}.`,
				escala_id: existente.id
			});
		}

		const tipoLabel = escalaAtual.tipo === 'plantao' ? 'PLANTÃO' : 'EXPEDIENTE';
		const novoTitulo = `ESCALA DE ${tipoLabel} DA ${escalaAtual.lotacao.toUpperCase()} – ${MESES_PT[novoMes - 1].toUpperCase()} ${novoAno}`;

		try {
			const result = await criarEscala(db, {
				titulo: novoTitulo,
				cidade: escalaAtual.cidade,
				data_inicio: novaDataInicio,
				data_fim: novaDataFim,
				horario: escalaAtual.horario,
				hora_entrada: escalaAtual.hora_entrada,
				hora_saida: escalaAtual.hora_saida,
				lotacao: escalaAtual.lotacao,
				tipo: escalaAtual.tipo
			});

			const novaEscalaId = result[0]?.id;
			if (!novaEscalaId) return fail(500, { error: 'Erro ao criar nova escala' });

			// Copiar policiais
			const policiaisAtuais = await listarPoliciaisEscala(db, escalaId);
			let adicionados = 0;
			const naoProcessados: Array<{ nome: string; motivo: string }> = [];

			if (escalaAtual.tipo === 'expediente') {
				const policialIdsVistos = new Set<number>();
				const he = escalaAtual.hora_entrada || '00:00';
				const hs = escalaAtual.hora_saida || '23:59';

				for (const p of policiaisAtuais) {
					if (policialIdsVistos.has(p.policial_id)) continue;
					policialIdsVistos.add(p.policial_id);

					const dsEntrada = p.hora_entrada || he;
					const dsSaida = p.hora_saida || hs;
					const dataSaida = calcularDataSaida(novaDataInicio, dsEntrada, dsSaida);

					await adicionarPolicialEscala(db, novaEscalaId, p.policial_id, novaDataInicio, dataSaida, dsEntrada, dsSaida);
					adicionados++;
				}
			} else {
				const diasPorPolicial = new Map<number, { nome: string; dias: string[]; equipe: string }>();
				for (const p of policiaisAtuais) {
					if (!diasPorPolicial.has(p.policial_id)) {
						diasPorPolicial.set(p.policial_id, { nome: p.nome, dias: [], equipe: p.equipe || '' });
					}
					diasPorPolicial.get(p.policial_id)!.dias.push(p.data_plantao);
				}

				const he = escalaAtual.hora_entrada || '00:00';
				const hs = escalaAtual.hora_saida || '23:59';
				for (const [policialId, { nome, dias, equipe }] of diasPorPolicial) {
					const { dias: novosDias, rotacao } = calcularProximoMesDias(dias, novoAno, novoMes);
					if (novosDias.length === 0) {
						naoProcessados.push({
							nome,
							motivo: rotacao === null ? 'Rotação não identificada' : 'Nenhum dia calculado'
						});
						continue;
					}
					for (const dia of novosDias) {
						const dataSaida = calcularDataSaida(dia, he, hs);
						await adicionarPolicialEscala(db, novaEscalaId, policialId, dia, dataSaida, he, hs, '', equipe);
					}
					adicionados++;
				}
			}

			await registrarAuditComContexto(db, {
				usuario: u,
				acao: 'criar_escala',
				entidade: 'escala',
				entidade_id: novaEscalaId,
				detalhes: `Escala do próximo mês gerada a partir da escala ${escalaId}`
			});

			return { success: true, escala_id: novaEscalaId, adicionados, nao_processados: naoProcessados };
		} catch {
			return fail(500, { error: 'Erro ao gerar escala do próximo mês' });
		}
	},

	editar: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const data = await request.formData();
		const escalaId = Number(params.id);
		const item_id = Number(data.get('item_id'));
		const data_plantao = data.get('data_plantao')?.toString() || '';
		const data_saida = data.get('data_saida')?.toString() || '';
		const hora_entrada = data.get('hora_entrada')?.toString() || '';
		const hora_saida = data.get('hora_saida')?.toString() || '';
		const observacoes = data.get('observacoes')?.toString() || '';

		if (isNaN(item_id)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		try {
			await atualizarEscalaPolicial(db, item_id, data_plantao, data_saida, hora_entrada, hora_saida, observacoes);
			const policiais = await listarPoliciaisEscala(db, escalaId);
			return { success: true, policiais };
		} catch {
			return fail(500, { error: 'Erro ao salvar alterações' });
		}
	},

	remover: async ({ request, locals, platform, params }) => {
		const u = locals.usuario;
		if (!u) return fail(401, { error: 'Não autorizado' });

		const data = await request.formData();
		const escalaId = Number(params.id);
		const item_id = Number(data.get('item_id'));

		if (isNaN(item_id)) return fail(400, { error: 'ID inválido' });

		const db = getDB(platform);
		try {
			await removerPolicialEscala(db, item_id);
			const policiais = await listarPoliciaisEscala(db, escalaId);
			return { success: true, policiais };
		} catch {
			return fail(500, { error: 'Erro ao remover policial' });
		}
	}
};
