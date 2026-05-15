import { getDB, buscarDocumentoPorHash, buscarEscala, buscarGiseEscala, buscarGiseDetalhado, buscarGiseSeccionalMembros, buscarPresencasGise } from '$lib/db';
import { listarPoliciaisSupervisaoExtra } from '$lib/gise/gise-supervisao-extra';
import { secIdEhSupervisaoExtra } from '$lib/server/gise-supervisao-extra';
import { logger } from '$lib/server/logger';
import { getR2 } from '$lib/server/platform';
import { calcularHashBuffer } from '$lib/server/document-utils';
import { verificarAssinaturaCompleta, type VerificationResult } from '$lib/server/pdf-verification';
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

	// Verificação criptográfica do PDF (CAdES-LT). Lê o objeto do R2 e
	// reconfere hash + assinatura RSA + cadeia + revogação OCSP a partir do
	// snapshot armazenado no banco. Em qualquer falha de I/O, devolve um
	// resultado "indisponível" sem quebrar a página.
	const docAny = documento as Record<string, unknown>;
	const tipoAssin = (docAny.tipo_assinatura as string | undefined) ?? null;
	const arquivoHashEsperado = (docAny.arquivo_hash as string | undefined) ?? null;
	const ocspSnapshotB64 = (docAny.ocsp_response_b64 as string | undefined) ?? null;
	const ehAvancada = tipoAssin === 'simples' || tipoAssin === null && documento.tipo_doc === 'gise_relatorio';

	let verificacao: VerificationResult | null = null;
	let hashConfere: boolean | null = null;
	try {
		const r2 = getR2(platform);
		if (r2 && documento.r2_key) {
			const obj = await r2.get(documento.r2_key);
			if (obj) {
				const buf = new Uint8Array(await obj.arrayBuffer());
				if (arquivoHashEsperado) {
					const h = await calcularHashBuffer(buf);
					hashConfere = h === arquivoHashEsperado;
				}
				if (!ehAvancada && tipoAssin !== 'simples') {
					verificacao = await verificarAssinaturaCompleta(buf, {
						ocspSnapshotB64,
						tipoCarimboTempoArmazenado:
							(docAny.tipo_carimbo_tempo as 'servidor' | 'act_icp' | undefined) ?? null
					});
				}
			}
		}
	} catch (err) {
		logger.warn('[validar] Falha na verificação criptográfica', {
			hash,
			err: String(err)
		});
	}

	// Resultado imutável: dados de assinatura não mudam após a criação.
	// Cache no edge do Cloudflare por 1h; browser revalida após 60s.
	setHeaders({
		'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400'
	});

	// Mascarar dados pessoais antes de serializar para o cliente.
	// CPF: manter apenas 3 primeiros + 2 últimos dígitos (ex: 123.***.***-01).
	// IP, user-agent e coordenadas precisas são omitidos — não necessários para
	// validação pública e permitem rastreamento individual (LGPD art. 6º e 46).
	const cpfMascarado = documento.assinante_cpf
		? documento.assinante_cpf.replace(/^(\d{3})\d{5}(\d{2})$/, '$1.***.***-$2')
		: null;
	const latReduzida =
		documento.latitude != null ? Math.round(documento.latitude * 100) / 100 : null;
	const lngReduzida =
		documento.longitude != null ? Math.round(documento.longitude * 100) / 100 : null;

	return {
		encontrado: true as const,
		documento: {
			assinante_nome: documento.assinante_nome,
			assinante_cpf: cpfMascarado,
			created_at: documento.created_at,
			tipo: documento.tipo_doc,
			latitude: latReduzida,
			longitude: lngReduzida,
			tipo_assinatura: tipoAssin,
			cert_issuer: (docAny.cert_issuer as string | undefined) ?? null,
			cert_valido_ate: (docAny.cert_valido_ate as string | undefined) ?? null,
			ocsp_consultado_em: (docAny.ocsp_consultado_em as string | undefined) ?? null
		},
		verificacao,
		hashConfere,
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
