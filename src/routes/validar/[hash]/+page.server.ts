import { getDB, buscarDocumentoPorHash, buscarEscala, buscarGiseEscala } from '$lib/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, platform }) => {
	const hash = params.hash;

	console.log(`[validar] Iniciando validação para hash: ${hash}`);

	if (!hash) {
		console.warn('[validar] Hash ausente na URL');
		return { encontrado: false as const, motivo: 'hash_ausente' };
	}

	let db;
	try {
		db = getDB(platform);
	} catch (err) {
		console.error('[validar] Falha ao conectar ao banco de dados:', err);
		return { encontrado: false as const, motivo: 'erro_db' };
	}

	let documento;
	try {
		documento = await buscarDocumentoPorHash(db, hash) as any;
	} catch (err) {
		console.error(`[validar] Erro ao buscar documento pelo hash "${hash}":`, err);
		return { encontrado: false as const, motivo: 'erro_consulta' };
	}

	if (!documento) {
		console.log(`[validar] Nenhum documento encontrado para hash: ${hash}`);
		return { encontrado: false as const, motivo: 'nao_encontrado' };
	}

	console.log(`[validar] Documento encontrado: tipo=${documento.tipo_doc}, id=${documento.id}`);

	let escala;
	try {
		if (documento.tipo_doc === 'escala') {
			escala = await buscarEscala(db, documento.escala_id);
		} else {
			escala = await buscarGiseEscala(db, documento.escala_id);
		}
	} catch (err) {
		console.error(`[validar] Erro ao buscar escala id=${documento.escala_id}:`, err);
		return { encontrado: false as const, motivo: 'erro_consulta' };
	}

	if (!escala) {
		console.warn(`[validar] Escala id=${documento.escala_id} não encontrada`);
		return { encontrado: false as const, motivo: 'nao_encontrado' };
	}

	console.log(`[validar] Validação concluída com sucesso para hash: ${hash}`);

	let titulo = (escala as any).titulo || 'Escala GISE';
	if (documento.tipo_doc === 'gise_relatorio') {
		titulo = `Relatório de Serviço ${documento.rel_tipo === 'extraordinario' ? 'Extraordinário' : 'Produtividade'}`;
	}

	return {
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
			titulo: titulo,
			cidade: (escala as any).cidade || 'Iguatu',
			data_inicio: escala.data_inicio,
			data_fim: escala.data_fim,
			lotacao: (escala as any).lotacao || 'Sertão Central / Centro Sul'
		},
		hash
	};
};
