import { getDB, buscarDocumentoPorHash, buscarEscala } from '$lib/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, platform }) => {
	const db = getDB(platform);
	const hash = params.hash;

	if (!hash) {
		return { encontrado: false as const };
	}

	const documento = await buscarDocumentoPorHash(db, hash);
	if (!documento) {
		return { encontrado: false as const };
	}

	const escala = await buscarEscala(db, documento.escala_id);
	if (!escala) {
		return { encontrado: false as const };
	}

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
