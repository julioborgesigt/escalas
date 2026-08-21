/**
 * Documentos assinados das ESCALAS (`escala_documentos`) e a busca pelo código
 * de validação, que atravessa todos os tipos de documento do sistema.
 *
 * `escala_documentos` tem no máximo UMA linha por escala. O UNIQUE em
 * `escala_id` é a tranca: o segundo INSERT não grava (SEC-32). Reassinar
 * exige revogar antes (DELETE) — o upsert antigo sobrescrevia o documento
 * jurídico na corrida entre dois `finalizar`.
 *
 * Minimização LGPD aplicada na gravação, não na exibição — o dado bruto nunca
 * chega ao banco: CPF cifrado, IP anonimizado, user-agent reduzido a
 * navegador/SO (com o original truncado em 1 KB para perícia) e GPS arredondado
 * para ~1 km. Assinar prova identidade e circunstância; não é vigilância.
 */
import { eq } from 'drizzle-orm';
import { escalaDocumentos, giseDocumentos } from '../server/schema';
import type * as schema from '../server/schema';
import type { Database } from './core';
import { linhasAfetadas } from './core';
import * as fullSchema from '../server/schema';
import { cifrarCpfParaArmazenar, type CpfCriptoEnv } from '../crypto/cpf-cripto';
import { anonimizarIp } from './audit';
import { parseUserAgent, reduzirPrecisaoGps } from '../server/assinatura/document-utils';

/**
 * Metadados criptográficos persistidos junto com a assinatura (CAdES-LT).
 * Campos opcionais; signatures avançadas/simples passam undefined.
 */
/**
 * Artefatos da asserção WebAuthn, guardados para RECONFERÊNCIA.
 *
 * Sem eles, o manifesto do PDF afirmaria "assinado com chave verificada por
 * biometria" e o sistema não conservaria com o que provar isso depois — a
 * mesma classe de problema que a política de dispositivo tinha ao prometer na
 * tela o que o servidor não aplicava. O fluxo QUALIFICADO já guarda os seus
 * artefatos (`cms_sha256`, `ocsp_response_b64`, `tst_token_b64`) exatamente
 * por essa razão; este é o equivalente do caminho da passkey.
 *
 * Nada aqui é dado pessoal novo: `clientDataJSON` traz type/challenge/origin,
 * `authenticatorData` traz hash do domínio, flags, contador e AAGUID (o MODELO
 * do autenticador, não o aparelho), e a assinatura é opaca.
 */
export interface AssinaturaPasskeyMetadata {
	/** Credencial que assinou, em base64url. */
	credential_id: string;
	/** `clientDataJSON` cru, base64url — contém o desafio (hash do PDF). */
	client_data: string;
	/** `authenticatorData` cru, base64url — flags UV/BE/BS e contador. */
	authenticator_data: string;
	/** Assinatura ECDSA em DER, base64url. */
	assinatura: string;
	/** Flag BS no momento da assinatura: a credencial estava sincronizada. */
	backup_ativo: boolean;
}

/**
 * Monta o dossiê a gravar a partir da asserção conferida ao vivo.
 *
 * Os quatro campos binários já vêm em base64url do cliente — é o mesmo
 * alfabeto que `reconferirAssercaoDocumento` espera. Sem este helper, cada
 * `finalizar` copiava o mapeamento à mão e um nome divergente (ex.:
 * `client_data` vs `clientData`) nascia invisível até a reconferência falhar.
 */
export function passkeyMetaDeAssercao(
	assercao: {
		credentialId: string;
		clientDataJSON: string;
		authenticatorData: string;
		assinatura: string;
	},
	backupAtivo: boolean
): AssinaturaPasskeyMetadata {
	return {
		credential_id: assercao.credentialId,
		client_data: assercao.clientDataJSON,
		authenticator_data: assercao.authenticatorData,
		assinatura: assercao.assinatura,
		backup_ativo: backupAtivo
	};
}

export interface AssinaturaCadesMetadata {
	cert_issuer?: string | null;
	cert_serial?: string | null;
	cert_valido_de?: string | null;
	cert_valido_ate?: string | null;
	cms_sha256?: string | null;
	ocsp_response_b64?: string | null;
	ocsp_consultado_em?: string | null;
	tst_token_b64?: string | null;
}

/** Colunas com nome IDÊNTICO nas quatro tabelas de documento assinado (escala,
 *  GISE, relatório de seccional, termo de presença) — ver `montarCamposMinimizados`. */
export interface CamposMinimizadosDocumento {
	ip_address: string | null;
	user_agent: string | null;
	user_agent_raw: string | null;
	latitude: number | null;
	longitude: number | null;
	tipo_carimbo_tempo: string;
	cert_issuer: string | null;
	cert_serial: string | null;
	cert_valido_de: string | null;
	cert_valido_ate: string | null;
	cms_sha256: string | null;
	ocsp_response_b64: string | null;
	ocsp_consultado_em: string | null;
	tst_token_b64: string | null;
	webauthn_credential_id: string | null;
	webauthn_client_data: string | null;
	webauthn_authenticator_data: string | null;
	webauthn_assinatura: string | null;
	webauthn_backup_ativo: number | null;
}

/**
 * Minimização LGPD + dossiê CAdES/WebAuthn comum aos quatro pontos que gravam
 * documento assinado (`salvarDocumentoEscala`, `salvarGiseDocumento`,
 * `salvarAssinaturaRelatorioGise`, `salvarTermoPresencaGise`). Cada campo
 * opcional vira `null` EXPLÍCITO, nunca `undefined`: o INSERT precisa das
 * colunas presentes, e um UPDATE futuro (revogar-e-assinar) não pode herdar
 * certificado, selfie ou GPS da assinatura anterior se a chave faltar.
 */
export function montarCamposMinimizados(opts: CircunstanciaAssinatura): CamposMinimizadosDocumento {
	const meta = opts.cadesMeta ?? {};
	return {
		ip_address: anonimizarIp(opts.ipAddress) ?? null,
		user_agent: opts.userAgent ? parseUserAgent(opts.userAgent) : null,
		user_agent_raw: opts.userAgent ? opts.userAgent.slice(0, 1024) : null,
		latitude: reduzirPrecisaoGps(opts.latitude) ?? null,
		longitude: reduzirPrecisaoGps(opts.longitude) ?? null,
		tipo_carimbo_tempo: opts.tipoCarimboTempo || 'servidor',
		cert_issuer: meta.cert_issuer ?? null,
		cert_serial: meta.cert_serial ?? null,
		cert_valido_de: meta.cert_valido_de ?? null,
		cert_valido_ate: meta.cert_valido_ate ?? null,
		cms_sha256: meta.cms_sha256 ?? null,
		ocsp_response_b64: meta.ocsp_response_b64 ?? null,
		ocsp_consultado_em: meta.ocsp_consultado_em ?? null,
		tst_token_b64: meta.tst_token_b64 ?? null,
		webauthn_credential_id: opts.passkeyMeta?.credential_id ?? null,
		webauthn_client_data: opts.passkeyMeta?.client_data ?? null,
		webauthn_authenticator_data: opts.passkeyMeta?.authenticator_data ?? null,
		webauthn_assinatura: opts.passkeyMeta?.assinatura ?? null,
		webauthn_backup_ativo: opts.passkeyMeta ? (opts.passkeyMeta.backup_ativo ? 1 : 0) : null
	};
}

/**
 * Insere a assinatura da escala. UNIQUE em `escala_id` recusa o segundo
 * INSERT (SEC-32) — reassinar exige revogar antes. Recebe os dados brutos e
 * aplica a minimização descrita no cabeçalho — nenhum chamador precisa lembrar
 * de cifrar CPF ou anonimizar IP.
 *
 * `cadesMeta` só vem preenchido na assinatura com certificado (CAdES-LT: cadeia,
 * OCSP e carimbo de tempo). Assinatura simples passa `undefined` e as colunas
 * ficam nulas — é o que distingue os dois níveis na tela de validação.
 *
 * Não escreve auditoria nem toca no R2: o blob já foi gravado quando esta função
 * é chamada, e é o `r2_key` daqui que o torna localizável.
 */
/**
 * O que se grava numa assinatura de escala. NOMEADO, e isso é decisão.
 *
 * Eram 17 parâmetros posicionais, e o comentário que morava aqui avisava do
 * risco sem removê-lo: inserir um campo no meio deslocaria todo chamador que
 * passasse `env`, e "num upsert de documento assinado, um deslocamento
 * silencioso grava o campo errado". Os call sites passavam `undefined` nu em
 * posições que só se identificavam contando — um deles precisou de
 * `// selfieKey` ao lado para ser legível.
 *
 * Com objeto nomeado o compilador confere cada campo, campo ausente é ausente
 * (e não uma posição que alguém contou errado), e acrescentar coluna deixa de
 * ter ordem. Mesma jogada de `nomeia os 9 parâmetros posicionais do relatório
 * extraordinário`, pelo mesmo motivo.
 */
/**
 * A CIRCUNSTÂNCIA da assinatura — o que o documento registra além de quem
 * assinou: onde, em que aparelho, com qual prova e sob qual carimbo.
 *
 * É exatamente o conjunto que `montarCamposMinimizados` recebe (mais `env`,
 * que é a chave de cifra do CPF), e por isso vive num tipo só: escala e GISE
 * gravam em tabelas diferentes, com colunas de identidade diferentes, mas a
 * circunstância é a MESMA — e é justamente a parte sujeita à minimização LGPD,
 * onde divergir sai caro.
 */
export interface CircunstanciaAssinatura {
	ipAddress?: string;
	userAgent?: string;
	latitude?: number;
	longitude?: number;
	selfieKey?: string;
	arquivoHash?: string;
	assinanteEmail?: string;
	tipoCarimboTempo?: string;
	cadesMeta?: AssinaturaCadesMetadata;
	passkeyMeta?: AssinaturaPasskeyMetadata;
	/** Chave de cifra do CPF (LGPD Fase 2); sem ela o valor vai como está. */
	env?: CpfCriptoEnv;
}

export interface DocumentoEscalaEntrada extends CircunstanciaAssinatura {
	escalaId: number;
	r2Key: string;
	assinanteNome: string;
	assinanteCpf?: string;
	verificacaoHash?: string;
}

export async function salvarDocumentoEscala(db: Database, entrada: DocumentoEscalaEntrada) {
	const {
		escalaId,
		r2Key,
		assinanteNome,
		assinanteCpf,
		verificacaoHash,
		selfieKey,
		arquivoHash,
		assinanteEmail
	} = entrada;

	// CPF cifrado em repouso (LGPD Fase 2).
	const cpfArmazenado = (await cifrarCpfParaArmazenar(assinanteCpf, entrada.env)) ?? '';

	const dados = {
		r2_key: r2Key,
		assinante_nome: assinanteNome,
		assinante_cpf: cpfArmazenado,
		verificacao_hash: verificacaoHash ?? null,
		selfie_key: selfieKey ?? null,
		arquivo_hash: arquivoHash ?? null,
		assinante_email: assinanteEmail ?? null,
		// `entrada` já TEM a forma de `CircunstanciaAssinatura` — passar o objeto
		// inteiro evita repetir a lista de campos, que é onde escala e GISE
		// divergiriam em silêncio.
		...montarCamposMinimizados(entrada)
	};

	const r = await db
		.insert(escalaDocumentos)
		.values({ escala_id: escalaId, ...dados })
		.onConflictDoNothing();
	return { gravado: linhasAfetadas(r) > 0 };
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
			tst_token_b64: termo.tst_token_b64,
			webauthn_credential_id: termo.webauthn_credential_id
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
			tst_token_b64: rel.tst_token_b64,
			webauthn_credential_id: rel.webauthn_credential_id
		};
	}

	return undefined;
}
