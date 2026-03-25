import { getDB, buscarDocumentoPorHash, buscarEscala } from '$lib/db';
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
		documento = await buscarDocumentoPorHash(db, hash);
	} catch (err) {
		console.error(`[validar] Erro ao buscar documento pelo hash "${hash}":`, err);
		return { encontrado: false as const, motivo: 'erro_consulta' };
	}

	if (!documento) {
		console.log(`[validar] Nenhum documento encontrado para hash: ${hash}`);
		return { encontrado: false as const, motivo: 'nao_encontrado' };
	}

	console.log(`[validar] Documento encontrado: id=${documento.id}, escala_id=${documento.escala_id}`);

	let escala;
	try {
		escala = await buscarEscala(db, documento.escala_id);
	} catch (err) {
		console.error(`[validar] Erro ao buscar escala id=${documento.escala_id}:`, err);
		return { encontrado: false as const, motivo: 'erro_consulta' };
	}

	if (!escala) {
		console.warn(`[validar] Escala id=${documento.escala_id} não encontrada`);
		return { encontrado: false as const, motivo: 'nao_encontrado' };
	}

	console.log(`[validar] Validação concluída com sucesso para hash: ${hash}`);

	return {
		encontrado: true as const,
		documento: {
			assinante_nome: documento.assinante_nome,
			assinante_cpf: documento.assinante_cpf,
			created_at: documento.created_at
		},
		escala: {
			titulo: escala.titulo,
			cidade: escala.cidade,
			data_inicio: escala.data_inicio,
			data_fim: escala.data_fim,
			lotacao: escala.lotacao
		},
		hash
	};
};
