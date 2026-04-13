import { sqliteTable, text, integer, index, unique } from 'drizzle-orm/sqlite-core';
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
		regime: text('regime', { enum: ['plantao', 'expediente'] }).notNull().default('plantao'),
		classe: text('classe').notNull().default(''),
		senha: text('senha')
			.notNull(),
		email: text('email'),
		email_pessoal: text('email_pessoal'),
		email_pessoal_verificado: integer('email_pessoal_verificado').notNull().default(0),
		primeiro_acesso: integer('primeiro_acesso').notNull().default(1),
		// RBAC: papel promovido pelo Admin Geral ou Admin Seccional
		papel: text('papel', { enum: ['admin_seccional', 'admin_unidade'] }),
		// Unidade/Seccional sob responsabilidade do papel (FK a unidades.id)
		papel_unidade_id: integer('papel_unidade_id'),
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
		index('idx_policiais_ativo').on(table.ativo)
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
		index('idx_escala_policiais_escala_policial').on(table.escala_id, table.policial_id)
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
		tipo: text('tipo', { enum: ['seccional', 'delegacia'] }).notNull().default('delegacia'),
		seccional_id: integer('seccional_id'), // Reference to another unidade.id
		cidade: text('cidade').notNull().default(''),
		tem_plantao: integer('tem_plantao', { mode: 'boolean' }).default(false).notNull(),
		tem_expediente: integer('tem_expediente', { mode: 'boolean' }).default(false).notNull(),
		tem_fds: integer('tem_fds', { mode: 'boolean' }).default(false).notNull(),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [index('idx_unidades_nome').on(table.nome)]
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
	latitude: integer('latitude', { mode: 'number' }),
	longitude: integer('longitude', { mode: 'number' }),
	tipo_carimbo_tempo: text('tipo_carimbo_tempo').default('servidor'),
	created_at: text('created_at').default(sql`(datetime('now', '-3 hours'))`)
});

// ---- GISE ----

export const giseEscalas = sqliteTable(
	'gise_escalas',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		data_inicio: text('data_inicio').notNull(),
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
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_gise_escalas_status').on(table.status),
		index('idx_gise_escalas_supervisor').on(table.supervisor_id)
	]
);

export const giseSeccionais = sqliteTable(
	'gise_seccionais',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gise_id: integer('gise_id')
			.notNull()
			.references(() => giseEscalas.id, { onDelete: 'cascade' }),
		seccional_id: integer('seccional_id')
			.notNull()
			.references(() => unidades.id),
		unidade_operacional_id: integer('unidade_operacional_id'),
		status: text('status', { enum: ['pendente', 'preenchida', 'retificada', 'preenchida_retificada'] }).notNull().default('pendente'),
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
		tipo: text('tipo', { enum: ['operacional', 'seint'] }).notNull(),
		slots_dpc: integer('slots_dpc').notNull().default(0),
		slots_oip: integer('slots_oip').notNull().default(0),
		hora_entrada: text('hora_entrada'),
		hora_saida: text('hora_saida')
	},
	(table) => [
		index('idx_gise_equipes_sec').on(table.gise_seccional_id),
		unique('uq_gise_equipe').on(table.gise_seccional_id, table.tipo)
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

export const giseDocumentos = sqliteTable('gise_documentos', {
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
	latitude: integer('latitude', { mode: 'number' }),
	longitude: integer('longitude', { mode: 'number' }),
	tipo_carimbo_tempo: text('tipo_carimbo_tempo').default('servidor'),
	created_at: text('created_at').default(sql`(datetime('now', '-3 hours'))`)
}, (table) => [
	unique('uq_gise_documento').on(table.gise_id)
]);

// ---- Resultados GISE ----

export const giseModeloFormulario = sqliteTable('gise_modelo_formulario', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	tipo: text('tipo').notNull().default('operacional'), // 'operacional' ou 'seint'
	config: text('config').notNull().default('[]'), // JSON array de perguntas
	updated_at: text('updated_at').notNull().default(sql`(datetime('now', '-3 hours'))`)
}, (table) => [
	index('idx_gise_modelo_tipo').on(table.tipo)
]);

export const giseRespostasFormulario = sqliteTable('gise_respostas_formulario', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	gise_id: integer('gise_id')
		.notNull()
		.references(() => giseEscalas.id, { onDelete: 'cascade' }),
	policial_id: integer('policial_id')
		.notNull()
		.references(() => policiais.id, { onDelete: 'cascade' }),
	equipe_id: integer('equipe_id').references(() => giseEquipes.id, { onDelete: 'cascade' }),
	respostas: text('respostas').notNull().default('{}'),
	created_at: text('created_at').notNull().default(sql`(datetime('now', '-3 hours'))`),
	updated_at: text('updated_at').notNull().default(sql`(datetime('now', '-3 hours'))`)
}, (table) => [
	unique('uq_gise_resposta_policial').on(table.gise_id, table.policial_id),
	index('idx_gise_respostas_equipe').on(table.gise_id, table.equipe_id)
]);

export const gisePresencas = sqliteTable('gise_presencas', {
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
	latitude: integer('latitude', { mode: 'number' }),
	longitude: integer('longitude', { mode: 'number' }),
	created_at: text('created_at').notNull().default(sql`(datetime('now', '-3 hours'))`),
	updated_at: text('updated_at').notNull().default(sql`(datetime('now', '-3 hours'))`)
}, (table) => [
	unique('uq_gise_presenca_policial').on(table.gise_id, table.policial_id),
	index('idx_gise_presencas_gise').on(table.gise_id)
]);

export const giseAssinaturasRelatorios = sqliteTable('gise_assinaturas_relatorios', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	gise_id: integer('gise_id')
		.notNull()
		.references(() => giseEscalas.id, { onDelete: 'cascade' }),
	seccional_id: integer('seccional_id')
		.notNull()
		.references(() => unidades.id, { onDelete: 'cascade' }),
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
	latitude: integer('latitude', { mode: 'number' }),
	longitude: integer('longitude', { mode: 'number' }),
	r2_key: text('r2_key'),
	tipo_carimbo_tempo: text('tipo_carimbo_tempo').default('servidor'),
	created_at: text('created_at').default(sql`(datetime('now', '-3 hours'))`)
}, (table) => [
	unique('uq_gise_ass_rel').on(table.gise_id, table.seccional_id, table.tipo),
	index('idx_gise_ass_rel_gise').on(table.gise_id)
]);


// ---- Autenticação de Dois Fatores ----

export const doisFatoresTokens = sqliteTable(
	'dois_fatores_tokens',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		desafio_id: text('desafio_id').notNull().unique(),
		tipo: text('tipo', { enum: ['policial', 'admin', 'assinatura'] }).notNull(),
		usuario_id: integer('usuario_id').notNull(),
		codigo: text('codigo').notNull(),
		tentativas: integer('tentativas').notNull().default(0),
		expires_at: text('expires_at').notNull(),
		usado: integer('usado').notNull().default(0),
		created_at: text('created_at').notNull().default(sql`(datetime('now', '-3 hours'))`)
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
		created_at: text('created_at').notNull().default(sql`(datetime('now', '-3 hours'))`)
	},
	(table) => [
		index('idx_reset_senha_token').on(table.token),
		index('idx_reset_senha_usuario').on(table.tipo_usuario, table.usuario_id, table.created_at)
	]
);
export type ResetSenhaToken = typeof resetSenhaTokens.$inferSelect;

// ---- Configurações do Sistema ----

export const configuracoes = sqliteTable('configuracoes', {
	chave: text('chave').primaryKey(),
	valor: text('valor').notNull(),
	updated_at: text('updated_at').notNull().default(sql`(datetime('now', '-3 hours'))`)
});

// ---- Rate Limiting ----

export const loginAttempts = sqliteTable('login_attempts', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	ip: text('ip').notNull(),
	attempted_at: text('attempted_at').notNull().default(sql`(datetime('now'))`),
	success: integer('success').notNull().default(0)
}, (table) => [
	index('idx_login_attempts_ip_time').on(table.ip, table.attempted_at)
]);

// ---- Log de Auditoria ----

export const auditLog = sqliteTable(
	'audit_log',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		usuario_id: integer('usuario_id'),
		usuario_nome: text('usuario_nome').notNull().default(''),
		usuario_papel: text('usuario_papel'),
		acao: text('acao').notNull(),
		entidade: text('entidade').notNull(),
		entidade_id: integer('entidade_id'),
		detalhes: text('detalhes'),
		ip: text('ip'),
		user_agent: text('user_agent'),
		created_at: text('created_at').notNull().default(sql`(datetime('now'))`)
	},
	(table) => [
		index('idx_audit_usuario').on(table.usuario_id, table.created_at),
		index('idx_audit_entidade').on(table.entidade, table.entidade_id),
		index('idx_audit_acao').on(table.acao),
		index('idx_audit_created_at').on(table.created_at)
	]
);

// ---- Tipos inferidos ----

export type Policial = typeof policiais.$inferSelect;
export type NovoPolicial = typeof policiais.$inferInsert;
export type Escala = typeof escalas.$inferSelect;
export type NovaEscala = typeof escalas.$inferInsert;
export type EscalaPolicial = typeof escalaPoliciais.$inferSelect;
export type Administrador = typeof administradores.$inferSelect;
export type Administrator = typeof administradores.$inferSelect;
export type Sessao = typeof sessoes.$inferSelect;
export type Unidade = typeof unidades.$inferSelect;
export type EscalaDocumento = typeof escalaDocumentos.$inferSelect;
export type GiseEscala = typeof giseEscalas.$inferSelect;
export type GiseSeccional = typeof giseSeccionais.$inferSelect;
export type GiseEquipe = typeof giseEquipes.$inferSelect;
export type GiseMembro = typeof giseMembros.$inferSelect;
export type GiseDocumento = typeof giseDocumentos.$inferSelect;
export type GisePresenca = typeof gisePresencas.$inferSelect;
export type GiseRespostaFormulario = typeof giseRespostasFormulario.$inferSelect;
export type DoisFatoresToken = typeof doisFatoresTokens.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;
export type NovoAuditLog = typeof auditLog.$inferInsert;
