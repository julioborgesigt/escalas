/**
 * Página PÚBLICA de validação de documento — `/validar/[hash]`, o código
 * impresso no rodapé do PDF. Sem sessão: qualquer pessoa que receba o papel
 * precisa poder conferir se ele é autêntico.
 *
 * Daí as duas forças opostas que este `load` equilibra.
 *
 * **Provar** — a verificação é criptográfica de verdade
 * (`verificarAssinaturaCompleta`): integridade, assinatura, cadeia ICP-Brasil,
 * carimbo de tempo e revogação, item por item, não um "documento válido"
 * genérico.
 *
 * **Não expor** — quem valida não é o titular. Antes de serializar ao cliente:
 * CPF do assinante reduzido a `123.***.***-01`, nome mascarado, CPF do
 * certificado zerado, e IP, user-agent e GPS simplesmente omitidos (LGPD art.
 * 6º e 46). Nada disso é necessário para conferir autenticidade, e tudo isso
 * permitiria rastrear a pessoa.
 *
 * O cache é curto e com revalidação obrigatória, nunca `immutable`: o BLOB é
 * imutável, mas o STATUS não — um certificado revogado depois da assinatura
 * muda o resultado, e o snapshot OCSP revela isso na consulta seguinte.
 *
 * `autenticado` só liga o botão de baixar o PDF íntegro; a permissão de fato é
 * checada no endpoint de download.
 */
import {
	getDB,
	buscarDocumentoPorHash,
	buscarEscala,
	buscarGiseEscala,
	buscarGiseDetalhado,
	buscarGiseSeccionalMembros,
	buscarPresencasGise
} from '$lib/db';
import { decifrarCpfDoDB } from '$lib/crypto/cpf-cripto';
import { listarPoliciaisSupervisaoExtra } from '$lib/gise/gise-supervisao-extra';
import { secIdEhSupervisaoExtra } from '$lib/server/gise-supervisao-extra';
import { logger } from '$lib/server/logger';
import { tryGetR2 } from '$lib/db';
import { calcularHashBuffer } from '$lib/server/document-utils';
import { mascararNome } from '$lib/utils';
import { validarSessao } from '$lib/auth';
import { verificarAssinaturaCompleta, type VerificationResult } from '$lib/server/pdf-verification';
import { verificarSeloInstitucional, type ResultadoVerificacaoSelo } from '$lib/server/server-seal';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, platform, setHeaders, cookies }) => {
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

	logger.info('[validar] Documento encontrado', {
		hash,
		tipo: documento.tipo_doc,
		id: documento.id
	});

	let escala;
	try {
		if (documento.tipo_doc === 'escala') {
			escala = await buscarEscala(db, documento.escala_id);
		} else {
			escala = await buscarGiseEscala(db, documento.escala_id);
		}
	} catch (err) {
		logger.error(`[validar] Erro ao buscar escala`, {
			escala_id: documento.escala_id,
			err: String(err)
		});
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
		titulo =
			documento.tipo_doc === 'gise_presenca'
				? 'Termo de Confirmação de Presença — GISE'
				: 'Escala GISE';
		cidade = 'Iguatu';
		data_fim = undefined;
		lotacao = 'Sertão Central / Centro Sul';
	}

	// LGPD (art. 6º): a página de validação é PÚBLICA e prova só a AUTENTICIDADE
	// do documento. O roster nominal da equipe (quem confirmou presença e quando)
	// é detalhe operacional — não sai do servidor. Enviamos apenas o agregado.
	let equipeResumo: { total: number; confirmados: number } | null = null;
	if (documento.tipo_doc === 'gise_relatorio' && documento.seccional_id) {
		try {
			const todasPresencas = await buscarPresencasGise(db, documento.escala_id, platform?.env);
			const presencaMap = new Map(todasPresencas.map((p) => [p.policial_id, p]));

			const supExtra = await secIdEhSupervisaoExtra(db, documento.seccional_id);
			let membrosSec: Array<{
				policial_id: number;
				policial_nome: string;
				policial_cpf: string | null;
			}> = [];
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
				membrosSec = await buscarGiseSeccionalMembros(
					db,
					documento.escala_id,
					documento.seccional_id,
					platform?.env
				);
			}

			// Agregado de confirmações — sem nomes nem horários individuais, que
			// permitiriam rastrear quem estava onde e quando.
			const confirmados = membrosSec.filter(
				(m) =>
					!!(presencaMap.get(m.policial_id) as { entrada_timestamp?: string | null } | undefined)
						?.entrada_timestamp
			).length;
			equipeResumo = { total: membrosSec.length, confirmados };
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
	// Marcador do fluxo QUALIFICADO: só o cades-finalizer grava cms_sha256. Assinaturas
	// avançadas (em tela) não têm CMS embarcado — sua integridade é o hash custodial
	// (arquivo_hash), não a verificação criptográfica de assinatura.
	const temCmsAssinado = !!(docAny.cms_sha256 as string | undefined);
	const ehAvancada =
		tipoAssin === 'simples' || (tipoAssin === null && documento.tipo_doc === 'gise_relatorio');

	let verificacao: VerificationResult | null = null;
	let hashConfere: boolean | null = null;
	let selo: ResultadoVerificacaoSelo | null = null;
	try {
		const r2 = tryGetR2(platform);
		if (r2 && documento.r2_key) {
			const obj = await r2.get(documento.r2_key);
			if (obj) {
				const buf = new Uint8Array(await obj.arrayBuffer());
				const env = platform?.env as unknown as Record<string, string | undefined> | undefined;
				if (arquivoHashEsperado) {
					const h = await calcularHashBuffer(buf);
					hashConfere = h === arquivoHashEsperado;
				}
				if (!ehAvancada && tipoAssin !== 'simples' && temCmsAssinado) {
					verificacao = await verificarAssinaturaCompleta(buf, { ocspSnapshotB64, env });
				} else {
					// Fluxo avançado: pode haver selo institucional (CMS autoassinado).
					selo = await verificarSeloInstitucional(buf, env);
				}
			}
		}
	} catch (err) {
		logger.warn('[validar] Falha na verificação criptográfica', {
			hash,
			err: String(err)
		});
	}

	// LGPD: o resultado da verificação carrega CPF e nome COMPLETOS do certificado
	// (uso interno). A página pública mostra só emissor/série/validade, então
	// removemos o CPF completo e mascaramos o nome antes de serializar ao cliente.
	if (verificacao?.certificado) {
		verificacao.certificado.cpf = '';
		verificacao.certificado.nome = mascararNome(verificacao.certificado.nome);
	}

	// O documento (R2 blob) é imutável por hash, mas a PÁGINA de validação
	// pode mudar de status — ex.: o certificado é revogado depois da assinatura,
	// e o snapshot OCSP armazenado revela isso na próxima consulta. Por isso
	// NÃO usamos `immutable` aqui (que diria ao browser para nunca revalidar):
	//   - cache curto (60s) para evitar martelar D1 em F5 repetido
	//   - revalidação obrigatória para refletir mudanças de status
	//   - stale-while-revalidate de 5 min para latência baixa
	setHeaders({
		'Cache-Control': 'public, max-age=60, must-revalidate, stale-while-revalidate=300'
	});

	// Minimização antes de serializar ao cliente (LGPD art. 6º e 46).
	// CPF: 3 primeiros + 2 últimos dígitos (ex: 123.***.***-01). Nome do
	// assinante: mascarado. IP, user-agent e GPS: omitidos — desnecessários para
	// validação pública e permitem rastreamento individual.
	// CPF cifrado em repouso (LGPD) — decifra antes de mascarar p/ exibição pública.
	const cpfClaroAssinante = await decifrarCpfDoDB(documento.assinante_cpf, platform?.env);
	const cpfMascarado = cpfClaroAssinante
		? cpfClaroAssinante.replace(/^(\d{3})\d{5}(\d{2})$/, '$1.***.***-$2')
		: null;

	// Visitante autenticado? Só então a página mostra o botão de download do PDF
	// íntegro (restrito). A permissão de fato é checada no endpoint de download;
	// aqui é só para a UI.
	const autenticado = !!(await validarSessao(db, cookies.get('session_token'), platform).catch(
		() => null
	));

	return {
		encontrado: true as const,
		documento: {
			assinante_nome: mascararNome(documento.assinante_nome),
			assinante_cpf: cpfMascarado,
			created_at: documento.created_at,
			tipo: documento.tipo_doc,
			tipo_assinatura: tipoAssin,
			cert_issuer: (docAny.cert_issuer as string | undefined) ?? null,
			cert_valido_ate: (docAny.cert_valido_ate as string | undefined) ?? null,
			ocsp_consultado_em: (docAny.ocsp_consultado_em as string | undefined) ?? null
		},
		verificacao,
		hashConfere,
		selo,
		escala: {
			titulo,
			cidade,
			data_inicio: escala.data_inicio,
			data_fim,
			lotacao
		},
		equipeResumo,
		autenticado,
		hash
	};
};
