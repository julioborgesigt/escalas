import { getDB, buscarDocumentoPorHash, buscarEscala, buscarGiseEscala, buscarGiseSeccionalMembros, buscarPresencasGise } from '$lib/db';
import { logger } from '$lib/server/logger';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, platform }) => {
	const hash = params.hash;

	logger.info('[validar] Iniciando validação', { hash });

	if (!hash) {
		logger.warn('[validar] Hash ausente na URL');
		return { encontrado: false as const, motivo: 'hash_ausente' };
	}

	let db;
	try {
		db = getDB(platform);
	} catch (err) {
		logger.error('[validar] Falha ao conectar ao banco de dados', { err: String(err) });
		return { encontrado: false as const, motivo: 'erro_db' };
	}

	let documento;
	try {
		documento = await buscarDocumentoPorHash(db, hash);
	} catch (err) {
		logger.error(`[validar] Erro ao buscar documento pelo hash`, { hash, err: String(err) });
		return { encontrado: false as const, motivo: 'erro_consulta' };
	}

	if (!documento) {
		logger.info('[validar] Documento não encontrado', { hash });
		return { encontrado: false as const, motivo: 'nao_encontrado' };
	}

	logger.info('[validar] Documento encontrado', { hash, tipo: documento.tipo_doc, id: documento.id });

	let escala;
	try {
		if (documento.tipo_doc === 'escala') {
			escala = await buscarEscala(db, documento.escala_id);
		} else {
			escala = await buscarGiseEscala(db, documento.escala_id);
		}
	} catch (err) {
		logger.error(`[validar] Erro ao buscar escala`, { escala_id: documento.escala_id, err: String(err) });
		return { encontrado: false as const, motivo: 'erro_consulta' };
	}

	if (!escala) {
		logger.warn(`[validar] Escala não encontrada`, { escala_id: documento.escala_id });
		return { encontrado: false as const, motivo: 'nao_encontrado' };
	}

	logger.info('[validar] Validação concluída com sucesso', { hash });

	let titulo: string;
	let cidade: string;
	let data_fim: string | undefined;
	let lotacao: string;

	if ('titulo' in escala) {
		// Escala regular
		titulo = escala.titulo;
		cidade = escala.cidade;
		data_fim = escala.data_fim;
		lotacao = escala.lotacao;
	} else {
		// GISE
		titulo = 'Escala GISE';
		cidade = 'Iguatu';
		data_fim = undefined;
		lotacao = 'Sertão Central / Centro Sul';
	}

	let membros = [];
	if (documento.tipo_doc === 'gise_relatorio' && documento.seccional_id) {
		try {
			const [membrosSec, todasPresencas] = await Promise.all([
				buscarGiseSeccionalMembros(db, documento.escala_id, documento.seccional_id),
				buscarPresencasGise(db, documento.escala_id)
			]);

			const presencaMap = new Map(todasPresencas.map(p => [p.policial_id, p]));

			membros = membrosSec.map((m: any) => ({
				...m,
				presenca: presencaMap.get(m.policial_id) || null
			}));
		} catch (err) {
			logger.error('[validar] Erro ao buscar assinaturas da equipe', { err: String(err) });
		}
	}

	return {
		// ... (rest of the return block)
		encontrado: true as const,
		documento: {
			assinante_nome: documento.assinante_nome,
			assinante_cpf: documento.assinante_cpf,
			created_at: documento.created_at,
			tipo: documento.tipo_doc,
			ip_address: documento.ip_address,
			user_agent: documento.user_agent,
			latitude: documento.latitude,
			longitude: documento.longitude
		},
		escala: {
			titulo,
			cidade,
			data_inicio: escala.data_inicio,
			data_fim,
			lotacao
		},
		membros,
		hash
	};
};
