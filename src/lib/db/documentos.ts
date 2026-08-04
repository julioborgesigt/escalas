/**
 * Documentos assinados das ESCALAS (`escala_documentos`) e a busca pelo código
 * de validação, que atravessa todos os tipos de documento do sistema.
 *
 * `escala_documentos` tem no máximo UMA linha por escala: assinar de novo
 * substitui a anterior por inteiro (upsert com `created_at` renovado), porque a
 * escala só tem uma versão vigente. O histórico de quem assinou o quê fica na
 * auditoria, não aqui.
 *
 * Minimização LGPD aplicada na gravação, não na exibição — o dado bruto nunca
 * chega ao banco: CPF cifrado, IP anonimizado, user-agent reduzido a
 * navegador/SO (com o original truncado em 1 KB para perícia) e GPS arredondado
 * para ~1 km. Assinar prova identidade e circunstância; não é vigilância.
 */
import { eq, sql } from 'drizzle-orm';
import { escalaDocumentos, giseDocumentos } from '../server/schema';
import type * as schema from '../server/schema';
import type { Database } from './core';
import * as fullSchema from '../server/schema';
import { cifrarCpfParaArmazenar, type CpfCriptoEnv } from '../crypto/cpf-cripto';
import { anonimizarIp } from './audit';
import { parseUserAgent, reduzirPrecisaoGps } from '../server/assinatura/document-utils';

/**
 * Metadados criptográficos persistidos junto com a assinatura (CAdES-LT).
 * Campos opcionais; signatures avançadas/simples passam undefined.
 */
export interface AssinaturaCadesMetadata {
	cert_issuer?: string;
	cert_serial?: string;
	cert_valido_de?: string;
	cert_valido_ate?: string;
	cms_sha256?: string;
	ocsp_response_b64?: string;
	ocsp_consultado_em?: string;
	tst_token_b64?: string;
}

/**
 * Registra (ou substitui) a assinatura da escala. Recebe os dados brutos e
 * aplica a minimização descrita no cabeçalho — nenhum chamador precisa lembrar
 * de cifrar CPF ou anonimizar IP.
 *
 * A lista de campos é montada UMA vez e usada no INSERT e no UPDATE do upsert.
 * Quando eram duas listas lado a lado, uma coluna nova acrescentada só ao
 * INSERT sobrevivia à primeira assinatura e desaparecia na reassinatura, sem
 * erro nenhum — travado por teste em `__tests__/upserts-assinatura.test.ts`.
 *
 * `cadesMeta` só vem preenchido na assinatura com certificado (CAdES-LT: cadeia,
 * OCSP e carimbo de tempo). Assinatura simples passa `undefined` e as colunas
 * ficam nulas — é o que distingue os dois níveis na tela de validação.
 *
 * Não escreve auditoria nem toca no R2: o blob já foi gravado quando esta função
 * é chamada, e é o `r2_key` daqui que o torna localizável.
 */
export async function salvarDocumentoEscala(
	db: Database,
	escalaId: number,
	r2Key: string,
	assinanteNome: string,
	assinanteCpf?: string,
	verificacaoHash?: string,
	ipAddress?: string,
	userAgent?: string,
	latitude?: number,
	longitude?: number,
	selfieKey?: string,
	arquivoHash?: string,
	assinanteEmail?: string,
	tipoCarimboTempo?: string,
	cadesMeta?: AssinaturaCadesMetadata,
	env?: CpfCriptoEnv
) {
	const meta = cadesMeta ?? {};
	// CPF cifrado em repouso (LGPD Fase 2).
	const cpfArmazenado = (await cifrarCpfParaArmazenar(assinanteCpf, env)) ?? '';

	// Mesmos campos no INSERT e no UPDATE do upsert — montados uma vez para não
	// divergirem. `escala_id` fica de fora: é o alvo do conflito.
	//
	// Campo opcional vira `null` EXPLÍCITO, nunca `undefined`: o drizzle omite
	// chave `undefined` do `.set()`, e aí a coluna da assinatura ANTERIOR
	// sobrevive à reassinatura (certificado, selfie e GPS de outra assinatura
	// colados no registro da nova).
	const dados = {
		r2_key: r2Key,
		assinante_nome: assinanteNome,
		assinante_cpf: cpfArmazenado,
		verificacao_hash: verificacaoHash ?? null,
		selfie_key: selfieKey ?? null,
		arquivo_hash: arquivoHash ?? null,
		ip_address: anonimizarIp(ipAddress) ?? null,
		user_agent: userAgent ? parseUserAgent(userAgent) : null,
		user_agent_raw: userAgent ? userAgent.slice(0, 1024) : null,
		latitude: reduzirPrecisaoGps(latitude) ?? null,
		longitude: reduzirPrecisaoGps(longitude) ?? null,
		assinante_email: assinanteEmail ?? null,
		tipo_carimbo_tempo: tipoCarimboTempo || 'servidor',
		cert_issuer: meta.cert_issuer ?? null,
		cert_serial: meta.cert_serial ?? null,
		cert_valido_de: meta.cert_valido_de ?? null,
		cert_valido_ate: meta.cert_valido_ate ?? null,
		cms_sha256: meta.cms_sha256 ?? null,
		ocsp_response_b64: meta.ocsp_response_b64 ?? null,
		ocsp_consultado_em: meta.ocsp_consultado_em ?? null,
		tst_token_b64: meta.tst_token_b64 ?? null
	};

	return db
		.insert(escalaDocumentos)
		.values({ escala_id: escalaId, ...dados })
		.onConflictDoUpdate({
			target: escalaDocumentos.escala_id,
			// Reassinatura substitui o documento anterior por inteiro.
			set: { ...dados, created_at: sql`datetime('now', '-3 hours')` }
		});
}

/**
 * A assinatura vigente da escala, ou `undefined` se ela ainda não foi assinada
 * — é assim que as telas distinguem "rascunho" de "documento oficial".
 * O `assinante_cpf` sai CIFRADO; use `decifrarCpfDoDB` para exibir.
 */
export async function buscarDocumentoEscala(
	db: Database,
	escalaId: number
): Promise<schema.EscalaDocumento | undefined> {
	return db.select().from(escalaDocumentos).where(eq(escalaDocumentos.escala_id, escalaId)).get();
}

/**
 * Revoga a assinatura apagando a linha — a escala volta a ser editável.
 *
 * Só a LINHA: o PDF e a selfie no R2 continuam lá se o chamador não os remover,
 * e sem esta linha ninguém mais sabe que existem (R2-2/R2-3). Limpe o R2 antes.
 */
export async function excluirDocumentoEscala(db: Database, escalaId: number) {
	return db.delete(escalaDocumentos).where(eq(escalaDocumentos.escala_id, escalaId));
}

/**
 * Resolve um código de validação (`gerarCodigoValidacao`, impresso no rodapé do
 * PDF) para o documento correspondente — o coração da rota PÚBLICA
 * `/validar/[hash]`, onde qualquer pessoa confere um papel que recebeu.
 *
 * O mesmo código pode pertencer a quatro documentos diferentes, cada um em sua
 * tabela: escala assinada, escala GISE, relatório de seccional e termo de
 * presença. As quatro consultas vão em paralelo (uma ida ao banco em vez de
 * quatro em série, e a rota é pública, logo o custo é do pior caso).
 *
 * O retorno é NORMALIZADO num formato comum — `escala_id`, `r2_key`,
 * `arquivo_hash` e um discriminante `tipo_doc` — para que a página de validação
 * tenha um só caminho de verificação criptográfica. Os campos precisam ser
 * listados um a um porque cada tabela nomeia a sua chave de outro jeito
 * (`gise_id`, `verification_hash`) e traz colunas que ali não fazem sentido.
 *
 * `undefined` cobre dois casos que a rota não distingue — código inexistente e
 * documento revogado (revogar apaga a linha) — e é bom que seja assim: separar
 * os dois daria a quem tenta adivinhar códigos a informação de que um documento
 * existiu.
 */
export async function buscarDocumentoPorHash(db: Database, hash: string) {
	// Query all 4 tables in parallel instead of sequentially
	const [esc, gise, rel, termo] = await Promise.all([
		db.select().from(escalaDocumentos).where(eq(escalaDocumentos.verificacao_hash, hash)).get(),
		db.select().from(giseDocumentos).where(eq(giseDocumentos.verificacao_hash, hash)).get(),
		db
			.select()
			.from(fullSchema.giseAssinaturasRelatorios)
			.where(eq(fullSchema.giseAssinaturasRelatorios.verification_hash, hash))
			.get(),
		db
			.select()
			.from(fullSchema.gisePresencaTermos)
			.where(eq(fullSchema.gisePresencaTermos.verification_hash, hash))
			.get()
	]);

	if (esc) return { ...esc, tipo_doc: 'escala' as const };
	if (gise)
		return { ...gise, escala_id: gise.gise_id, r2_key: gise.r2_key, tipo_doc: 'gise' as const };
	if (termo) {
		// Termo de presença (Token A3 no desktop). Tipo qualificado: a verificação
		// criptográfica em /validar usa r2_key + arquivo_hash + cms_sha256.
		return {
			id: termo.id,
			escala_id: termo.gise_id,
			assinante_nome: termo.assinante_nome,
			assinante_cpf: termo.assinante_cpf,
			assinante_email: termo.assinante_email,
			created_at: termo.created_at,
			tipo_doc: 'gise_presenca' as const,
			presenca_tipo: termo.tipo,
			tipo_assinatura: 'serpro' as const,
			ip_address: termo.ip_address,
			user_agent: termo.user_agent,
			latitude: termo.latitude,
			longitude: termo.longitude,
			r2_key: termo.r2_key,
			arquivo_hash: termo.arquivo_hash,
			tipo_carimbo_tempo: termo.tipo_carimbo_tempo,
			cert_issuer: termo.cert_issuer,
			cert_serial: termo.cert_serial,
			cert_valido_de: termo.cert_valido_de,
			cert_valido_ate: termo.cert_valido_ate,
			cms_sha256: termo.cms_sha256,
			ocsp_response_b64: termo.ocsp_response_b64,
			ocsp_consultado_em: termo.ocsp_consultado_em,
			tst_token_b64: termo.tst_token_b64
		};
	}
	if (rel) {
		return {
			id: rel.id,
			escala_id: rel.gise_id,
			assinante_nome: rel.assinante_nome,
			assinante_cpf: rel.assinante_cpf,
			created_at: rel.created_at,
			tipo_doc: 'gise_relatorio' as const,
			rel_tipo: rel.tipo,
			tipo_assinatura: rel.tipo_assinatura,
			seccional_id: rel.seccional_id,
			ip_address: rel.ip_address,
			user_agent: rel.user_agent,
			latitude: rel.latitude,
			longitude: rel.longitude,
			r2_key: rel.r2_key,
			arquivo_hash: rel.arquivo_hash,
			tipo_carimbo_tempo: rel.tipo_carimbo_tempo,
			cert_issuer: rel.cert_issuer,
			cert_serial: rel.cert_serial,
			cert_valido_de: rel.cert_valido_de,
			cert_valido_ate: rel.cert_valido_ate,
			cms_sha256: rel.cms_sha256,
			ocsp_response_b64: rel.ocsp_response_b64,
			ocsp_consultado_em: rel.ocsp_consultado_em,
			tst_token_b64: rel.tst_token_b64
		};
	}

	return undefined;
}
