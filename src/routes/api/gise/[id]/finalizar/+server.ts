/**
 * POST /api/gise/[id]/finalizar
 *
 * Marca a escala GISE atual como "finalizada" e clona a próxima.
 * Exclusivo do Administrador Geral.
 * Estado 1 do fluxo de automação.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDB, buscarGiseEscala, finalizarGiseEscala, auditar, contextoDeEvento } from '$lib/db';
import { coletarAfetadosGise, invalidarPapelGiseMultiplos } from '$lib/server/gise/papel-cache';
import { agendarSyncBaseEquipeAposFinalizar } from '$lib/server/gise/base-equipe-sync';
import { giseIdParamSchema } from '$lib/schemas';
import { requireAdmin, badRequest, notFound, conflict } from '$lib/server/api';
import { modoDeFinalizacao, PENDENCIAS_DA_ANTECIPADA } from '$lib/gise/finalizacao';

export const POST: RequestHandler = async (event) => {
	const { locals, params, platform } = event;
	const u = requireAdmin(locals);
	if (u instanceof Response) return u;

	const parsed = giseIdParamSchema.safeParse(params);
	if (!parsed.success) return badRequest(parsed.error.issues[0].message);

	const { id } = parsed.data;

	const db = getDB(platform);
	const gise = await buscarGiseEscala(db, id);
	if (!gise) return notFound('Escala GISE');

	if (gise.status === 'finalizada') return conflict('Escala já finalizada');

	// A condição contradizia a mensagem: dizia "precisa estar com todos os
	// relatórios assinados" e aceitava `em_andamento`, que não tem nenhum. A
	// saída antecipada continua existindo — o que muda é ela ficar NOMEADA, aqui
	// e na trilha (FLW-GISE-005).
	const modo = modoDeFinalizacao(gise.status);
	if (modo === 'bloqueado') {
		return conflict('O status atual da escala não permite finalizar');
	}

	// Cache invalidation: supervisor + membros perdem papel ativo após finalizar.
	// Coletado ANTES de mexer no status — é a lista de caches a invalidar depois.
	const afetados = await coletarAfetadosGise(db, id);

	// O check de status acima é conveniência para a mensagem; quem DECIDE é o
	// CAS. Sem ele, duas requisições simultâneas passavam as duas pelo check e
	// auditavam duas vezes, além de mandar a base de equipe para a planilha
	// institucional em duplicidade (SEC-35).
	const { finalizada } = await finalizarGiseEscala(db, id);
	if (!finalizada) return conflict('Escala já finalizada');

	await invalidarPapelGiseMultiplos(afetados);

	agendarSyncBaseEquipeAposFinalizar(platform, db, id);

	const { contexto, env } = contextoDeEvento(event);
	await auditar(
		db,
		{
			acao: 'finalizar_gise',
			usuario: u,
			entidade: 'gise',
			entidade_id: id,
			alvo_tipo: 'gise',
			alvo_id: id,
			severidade: modo === 'antecipada' ? 'aviso' : 'info',
			detalhes:
				modo === 'antecipada'
					? `GISE ${id} finalizada ANTECIPADAMENTE, sem ${PENDENCIAS_DA_ANTECIPADA.join(', ')}`
					: `GISE ${id} finalizada`,
			metadados: { modo, status_anterior: gise.status, data_inicio: gise.data_inicio },
			...contexto
		},
		{ env }
	);

	return json({ ok: true });
};
