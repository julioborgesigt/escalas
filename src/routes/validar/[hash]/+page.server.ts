import { getDB, buscarDocumentoPorHash, buscarEscala, buscarGiseEscala, buscarGiseDetalhado, buscarGiseSeccionalMembros, buscarPresencasGise } from '$lib/db';
import { listarPoliciaisSupervisaoExtra } from '$lib/gise/gise-supervisao-extra';
import { secIdEhSupervisaoExtra } from '$lib/server/gise-supervisao-extra';
import { logger } from '$lib/server/logger';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, platform, setHeaders }) => {
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
			const todasPresencas = await buscarPresencasGise(db, documento.escala_id);
			const presencaMap = new Map(todasPresencas.map((p) => [p.policial_id, p]));

			const supExtra = await secIdEhSupervisaoExtra(db, documento.seccional_id);
			let membrosSec: Array<{ policial_id: number; policial_nome: string; policial_cpf: string | null }> = [];
			if (supExtra) {
				const giseDet = await buscarGiseDetalhado(db, documento.escala_id);
				if (giseDet) {
					membrosSec = listarPoliciaisSupervisaoExtra(giseDet).map((r) => {
						const nome =
							r.policial_id === giseDet.supervisor_id
								? giseDet.supervisor_nome
								: r.policial_id === giseDet.assessor_id
									? giseDet.assessor_nome
									: r.policial_id === giseDet.seint1_id
										? giseDet.seint1_nome
										: r.policial_id === giseDet.seint2_id
											? giseDet.seint2_nome
											: r.papel;
						return {
							policial_id: r.policial_id,
							policial_nome: nome ?? r.papel,
							policial_cpf: null
						};
					});
				}
			} else {
				membrosSec = await buscarGiseSeccionalMembros(db, documento.escala_id, documento.seccional_id);
			}

			membros = membrosSec.map((m: any) => ({
				...m,
				presenca: presencaMap.get(m.policial_id) || null
			}));
		} catch (err) {
			logger.error('[validar] Erro ao buscar assinaturas da equipe', { err: String(err) });
		}
	}

	// Resultado imutável: dados de assinatura não mudam após a criação.
	// Cache no edge do Cloudflare por 1h; browser revalida após 60s.
	setHeaders({
		'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400'
	});

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
