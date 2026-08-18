/**
 * `GET /api/validar/[hash]/download` — o download da rota PÚBLICA de validação.
 *
 * É o endpoint com o maior desnível de confiança do sistema: sem sessão, o
 * chamador é qualquer pessoa que tenha o código impresso no rodapé de um PDF.
 * Por isso a regra dos dois artefatos vale aqui na forma mais estrita:
 *
 * - **cópia de conferência** (padrão) — o documento REGERADO, com rodapé e QR,
 *   SEM o manifesto forense. É o que qualquer um recebe;
 * - **blob íntegro do R2** — só para usuário autenticado e privilegiado. Ele
 *   carrega o manifesto com CPF, IP, GPS e selfie de quem assinou; entregá-lo
 *   a quem só tem o código transformaria a validação pública em vazamento.
 *
 * O nome do arquivo é derivado do `tipo_doc` resolvido pelo hash (escala, GISE,
 * relatório ou termo de presença) — os quatro tipos passam por aqui, porque o
 * código de validação é único no sistema inteiro.
 */
import { getDB, buscarDocumentoPorHash } from '$lib/db';
import { validarSessao } from '$lib/auth';
import { tryGetR2 } from '$lib/db';
import {
	contentDisposition,
	badRequest,
	notFound,
	unauthorized,
	rateLimited,
	serverError
} from '$lib/server/api';
import {
	contarRecoveryAttempts,
	registrarRecoveryAttempt
} from '$lib/server/auth/recovery-rate-limit';
import { registrarAuditComContexto } from '$lib/db/audit';
import {
	podeBaixarForense,
	gerarCopiaConferencia,
	chaveConferencia
} from '$lib/server/assinatura/copia-conferencia';
import { carregarLogosGise } from '$lib/server/gise/logos';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';
import { mensagemDeErro } from '$lib/utils/erro';

// Rate-limit do download por IP — defesa em profundidade contra enumeração do
// hash (~40 bits) por um usuário autenticado. Estado em D1 (serverless-safe).
const VALIDAR_DOWNLOAD_MAX = 60;
const VALIDAR_DOWNLOAD_WINDOW_MIN = 10;

/** Response de cópia de conferência (sem cache em proxies compartilhados). */
function pdfConferencia(buffer: Uint8Array, filename: string): Response {
	return new Response(buffer as unknown as BodyInit, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': contentDisposition(filename),
			'Cache-Control': 'private, no-store'
		}
	});
}

export const GET: RequestHandler = async ({ platform, params, url, cookies, getClientAddress }) => {
	const db = getDB(platform);
	const hash = params.hash;

	if (!hash) return badRequest('Código de verificação ausente');

	// O PDF assinado ÍNTEGRO contém o manifesto forense (CPF, IP, GPS, selfie) e
	// fica RESTRITO a usuários autenticados. A página /validar continua pública e
	// prova a autenticidade (assinante, data, certificado, hash) sem expor o
	// forense. Validamos a sessão manualmente: a rota está no allowlist público do
	// hook (para manter a página e /api/validar/logo públicos), então
	// `locals.usuario` não é populado aqui.
	const usuario = await validarSessao(db, cookies.get('session_token'), platform).catch(() => null);
	if (!usuario) {
		return unauthorized('Faça login para baixar o documento assinado na íntegra.');
	}

	// Mesmo autenticado, limita varredura do hash por IP. Fail-closed em erro (AUT-016).
	const ip = getClientAddress();
	try {
		const { blocked } = await contarRecoveryAttempts(
			db,
			ip,
			'validar_download',
			VALIDAR_DOWNLOAD_WINDOW_MIN,
			VALIDAR_DOWNLOAD_MAX
		);
		if (blocked) {
			logger.warn('[validar/download] Rate-limit excedido', { hash });
			return rateLimited('Muitas validações a partir deste IP. Tente novamente em alguns minutos.');
		}
		await registrarRecoveryAttempt(db, ip, 'validar_download');
	} catch (err) {
		logger.error('[validar/download] Falha no rate-limit (fail-closed)', {
			hash,
			error: mensagemDeErro(err)
		});
		// FLW-AUT-016: D1 fora = não liberar enumeração do hash.
		return serverError('[validar/download] Rate-limit indisponível', err);
	}

	logger.info('[validar/download] Iniciando', { hash });

	const documento = await buscarDocumentoPorHash(db, hash);
	if (!documento) {
		logger.warn('[validar/download] Documento não encontrado', { hash });
		return notFound('Documento');
	}

	logger.info('[validar/download] Documento localizado', {
		hash,
		tipo: documento.tipo_doc,
		r2_key: documento.r2_key || null
	});

	const privilegiado = podeBaixarForense(usuario);

	// Usuários NÃO privilegiados nunca recebem o blob forense (manifesto com
	// CPF/IP/GPS/selfie). Recebem a cópia de conferência regenerada (sem manifesto)
	// + rodapé/QR para /validar. (gise_relatorio já cai no caminho de regeneração
	// manifest-free mais abaixo, então só tratamos escala/gise aqui.)
	if (!privilegiado) {
		const verificationUrl = `${url.origin}/validar/${hash}`;

		// Preferimos a cópia de conferência IDÊNTICA gravada no R2 na assinatura
		// (mesmos bytes do documento assinado), para todos os fluxos por token. Só
		// quando ela não existe (legado / falha na preparação) regeneramos abaixo.
		{
			const r2 = tryGetR2(platform);
			if (r2) {
				const confObj = await r2.get(chaveConferencia(hash));
				if (confObj) {
					const nome =
						documento.tipo_doc === 'escala'
							? `conferencia_escala_${hash}.pdf`
							: documento.tipo_doc === 'gise'
								? `conferencia_gise_${hash}.pdf`
								: documento.tipo_doc === 'gise_relatorio'
									? `conferencia_relatorio_${hash}.pdf`
									: `conferencia_presenca_${hash}.pdf`;
					return pdfConferencia(new Uint8Array(await confObj.arrayBuffer()), nome);
				}
			}
		}

		if (documento.tipo_doc === 'escala') {
			const { buscarEscala, listarPoliciaisEscala, buscarRubricaAssinante } =
				await import('$lib/db');
			const { gerarRascunhoEscalaPdf } = await import('$lib/server/assinatura/conferencia-pdf');
			const escala = await buscarEscala(db, documento.escala_id);
			if (!escala) return notFound('Escala');
			const policiais = await listarPoliciaisEscala(db, documento.escala_id);
			// Rubrica do signatário acima da linha (igual ao documento digital).
			const rubricaAss = await buscarRubricaAssinante(
				db,
				(documento as { assinante_cpf?: string | null }).assinante_cpf,
				platform?.env
			);
			const rascunho = await gerarRascunhoEscalaPdf(escala, policiais, platform, rubricaAss);
			const buffer = await gerarCopiaConferencia({
				pdfRascunho: rascunho,
				assinanteNome: documento.assinante_nome,
				verificationHash: hash,
				verificationUrl
			});
			return pdfConferencia(buffer, `conferencia_escala_${hash}.pdf`);
		}
		if (documento.tipo_doc === 'gise') {
			const { buscarGiseDetalhado } = await import('$lib/db');
			const { gerarRascunhoGisePdf } = await import('$lib/server/assinatura/conferencia-pdf');
			const gise = await buscarGiseDetalhado(db, documento.escala_id);
			if (!gise) return notFound('GISE');
			const rascunho = await gerarRascunhoGisePdf(db, gise, platform);
			const buffer = await gerarCopiaConferencia({
				pdfRascunho: rascunho,
				assinanteNome: documento.assinante_nome,
				verificationHash: hash,
				verificationUrl
			});
			return pdfConferencia(buffer, `conferencia_gise_${hash}.pdf`);
		}
		// gise_relatorio: segue para a regeneração manifest-free abaixo.
	}

	// Blob forense do R2 — somente privilegiado chega aqui com r2_key.
	if (privilegiado && documento.r2_key) {
		const r2 = tryGetR2(platform);
		if (r2) {
			try {
				const obj = await r2.get(documento.r2_key);
				if (obj) {
					// Acesso forense (PII: CPF/IP/GPS/selfie) pelo Super Admin — auditar.
					await registrarAuditComContexto(db, {
						usuario,
						acao: 'download_validar_forense',
						entidade: documento.tipo_doc,
						entidade_id: documento.escala_id,
						detalhes: `hash=${hash}`,
						ip
					});
					logger.info('[validar/download] PDF recuperado do R2', {
						hash,
						r2_key: documento.r2_key
					});
					const arrayBuffer = await obj.arrayBuffer();
					const resHeaders = new Headers();
					resHeaders.set('Content-Type', 'application/pdf');

					const filename =
						documento.tipo_doc === 'gise_relatorio'
							? `relatorio_${documento.rel_tipo}_${hash}.pdf`
							: `documento_assinado_${hash}.pdf`;

					resHeaders.set('Content-Disposition', contentDisposition(filename));
					// PII sensível (nome/CPF/IP/GPS no manifesto): NUNCA cachear em
					// CDN/edge nem em proxies compartilhados — isso espalharia o PDF a
					// qualquer um E contornaria o rate-limit (hits servidos do cache não
					// chegam à origem, logo não contam). `private, no-store` mantém o
					// controle no servidor; o custo é reler do R2, aceitável no baixo
					// volume de validação.
					resHeaders.set('Cache-Control', 'private, no-store');
					return new Response(arrayBuffer, {
						headers: resHeaders,
						status: 200
					});
				} else {
					logger.warn('[validar/download] R2 key existe mas arquivo ausente', {
						hash,
						r2_key: documento.r2_key
					});
				}
			} catch (r2Err) {
				logger.error('[validar/download] Erro ao acessar R2', {
					hash,
					r2_key: documento.r2_key,
					error: mensagemDeErro(r2Err)
				});
			}
		} else {
			logger.warn('[validar/download] R2 binding ausente no platform.env', { hash });
		}
	}

	// Se for gise_relatorio e não encontramos no R2 (legado ou erro de sync), geramos na hora
	if (documento.tipo_doc === 'gise_relatorio') {
		logger.info('[validar/download] Re-geração dinâmica de relatório GISE', { hash });
		try {
			const {
				buscarGiseDetalhado,
				buscarPresencasGise,
				buscarRespostasProdutividadeSeccional,
				buscarAssinaturaRelatorioGise
			} = await import('$lib/db');
			const { gerarPdfRelatorioExtraordinario, gerarRelatorioProdutividadeGisePdf } =
				await import('$lib/server/export');
			const { getBreveRelatorioEnvMergido } = await import('$lib/server/gise/breve-relatorio-env');
			const { secIdEhSupervisaoExtra } = await import('$lib/server/gise/supervisao-extra');
			const { adicionarRodapeSimples } = await import('$lib/server/assinatura/pdf-signing');
			const gise = await buscarGiseDetalhado(db, documento.escala_id);
			if (!gise) {
				logger.error('[validar/download] GISE ausente para re-geração', {
					hash,
					escala_id: documento.escala_id
				});
				return notFound('GISE');
			}

			// Depois da escala, e não antes: os textos do breve relatório dependem da
			// OPERAÇÃO dela, e este PDF é uma re-geração de documento já validado —
			// sair com o parágrafo de outra operação seria divergir do que foi assinado.
			const brEnv = await getBreveRelatorioEnvMergido(db, gise.operacao_id);

			const seccionalId = documento.seccional_id;
			const relTipo = documento.rel_tipo;

			// Buscar a assinatura original para garantir que as rubricas/certificação apareçam
			const reportSignature = await buscarAssinaturaRelatorioGise(
				db,
				documento.escala_id,
				seccionalId,
				relTipo
			);

			let finalPdf: Uint8Array;

			if (relTipo === 'extraordinario') {
				const presencas = await buscarPresencasGise(db, documento.escala_id, platform?.env);
				const isSupExtra = await secIdEhSupervisaoExtra(db, seccionalId);
				const { esq: logoEsq, dir: logoDir } = await carregarLogosGise(platform);
				const result = await gerarPdfRelatorioExtraordinario({
					isSupExtra,
					gise,
					presencas,
					seccionalId,
					baseUrl: url.origin,
					brEnv,
					logoEsqBytes: logoEsq,
					logoDirBytes: logoDir,
					reportSignature
				});
				finalPdf = result.pdf;
			} else {
				const seccional = gise.seccionais.find(
					(s) => s.id === seccionalId || s.seccional_id === seccionalId
				);
				if (!seccional) {
					logger.error('[validar/download] Seccional ausente na GISE', {
						hash,
						seccional_id: seccionalId
					});
					return notFound('Seccional');
				}

				const respostas = await buscarRespostasProdutividadeSeccional(
					db,
					documento.escala_id,
					seccional.id
				);
				const result = gerarRelatorioProdutividadeGisePdf({ gise, seccional, respostas });
				finalPdf = result.pdf;
			}

			// Aplicar o rodapé de certificação estilo GISE (QR Code e Hash)
			if (reportSignature) {
				const qrUrl = `${url.origin}/validar/${hash}`;
				finalPdf = await adicionarRodapeSimples(finalPdf, reportSignature.assinante_nome, {
					verificationHash: hash,
					verificationUrl: qrUrl,
					rubricBase64: reportSignature.rubrica ?? undefined
				});
			}

			logger.info('[validar/download] Re-geração dinâmica concluída', { hash });
			const filename = `relatorio_${relTipo}_${hash}.pdf`;
			return new Response(finalPdf as unknown as BodyInit, {
				headers: {
					'Content-Type': 'application/pdf',
					'Content-Disposition': contentDisposition(filename),
					// PII no relatório: não cachear em CDN/proxies compartilhados.
					'Cache-Control': 'private, no-store'
				}
			});
		} catch (err) {
			return serverError(
				`[validar/download] Falha crítica na geração dinâmica (hash=${hash})`,
				err
			);
		}
	}

	logger.error('[validar/download] PDF indisponível em todas as fontes', { hash });
	return notFound('Arquivo PDF para este documento');
};
