/**
 * Schema Drizzle de TODAS as tabelas do D1 — fonte única de tipos do servidor.
 * Os `$inferSelect`/`$inferInsert` do fim do arquivo são o que o resto do
 * código importa; `lib/db/` nunca redeclara a forma de uma linha.
 *
 * ESTE ARQUIVO NÃO CRIA TABELA. Editar aqui só muda o TIPO — o banco continua
 * como estava até alguém escrever o `.sql` correspondente em `migrations/` e
 * rodar `npm run db:migrate` (o runner é `scripts/migrate.ts`, com controle em
 * `_migrations_aplicadas`). Uma coluna que existe aqui e não na migração
 * compila, passa no `check` e só falha em runtime, no primeiro SELECT.
 *
 * As migrações hoje são ESCRITAS À MÃO. O `drizzle.config.ts` ainda aponta para
 * cá e as 12 primeiras saíram do `drizzle-kit`, mas não há script de `generate`
 * e o journal dele foi removido em jul/2026 — quem decide o que já rodou é
 * `_migrations_aplicadas`. O motivo é o SQLite do D1: quase todo ALTER de
 * verdade é um rebuild de tabela (criar nova, copiar, dropar, renomear), que o
 * gerador não produz. Numerar em sequência (`00NN_descrição.sql`) é obrigatório
 * — o runner ordena por nome de arquivo.
 *
 * A maior parte das colunas `*_id` NÃO tem FK declarada, e isso é deliberado em
 * dois casos: referência polimórfica (o mesmo `*_id` aponta para tabelas
 * diferentes conforme o tipo) e preservação de prova — assinatura, presença e
 * auditoria copiam nome/CPF/matrícula para a própria linha justamente para
 * continuarem válidas depois que o cadastro do policial some. Um CASCADE ali
 * apagaria a evidência.
 */
import { sqliteTable, text, integer, real, index, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ---- Policiais ----

export const policiais = sqliteTable(
	'policiais',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		nome: text('nome').notNull(),
		matricula: text('matricula').notNull().unique(),
		cargo: text('cargo', { enum: ['DPC', 'OIP'] }).notNull(),
		cpf: text('cpf'),
		telefone: text('telefone'),
		lotacao: text('lotacao').notNull(),
		ativo: integer('ativo').notNull().default(1),
		regime: text('regime', { enum: ['plantao', 'expediente'] })
			.notNull()
			.default('plantao'),
		classe: text('classe').notNull().default(''),
		senha: text('senha').notNull(),
		email: text('email'),
		email_pessoal: text('email_pessoal'),
		email_pessoal_verificado: integer('email_pessoal_verificado').notNull().default(0),
		primeiro_acesso: integer('primeiro_acesso').notNull().default(1),
		// RBAC operacional (cumulativo com Admin Geral, que é a linha vinculada em
		// `administradores`): papel scoped do servidor.
		papel: text('papel', { enum: ['admin_seccional', 'admin_unidade'] }),
		// Unidade/Seccional sob responsabilidade do papel (FK a unidades.id)
		papel_unidade_id: integer('papel_unidade_id'),
		// Achado LGPD: `cpf` guarda o CPF cifrado (AES-GCM, `enc:v1:...`); este é
		// o índice cego HMAC para lookup (login por certificado) sem decifrar.
		cpf_index: text('cpf_index'),
		// Rubrica reutilizável (PNG transparente em dataURL) cadastrada pelo policial
		// para assinatura por Token A3 no computador. LGPD: nova finalidade com
		// consentimento próprio (`rubrica_consentimento_em`); excluível pelo titular.
		rubrica: text('rubrica'),
		rubrica_atualizada_em: text('rubrica_atualizada_em'),
		rubrica_consentimento_em: text('rubrica_consentimento_em'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`),
		updated_at: text('updated_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_policiais_lotacao').on(table.lotacao),
		index('idx_policiais_cargo').on(table.cargo),
		index('idx_policiais_ativo').on(table.ativo),
		index('idx_policiais_cpf_index').on(table.cpf_index)
	]
);

// ---- Escalas ----

export const escalas = sqliteTable(
	'escalas',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		titulo: text('titulo').notNull(),
		cidade: text('cidade').notNull(),
		data_inicio: text('data_inicio').notNull(),
		data_fim: text('data_fim').notNull(),
		horario: text('horario').notNull().default('08H A 08H'),
		hora_entrada: text('hora_entrada').notNull().default('08'),
		hora_saida: text('hora_saida').notNull().default('08'),
		lotacao: text('lotacao').notNull().default(''),
		tipo: text('tipo', { enum: ['plantao', 'expediente', 'fds'] }),
		visto_por_admin: integer('visto_por_admin').notNull().default(0),
		finalizada_em: text('finalizada_em'),
		email_envio: text('email_envio'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_escalas_lotacao').on(table.lotacao),
		index('idx_escalas_created_at').on(table.created_at),
		index('idx_escalas_data_inicio').on(table.data_inicio),
		index('idx_escalas_tipo').on(table.tipo),
		index('idx_escalas_lotacao_tipo_data').on(table.lotacao, table.tipo, table.data_inicio)
	]
);

// ---- Escala Policiais ----

export const escalaPoliciais = sqliteTable(
	'escala_policiais',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		escala_id: integer('escala_id')
			.notNull()
			.references(() => escalas.id, { onDelete: 'cascade' }),
		policial_id: integer('policial_id')
			.notNull()
			.references(() => policiais.id, { onDelete: 'cascade' }),
		data_plantao: text('data_plantao').notNull(),
		data_saida: text('data_saida').notNull().default(''),
		horario: text('horario').notNull().default(''),
		hora_entrada: text('hora_entrada').notNull().default(''),
		hora_saida: text('hora_saida').notNull().default(''),
		observacoes: text('observacoes').notNull().default(''),
		equipe: text('equipe').notNull().default('')
	},
	(table) => [
		index('idx_escala_policiais_escala').on(table.escala_id),
		index('idx_escala_policiais_policial').on(table.policial_id),
		index('idx_escala_policiais_escala_policial').on(table.escala_id, table.policial_id),
		// Conflito de plantão filtra por (policial, data) — ver migration 0030
		index('idx_escala_policiais_policial_data').on(table.policial_id, table.data_plantao)
	]
);

// ---- Administradores ----

export const administradores = sqliteTable('administradores', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	login: text('login').notNull().unique(),
	senha: text('senha').notNull(),
	nome: text('nome').notNull(),
	email: text('email'),
	email_pessoal: text('email_pessoal'),
	email_pessoal_verificado: integer('email_pessoal_verificado').notNull().default(0),
	primeiro_acesso: integer('primeiro_acesso').notNull().default(1),
	// Admin Geral VINCULADO: quando preenchido, esta conta admin não tem senha
	// própria — o login autentica contra as credenciais do policial vinculado
	// (mesma senha/e-mail/2FA). Nulo = admin standalone (bootstrap por env).
	policial_id: integer('policial_id'),
	created_at: text('created_at').default(sql`(datetime('now', '-3 hours'))`)
});

// ---- Sessoes ----

export const sessoes = sqliteTable(
	'sessoes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		token: text('token').notNull().unique(),
		tipo: text('tipo', { enum: ['policial', 'admin'] }).notNull(),
		usuario_id: integer('usuario_id').notNull(),
		created_at: text('created_at').default(sql`(datetime('now', '-3 hours'))`),
		expires_at: text('expires_at').notNull()
	},
	(table) => [
		index('idx_sessoes_token').on(table.token),
		index('idx_sessoes_expires').on(table.expires_at)
	]
);

// ---- Unidades ----

export const unidades = sqliteTable(
	'unidades',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		nome: text('nome').notNull().unique(),
		tipo: text('tipo', {
			enum: ['departamento', 'sub_departamento', 'seccional', 'delegacia']
		})
			.notNull()
			.default('delegacia'),
		/** ID da unidade pai na hierarquia (dept → subdept → seccional → delegacia). */
		seccional_id: integer('seccional_id'),
		cidade: text('cidade').notNull().default(''),
		tem_plantao: integer('tem_plantao', { mode: 'boolean' }).default(false).notNull(),
		tem_expediente: integer('tem_expediente', { mode: 'boolean' }).default(false).notNull(),
		tem_fds: integer('tem_fds', { mode: 'boolean' }).default(false).notNull(),
		/**
		 * Unidade DESATIVADA (`ativo = 0`) sai das listas de escolha, mas continua
		 * existindo: escala, lotação e assinatura de relatório antigas seguem
		 * resolvendo o nome e o id.
		 *
		 * Não existe exclusão de unidade — de propósito. `gise_assinaturas_relatorios`
		 * referencia `unidades(id)` e apagar a linha destruiria prova de documento
		 * assinado. Desativar é a operação segura equivalente.
		 */
		ativo: integer('ativo', { mode: 'boolean' }).default(true).notNull(),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_unidades_nome').on(table.nome),
		index('idx_unidades_ativo').on(table.ativo)
	]
);

// ---- Documentos de Escalas (R2) ----

export const escalaDocumentos = sqliteTable('escala_documentos', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	escala_id: integer('escala_id')
		.notNull()
		.unique()
		.references(() => escalas.id, { onDelete: 'cascade' }),
	r2_key: text('r2_key').notNull(),
	assinante_nome: text('assinante_nome').notNull(),
	assinante_cpf: text('assinante_cpf'),
	assinante_email: text('assinante_email'),
	verificacao_hash: text('verificacao_hash').unique(),
	selfie_key: text('selfie_key'),
	arquivo_hash: text('arquivo_hash'),
	ip_address: text('ip_address'),
	user_agent: text('user_agent'),
	/** User-Agent BRUTO (não-parseado) — preservado para perícia forense. */
	user_agent_raw: text('user_agent_raw'),
	latitude: real('latitude'),
	longitude: real('longitude'),
	tipo_carimbo_tempo: text('tipo_carimbo_tempo').default('servidor'),
	// Metadados CAdES-LT (migração 0012) — nullable para compatibilidade com registros antigos.
	cert_issuer: text('cert_issuer'),
	cert_serial: text('cert_serial'),
	cert_valido_de: text('cert_valido_de'),
	cert_valido_ate: text('cert_valido_ate'),
	cms_sha256: text('cms_sha256'),
	ocsp_response_b64: text('ocsp_response_b64'),
	ocsp_consultado_em: text('ocsp_consultado_em'),
	tst_token_b64: text('tst_token_b64'),
	created_at: text('created_at').default(sql`(datetime('now', '-3 hours'))`)
});

// ---- Solicitações de Assinatura de Escalas ----

export const escalaSolicitacoesAssinatura = sqliteTable(
	'escala_solicitacoes_assinatura',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		escala_id: integer('escala_id')
			.notNull()
			.unique()
			.references(() => escalas.id, { onDelete: 'cascade' }),
		// onDelete: cascade — solicitação não faz sentido sem solicitante.
		solicitante_id: integer('solicitante_id')
			.notNull()
			.references(() => policiais.id, { onDelete: 'cascade' }),
		tipo: text('tipo', { enum: ['unidade', 'respondencia'] }).notNull(),
		// onDelete: set null — solicitação sobrevive mesmo se destinatário sumir;
		// a coluna é nullable, então preserva o histórico do solicitante.
		destinatario_id: integer('destinatario_id').references(() => policiais.id, {
			onDelete: 'set null'
		}),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_esa_escala_id').on(table.escala_id),
		index('idx_esa_destinatario_id').on(table.destinatario_id)
	]
);

// ---- GISE ----

export const giseEscalas = sqliteTable(
	'gise_escalas',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		data_inicio: text('data_inicio').notNull(),
		feriado: integer('feriado').notNull().default(0),
		hora_entrada: text('hora_entrada').notNull().default('08:00'),
		hora_saida: text('hora_saida').notNull().default('16:00'),
		status: text('status', {
			enum: [
				'em_definicao_supervisor',
				'em_preenchimento',
				'aguardando_assinatura',
				'em_andamento',
				'aguardando_relatorios',
				'aguardando_assinatura_relat',
				'pronta_para_finalizar',
				'finalizada'
			]
		})
			.notNull()
			.default('em_definicao_supervisor'),
		supervisor_id: integer('supervisor_id'),
		assessor_id: integer('assessor_id'),
		seint1_id: integer('seint1_id'),
		seint2_id: integer('seint2_id'),
		/** E-mail pessoal (ou sobrescrito) do assessor para avisos de envio das seccionais na GISE. */
		assessor_email_notificacao: text('assessor_email_notificacao'),
		/** Rótulo do bloco "Breve relatório" nos PDFs de extra; null = padrão global. */
		breve_relatorio_titulo: text('breve_relatorio_titulo'),
		/** Texto do quadro no relatório de extra por seccional; null = padrão global. */
		breve_relatorio_texto_seccional: text('breve_relatorio_texto_seccional'),
		/** Texto do quadro no relatório de extra do quadro de supervisão; null = padrão global. */
		breve_relatorio_texto_supervisao: text('breve_relatorio_texto_supervisao'),
		/** ISO 8601: último envio com sucesso dos dados desta GISE para a planilha Base_Equipe. */
		planilha_base_equipe_alimentada_em: text('planilha_base_equipe_alimentada_em'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_gise_escalas_status').on(table.status),
		index('idx_gise_escalas_supervisor').on(table.supervisor_id),
		index('idx_gise_escalas_assessor').on(table.assessor_id),
		index('idx_gise_escalas_seint1').on(table.seint1_id),
		index('idx_gise_escalas_seint2').on(table.seint2_id)
	]
);

export const giseSeccionais = sqliteTable(
	'gise_seccionais',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gise_id: integer('gise_id')
			.notNull()
			.references(() => giseEscalas.id, { onDelete: 'cascade' }),
		// onDelete: restrict — bloqueia remoção de unidades que têm GISE histórico
		// vinculado. Garante integridade de auditoria; admin deve apagar GISE antes.
		seccional_id: integer('seccional_id')
			.notNull()
			.references(() => unidades.id, { onDelete: 'restrict' }),
		unidade_operacional_id: integer('unidade_operacional_id'),
		status: text('status', {
			enum: ['pendente', 'preenchida', 'retificada', 'preenchida_retificada']
		})
			.notNull()
			.default('pendente'),
		hora_entrada: text('hora_entrada'),
		hora_saida: text('hora_saida')
	},
	(table) => [
		index('idx_gise_seccionais_gise').on(table.gise_id),
		index('idx_gise_seccionais_seccional').on(table.seccional_id),
		index('idx_gise_seccionais_gise_status').on(table.gise_id, table.status),
		unique('uq_gise_seccional').on(table.gise_id, table.seccional_id)
	]
);

export const giseEquipes = sqliteTable(
	'gise_equipes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gise_seccional_id: integer('gise_seccional_id')
			.notNull()
			.references(() => giseSeccionais.id, { onDelete: 'cascade' }),
		// Slot de unidade ao qual esta equipe pertence (null = legado, antes da migração 0054)
		gise_unidade_id: integer('gise_unidade_id'),
		tipo: text('tipo', { enum: ['operacional', 'seint'] }).notNull(),
		slots_dpc: integer('slots_dpc').notNull().default(0),
		slots_oip: integer('slots_oip').notNull().default(0),
		hora_entrada: text('hora_entrada'),
		hora_saida: text('hora_saida')
	},
	(table) => [
		index('idx_gise_equipes_sec').on(table.gise_seccional_id),
		index('idx_gise_equipes_unidade').on(table.gise_unidade_id)
	]
);

export const giseMembros = sqliteTable(
	'gise_membros',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		equipe_id: integer('equipe_id')
			.notNull()
			.references(() => giseEquipes.id, { onDelete: 'cascade' }),
		policial_id: integer('policial_id')
			.notNull()
			.references(() => policiais.id, { onDelete: 'cascade' })
	},
	(table) => [
		index('idx_gise_membros_equipe').on(table.equipe_id),
		index('idx_gise_membros_policial').on(table.policial_id)
	]
);

export const giseSeccionalUnidades = sqliteTable(
	'gise_seccional_unidades',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gise_seccional_id: integer('gise_seccional_id')
			.notNull()
			.references(() => giseSeccionais.id, { onDelete: 'cascade' }),
		// Nullable: slot criado pelo Adm Geral sem unidade pré-definida (Adm Seccional preenche depois)
		unidade_id: integer('unidade_id').references(() => unidades.id, { onDelete: 'set null' })
	},
	(table) => [index('idx_gise_sec_unidades').on(table.gise_seccional_id)]
);

export const giseDocumentos = sqliteTable(
	'gise_documentos',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gise_id: integer('gise_id')
			.notNull()
			.references(() => giseEscalas.id, { onDelete: 'cascade' }),
		r2_key: text('r2_key').notNull(),
		assinante_id: integer('assinante_id'),
		assinante_nome: text('assinante_nome').notNull().default(''),
		assinante_cpf: text('assinante_cpf').notNull().default(''),
		assinante_email: text('assinante_email'),
		verificacao_hash: text('verificacao_hash').unique(),
		selfie_key: text('selfie_key'),
		arquivo_hash: text('arquivo_hash'),
		rubrica: text('rubrica'),
		ip_address: text('ip_address'),
		user_agent: text('user_agent'),
		/** User-Agent BRUTO (não-parseado) — preservado para perícia forense. */
		user_agent_raw: text('user_agent_raw'),
		latitude: real('latitude'),
		longitude: real('longitude'),
		tipo_carimbo_tempo: text('tipo_carimbo_tempo').default('servidor'),
		// Metadados CAdES-LT (migração 0012)
		cert_issuer: text('cert_issuer'),
		cert_serial: text('cert_serial'),
		cert_valido_de: text('cert_valido_de'),
		cert_valido_ate: text('cert_valido_ate'),
		cms_sha256: text('cms_sha256'),
		ocsp_response_b64: text('ocsp_response_b64'),
		ocsp_consultado_em: text('ocsp_consultado_em'),
		tst_token_b64: text('tst_token_b64'),
		created_at: text('created_at').default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [unique('uq_gise_documento').on(table.gise_id)]
);

// ---- Resultados GISE ----

export const giseModeloFormulario = sqliteTable(
	'gise_modelo_formulario',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		tipo: text('tipo').notNull().default('operacional'),
		config: text('config').notNull().default('[]'),
		/** Versão anterior do `config` — um nível de desfazer para o editor do
		 *  Admin Geral ("Restaurar anterior"). `null` enquanto só houve a
		 *  primeira gravação. Ver migração 0039. */
		config_anterior: text('config_anterior'),
		updated_at: text('updated_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [index('idx_gise_modelo_tipo').on(table.tipo)]
);

export const giseRespostasFormulario = sqliteTable(
	'gise_respostas_formulario',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gise_id: integer('gise_id')
			.notNull()
			.references(() => giseEscalas.id, { onDelete: 'cascade' }),
		policial_id: integer('policial_id')
			.notNull()
			.references(() => policiais.id, { onDelete: 'cascade' }),
		equipe_id: integer('equipe_id').references(() => giseEquipes.id, { onDelete: 'cascade' }),
		/** JSON objeto (chaves string); validar no servidor com Zod ao ler/escrever */
		respostas: text('respostas').notNull().default('{}'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`),
		updated_at: text('updated_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		unique('uq_gise_resposta_policial').on(table.gise_id, table.policial_id),
		index('idx_gise_respostas_equipe').on(table.gise_id, table.equipe_id)
	]
);

export const gisePresencas = sqliteTable(
	'gise_presencas',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gise_id: integer('gise_id')
			.notNull()
			.references(() => giseEscalas.id, { onDelete: 'cascade' }),
		policial_id: integer('policial_id')
			.notNull()
			.references(() => policiais.id, { onDelete: 'cascade' }),
		entrada_timestamp: text('entrada_timestamp'),
		entrada_rubrica: text('entrada_rubrica'),
		entrada_selfie_key: text('entrada_selfie_key'),
		saida_timestamp: text('saida_timestamp'),
		saida_rubrica: text('saida_rubrica'),
		saida_selfie_key: text('saida_selfie_key'),
		ip_address: text('ip_address'),
		user_agent: text('user_agent'),
		/** Graus decimais (WGS-84); usar real, não integer */
		latitude: real('latitude'),
		longitude: real('longitude'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`),
		updated_at: text('updated_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		unique('uq_gise_presenca_policial').on(table.gise_id, table.policial_id),
		index('idx_gise_presencas_gise').on(table.gise_id)
	]
);

export const giseAssinaturasRelatorios = sqliteTable(
	'gise_assinaturas_relatorios',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gise_id: integer('gise_id')
			.notNull()
			.references(() => giseEscalas.id, { onDelete: 'cascade' }),
		// onDelete: restrict — o banco RECUSA apagar uma unidade que tenha
		// assinatura de relatório. Era `cascade` até a migração 0038, e apagar a
		// unidade levava junto o registro do ato de assinar (assinante, CPF,
		// rubrica, selfie, IP, GPS, hash, chave do PDF no R2), fazendo o `/validar`
		// negar um documento já entregue. A aplicação nem exclui unidade mais (só
		// desativa); isto fecha o DELETE manual.
		seccional_id: integer('seccional_id')
			.notNull()
			.references(() => unidades.id, { onDelete: 'restrict' }),
		tipo: text('tipo', { enum: ['extraordinario', 'produtividade'] }).notNull(),
		assinante_id: integer('assinante_id'),
		assinante_nome: text('assinante_nome').notNull(),
		assinante_cpf: text('assinante_cpf'),
		assinante_email: text('assinante_email'),
		tipo_assinatura: text('tipo_assinatura', { enum: ['simples', 'webpki', 'serpro'] }).notNull(),
		rubrica: text('rubrica'),
		selfie_key: text('selfie_key'),
		arquivo_hash: text('arquivo_hash'),
		verification_hash: text('verification_hash').unique(),
		ip_address: text('ip_address'),
		user_agent: text('user_agent'),
		/** User-Agent BRUTO (não-parseado) — preservado para perícia forense. */
		user_agent_raw: text('user_agent_raw'),
		latitude: real('latitude'),
		longitude: real('longitude'),
		r2_key: text('r2_key'),
		tipo_carimbo_tempo: text('tipo_carimbo_tempo').default('servidor'),
		// Metadados CAdES-LT (migração 0012)
		cert_issuer: text('cert_issuer'),
		cert_serial: text('cert_serial'),
		cert_valido_de: text('cert_valido_de'),
		cert_valido_ate: text('cert_valido_ate'),
		cms_sha256: text('cms_sha256'),
		ocsp_response_b64: text('ocsp_response_b64'),
		ocsp_consultado_em: text('ocsp_consultado_em'),
		tst_token_b64: text('tst_token_b64'),
		created_at: text('created_at').default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		unique('uq_gise_ass_rel').on(table.gise_id, table.seccional_id, table.tipo),
		index('idx_gise_ass_rel_gise').on(table.gise_id)
	]
);

// ---- Termos de presença assinados por Token A3 (desktop) ----
// Presença confirmada no computador gera um PDF qualificado (CAdES-LT). Tabela
// dedicada para que /validar reconheça o termo sem afetar a detecção de
// relatório/escala assinados.
export const gisePresencaTermos = sqliteTable(
	'gise_presenca_termos',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gise_id: integer('gise_id')
			.notNull()
			.references(() => giseEscalas.id, { onDelete: 'cascade' }),
		policial_id: integer('policial_id').notNull(),
		tipo: text('tipo', { enum: ['entrada', 'saida'] }).notNull(),
		assinante_nome: text('assinante_nome').notNull(),
		assinante_cpf: text('assinante_cpf'),
		assinante_email: text('assinante_email'),
		verification_hash: text('verification_hash').unique(),
		r2_key: text('r2_key'),
		arquivo_hash: text('arquivo_hash'),
		ip_address: text('ip_address'),
		user_agent: text('user_agent'),
		/** User-Agent BRUTO (não-parseado) — preservado para perícia forense. */
		user_agent_raw: text('user_agent_raw'),
		latitude: real('latitude'),
		longitude: real('longitude'),
		tipo_carimbo_tempo: text('tipo_carimbo_tempo').default('servidor'),
		cert_issuer: text('cert_issuer'),
		cert_serial: text('cert_serial'),
		cert_valido_de: text('cert_valido_de'),
		cert_valido_ate: text('cert_valido_ate'),
		cms_sha256: text('cms_sha256'),
		ocsp_response_b64: text('ocsp_response_b64'),
		ocsp_consultado_em: text('ocsp_consultado_em'),
		tst_token_b64: text('tst_token_b64'),
		created_at: text('created_at').default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [index('idx_gise_presenca_termos_gise').on(table.gise_id)]
);

// ---- Aceites do Termo de Uso e Política de Privacidade ----

export const aceitesTermos = sqliteTable(
	'aceites_termos',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		usuario_tipo: text('usuario_tipo', { enum: ['policial', 'admin'] }).notNull(),
		usuario_id: integer('usuario_id').notNull(),
		versao_termo: text('versao_termo').notNull(),
		hash_termo: text('hash_termo').notNull(),
		aceitou_lgpd: integer('aceitou_lgpd').notNull().default(0),
		aceitou_uso_email: integer('aceitou_uso_email').notNull().default(0),
		aceitou_uso_localizacao: integer('aceitou_uso_localizacao').notNull().default(0),
		aceitou_assinatura_avancada: integer('aceitou_assinatura_avancada').notNull().default(0),
		ip: text('ip'),
		user_agent: text('user_agent'),
		/**
		 * Snapshot do HTML do termo no momento do aceite — preserva o texto
		 * exato para reprodução em juízo sem depender do git history.
		 * Nullable para compat com registros pré-migração 0026.
		 */
		conteudo_html_snapshot: text('conteudo_html_snapshot'),
		aceitou_em: text('aceitou_em')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_aceites_termos_usuario').on(table.usuario_tipo, table.usuario_id, table.aceitou_em)
	]
);

// ---- Autenticação de Dois Fatores ----

export const doisFatoresTokens = sqliteTable(
	'dois_fatores_tokens',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		desafio_id: text('desafio_id').notNull().unique(),
		tipo: text('tipo', {
			enum: [
				'policial',
				'admin',
				'assinatura',
				'reset_policial',
				'reset_admin',
				'verificacao_email',
				'login_certificado'
			]
		}).notNull(),
		usuario_id: integer('usuario_id').notNull(),
		codigo: text('codigo').notNull(),
		tentativas: integer('tentativas').notNull().default(0),
		expires_at: text('expires_at').notNull(),
		usado: integer('usado').notNull().default(0),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [index('idx_2fa_desafio').on(table.desafio_id)]
);

// ---- Tokens de Redefinição de Senha ----

export const resetSenhaTokens = sqliteTable(
	'reset_senha_tokens',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		token: text('token').notNull().unique(),
		tipo_usuario: text('tipo_usuario', { enum: ['policial', 'admin'] }).notNull(),
		usuario_id: integer('usuario_id').notNull(),
		expires_at: text('expires_at').notNull(),
		usado: integer('usado').notNull().default(0),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_reset_senha_token').on(table.token),
		index('idx_reset_senha_usuario').on(table.tipo_usuario, table.usuario_id, table.created_at)
	]
);

// ---- Configurações do Sistema ----

export const configuracoes = sqliteTable('configuracoes', {
	chave: text('chave').primaryKey(),
	valor: text('valor').notNull(),
	updated_at: text('updated_at')
		.notNull()
		.default(sql`(datetime('now', '-3 hours'))`)
});

// ---- Rate Limiting ----

export const loginAttempts = sqliteTable(
	'login_attempts',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		ip: text('ip').notNull(),
		attempted_at: text('attempted_at')
			.notNull()
			.default(sql`(datetime('now'))`),
		success: integer('success').notNull().default(0),
		// Hash do identificador da conta (tipo:matricula) — throttle por conta
		// (account lockout) sem gravar a matrícula em texto. Nullable: fluxos que
		// não identificam a conta (ex.: login por certificado) gravam NULL.
		identifier: text('identifier')
	},
	(table) => [
		index('idx_login_attempts_ip_time').on(table.ip, table.attempted_at),
		index('idx_login_attempts_identifier_time').on(table.identifier, table.attempted_at)
	]
);

/**
 * Rate-limit dedicado aos fluxos de recuperação de senha e verificação de
 * e-mail pessoal. Separado de `login_attempts` para não inflar a contagem
 * usada pelo rate-limit de LOGIN (atacante poderia bloquear logins legítimos
 * disparando requests de reset).
 */
export const recoveryAttempts = sqliteTable(
	'recovery_attempts',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		ip: text('ip').notNull(),
		// `recovery_attempts` é, no nível do banco, um log genérico (ip, purpose,
		// attempted_at) — a coluna purpose NÃO tem CHECK (ver migration 0022), o
		// `enum` abaixo é só tipagem. Além dos fluxos de recuperação, reusamos a
		// mesma tabela para throttle por IP de endpoints sensíveis sem sessão
		// (download público de validação, verificação/reenvio de 2FA), cada um
		// isolado pelo seu purpose — um flood de um não infla o contador do outro
		// nem o de login/reset. Não requer migration (coluna purpose é TEXT livre).
		purpose: text('purpose', {
			enum: [
				'solicitar_redefinicao',
				'confirmar_redefinicao',
				'primeiro_acesso',
				'validar_download',
				'verificar_2fa',
				'reenviar_codigo',
				'solicitar_codigo_assinatura',
				'alterar_senha'
			]
		}).notNull(),
		attempted_at: text('attempted_at')
			.notNull()
			.default(sql`(datetime('now'))`)
	},
	(table) => [
		index('idx_recovery_attempts_ip_purpose_time').on(table.ip, table.purpose, table.attempted_at)
	]
);

/**
 * Nonces já consumidos por webhooks de sync (P1.3 da auditoria — replay
 * protection). Cada chamada de `/api/webhook/*` que envia X-Webhook-Nonce
 * resulta em uma linha aqui; o PRIMARY KEY garante que uma segunda tentativa
 * com o mesmo nonce falha por UNIQUE constraint. Limpeza periódica usa o
 * índice em `received_at` para purgar nonces fora da janela.
 */
export const webhookNonces = sqliteTable(
	'webhook_nonces',
	{
		nonce: text('nonce').primaryKey().notNull(),
		received_at: text('received_at')
			.notNull()
			.default(sql`(datetime('now'))`)
	},
	(table) => [index('idx_webhook_nonces_received_at').on(table.received_at)]
);

// ---- Log de Auditoria (trilha forense) ----
//
// Evento estruturado e à prova de adulteração. Os campos `seq`/`hash_anterior`/
// `hash_registro` formam uma cadeia de hash encadeada (tamper-evidence); ver
// `auditar` e `verificarIntegridadeAudit` em `src/lib/db/audit.ts`. Colunas além
// das do log original (migração 0000) entraram nullable na migração 0033 — as
// linhas antigas e as ~25 chamadas legadas continuam válidas.

export const auditLog = sqliteTable(
	'audit_log',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		// ---- Ator (quem executou) ----
		usuario_id: integer('usuario_id'),
		usuario_nome: text('usuario_nome').notNull().default(''),
		usuario_papel: text('usuario_papel'),
		actor_tipo: text('actor_tipo', { enum: ['policial', 'admin', 'sistema', 'webhook'] }),
		// ---- Ação e classificação ----
		acao: text('acao').notNull(),
		categoria: text('categoria'),
		severidade: text('severidade', { enum: ['info', 'aviso', 'critico'] }),
		resultado: text('resultado', { enum: ['sucesso', 'falha', 'negado'] }),
		// ---- Entidade afetada (compat) + Alvo explícito (quem/o que sofreu a ação) ----
		entidade: text('entidade').notNull(),
		entidade_id: integer('entidade_id'),
		alvo_tipo: text('alvo_tipo'),
		alvo_id: integer('alvo_id'),
		alvo_nome: text('alvo_nome'),
		// ---- Conteúdo ----
		detalhes: text('detalhes'),
		/** JSON livre com contexto adicional do evento. */
		metadados: text('metadados'),
		/** JSON: snapshot do estado ANTES de uma edição (diff). */
		dados_antes: text('dados_antes'),
		/** JSON: snapshot do estado DEPOIS de uma edição (diff). */
		dados_depois: text('dados_depois'),
		// ---- Contexto de request / correlação ----
		ip: text('ip'),
		/** IP completo cifrado (AES-GCM); `ip` acima fica anonimizado p/ exibição. */
		ip_cifrado: text('ip_cifrado'),
		user_agent: text('user_agent'),
		request_id: text('request_id'),
		rota: text('rota'),
		metodo: text('metodo'),
		// ---- Tamper-evidence (cadeia de hash) ----
		seq: integer('seq'),
		hash_anterior: text('hash_anterior'),
		hash_registro: text('hash_registro'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now'))`)
	},
	(table) => [
		index('idx_audit_usuario').on(table.usuario_id, table.created_at),
		index('idx_audit_entidade').on(table.entidade, table.entidade_id),
		index('idx_audit_acao').on(table.acao),
		index('idx_audit_created_at').on(table.created_at),
		unique('uq_audit_seq').on(table.seq),
		index('idx_audit_categoria').on(table.categoria, table.created_at),
		index('idx_audit_severidade').on(table.severidade, table.created_at),
		index('idx_audit_resultado').on(table.resultado, table.created_at),
		index('idx_audit_alvo').on(table.alvo_tipo, table.alvo_id)
	]
);

// ---- Logs técnicos da aplicação (warn/error do logger estruturado) ----
//
// Complementa a trilha forense `audit_log` (eventos de negócio) com os sinais
// operacionais que antes só existiam em Cloudflare Logs/Sentry: cada `logger.warn`
// / `logger.error` emitido durante uma request é persistido aqui pelo flush em
// hooks.server.ts, correlacionável com a auditoria via `request_id`.
export const appLog = sqliteTable(
	'app_log',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		level: text('level', { enum: ['warn', 'error'] }).notNull(),
		message: text('message').notNull(),
		/** JSON com o contexto passado ao logger (truncado — ver request-context.ts). */
		contexto: text('contexto'),
		request_id: text('request_id'),
		/** Id do usuário autenticado na request (texto; null = anônimo/sistema). */
		usuario_id: text('usuario_id'),
		rota: text('rota'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now'))`)
	},
	(table) => [
		index('idx_applog_created').on(table.created_at),
		index('idx_applog_level').on(table.level, table.created_at),
		index('idx_applog_request').on(table.request_id)
	]
);

// ---- LGPD: Registro de Incidentes (art. 48) ----

export const lgpdIncidentes = sqliteTable(
	'lgpd_incidentes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		titulo: text('titulo').notNull(),
		descricao: text('descricao').notNull(),
		tipo_incidente: text('tipo_incidente', {
			enum: ['acesso_nao_autorizado', 'vazamento', 'uso_indevido', 'perda', 'alteracao', 'outro']
		})
			.notNull()
			.default('acesso_nao_autorizado'),
		data_ocorrencia: text('data_ocorrencia'),
		data_descoberta: text('data_descoberta').notNull(),
		dados_afetados: text('dados_afetados').notNull(),
		usuarios_afetados_estimativa: integer('usuarios_afetados_estimativa'),
		gravidade: text('gravidade', { enum: ['baixa', 'media', 'alta', 'critica'] })
			.notNull()
			.default('media'),
		status: text('status', { enum: ['aberto', 'investigando', 'notificado_anpd', 'encerrado'] })
			.notNull()
			.default('aberto'),
		responsavel_nome: text('responsavel_nome').notNull(),
		responsavel_email: text('responsavel_email').notNull(),
		notificado_anpd_em: text('notificado_anpd_em'),
		prazo_notificacao_anpd: text('prazo_notificacao_anpd'),
		medidas_tomadas: text('medidas_tomadas'),
		created_by_id: integer('created_by_id').notNull(),
		created_by_nome: text('created_by_nome').notNull(),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`),
		updated_at: text('updated_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_lgpd_incidentes_status').on(table.status, table.created_at),
		index('idx_lgpd_incidentes_gravidade').on(table.gravidade)
	]
);

// ---- LGPD: Solicitações de Direitos dos Titulares (art. 18) ----

export const lgpdSolicitacoes = sqliteTable(
	'lgpd_solicitacoes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		solicitante_tipo: text('solicitante_tipo', { enum: ['policial', 'admin'] }).notNull(),
		solicitante_id: integer('solicitante_id').notNull(),
		solicitante_nome: text('solicitante_nome').notNull(),
		tipo_direito: text('tipo_direito', {
			enum: [
				'acesso',
				'correcao',
				'anonimizacao',
				'portabilidade',
				'eliminacao',
				'informacao_compartilhamento',
				'revogacao_consentimento',
				'oposicao'
			]
		}).notNull(),
		descricao: text('descricao'),
		status: text('status', { enum: ['pendente', 'em_analise', 'concluida', 'indeferida'] })
			.notNull()
			.default('pendente'),
		resposta: text('resposta'),
		respondido_por_nome: text('respondido_por_nome'),
		respondido_em: text('respondido_em'),
		prazo_resposta: text('prazo_resposta').notNull(),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`),
		updated_at: text('updated_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_lgpd_sol_solicitante').on(
			table.solicitante_tipo,
			table.solicitante_id,
			table.created_at
		),
		index('idx_lgpd_sol_status').on(table.status, table.prazo_resposta)
	]
);

// ---- Solicitações de alteração cadastral (página "Meu perfil") ----

// Uma linha por campo alterado (telefone/classe/regime/lotacao); aprovação do
// Admin Geral aplica o valor no cadastro. E-mail pessoal tem fluxo próprio
// (OTP) e não passa por esta tabela.
export const cadastroSolicitacoes = sqliteTable(
	'cadastro_solicitacoes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		policial_id: integer('policial_id').notNull(),
		campo: text('campo', { enum: ['telefone', 'classe', 'regime', 'lotacao'] }).notNull(),
		valor_atual: text('valor_atual'),
		valor_novo: text('valor_novo').notNull(),
		status: text('status', { enum: ['pendente', 'aprovada', 'rejeitada'] })
			.notNull()
			.default('pendente'),
		decidido_por: integer('decidido_por'),
		decidido_em: text('decidido_em'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_cadsol_status').on(table.status),
		index('idx_cadsol_policial').on(table.policial_id, table.status)
	]
);

// ---- Histórico funcional do policial ----
//
// Linha do tempo por servidor: movimentações (transferências de lotação),
// afastamentos (férias/licenças), desvinculações (baixa) e o diff das edições
// cadastrais. Cada evento é imutável (append-only) e pode ter um documento PDF
// anexo no R2 (`documento_r2_key`). O objetivo é responder "o que já aconteceu
// com este policial?" — separado da trilha forense `audit_log` (Super Admin,
// tamper-evident), que continua registrando os mesmos fatos para segurança.

export const policialHistorico = sqliteTable(
	'policial_historico',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		policial_id: integer('policial_id')
			.notNull()
			.references(() => policiais.id, { onDelete: 'cascade' }),
		tipo: text('tipo', {
			enum: ['movimentacao', 'afastamento', 'desvinculacao', 'edicao', 'papel']
		}).notNull(),
		/** Subtipo do afastamento: ferias | licenca_medica | judicial | licenca_outros | outros. */
		subtipo: text('subtipo'),
		/** Motivo/descrição livre (afastamento) ou destino do policial (desvinculação). */
		descricao: text('descricao'),
		// ---- Movimentação ----
		unidade_origem: text('unidade_origem'),
		unidade_destino: text('unidade_destino'),
		// ---- Datas ----
		/** Data principal do evento (movimentação/desvinculação). */
		data_evento: text('data_evento'),
		data_inicio: text('data_inicio'),
		data_fim: text('data_fim'),
		qtd_dias: integer('qtd_dias'),
		// ---- Protocolo (NUP) ----
		nup: text('nup'),
		// ---- Documento anexo (PDF no R2) ----
		documento_r2_key: text('documento_r2_key'),
		documento_nome: text('documento_nome'),
		// ---- Diff (edição de cadastro / mudança de papel) ----
		/** JSON: snapshot ANTES da edição. */
		dados_antes: text('dados_antes'),
		/** JSON: snapshot DEPOIS da edição. */
		dados_depois: text('dados_depois'),
		// ---- Ator (quem registrou) ----
		registrado_por_id: integer('registrado_por_id'),
		registrado_por_nome: text('registrado_por_nome'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_pol_hist_policial').on(table.policial_id, table.created_at),
		index('idx_pol_hist_tipo').on(table.tipo)
	]
);

// ---- Tipos inferidos ----

export type Policial = typeof policiais.$inferSelect;
export type PolicialHistorico = typeof policialHistorico.$inferSelect;
export type CadastroSolicitacao = typeof cadastroSolicitacoes.$inferSelect;
export type Escala = typeof escalas.$inferSelect;
export type NovaEscala = typeof escalas.$inferInsert;
export type EscalaPolicial = typeof escalaPoliciais.$inferSelect;
export type Unidade = typeof unidades.$inferSelect;
export type EscalaDocumento = typeof escalaDocumentos.$inferSelect;
export type GiseEscala = typeof giseEscalas.$inferSelect;
export type GiseSeccional = typeof giseSeccionais.$inferSelect;
export type GiseEquipe = typeof giseEquipes.$inferSelect;
export type GiseMembro = typeof giseMembros.$inferSelect;
export type GiseDocumento = typeof giseDocumentos.$inferSelect;
export type GisePresenca = typeof gisePresencas.$inferSelect;
export type GiseAssinaturaRelatorio = typeof giseAssinaturasRelatorios.$inferSelect;
export type AceiteTermo = typeof aceitesTermos.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;
export type AppLog = typeof appLog.$inferSelect;
export type LgpdIncidente = typeof lgpdIncidentes.$inferSelect;
export type LgpdSolicitacao = typeof lgpdSolicitacoes.$inferSelect;
