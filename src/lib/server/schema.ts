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
		telefone: text('telefone'),
		lotacao: text('lotacao').notNull(),
		ativo: integer('ativo').notNull().default(1),
		regime: text('regime', { enum: ['plantao', 'expediente', 'ambos'] }).notNull().default('ambos'),
		classe: text('classe').notNull().default(''),
		senha: text('senha')
			.notNull()
			.default('ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f'),
		primeiro_acesso: integer('primeiro_acesso').notNull().default(1),
		// RBAC: papel promovido pelo Admin Geral ou Admin Seccional
		papel: text('papel', { enum: ['admin_seccional', 'admin_unidade'] }),
		// Unidade/Seccional sob responsabilidade do papel (FK a unidades.id)
		papel_unidade_id: integer('papel_unidade_id'),
		created_at: text('created_at')
			.notNull()
			.default(sql`(datetime('now'))`),
		updated_at: text('updated_at')
			.notNull()
			.default(sql`(datetime('now'))`)
	},
	(table) => [
		index('idx_policiais_lotacao').on(table.lotacao),
		index('idx_policiais_cargo').on(table.cargo)
	]
);

// ---- Escalas ----

export const escalas = sqliteTable('escalas', {
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
		.default(sql`(datetime('now'))`)
});

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
		index('idx_escala_policiais_policial').on(table.policial_id)
	]
);

// ---- Administradores ----

export const administradores = sqliteTable('administradores', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	login: text('login').notNull().unique(),
	senha: text('senha').notNull(),
	nome: text('nome').notNull(),
	primeiro_acesso: integer('primeiro_acesso').notNull().default(1),
	created_at: text('created_at').default(sql`(datetime('now'))`)
});

// ---- Sessoes ----

export const sessoes = sqliteTable(
	'sessoes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		token: text('token').notNull().unique(),
		tipo: text('tipo', { enum: ['policial', 'admin'] }).notNull(),
		usuario_id: integer('usuario_id').notNull(),
		created_at: text('created_at').default(sql`(datetime('now'))`),
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
			.default(sql`(datetime('now'))`)
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
	verificacao_hash: text('verificacao_hash').unique(),
	created_at: text('created_at').default(sql`(datetime('now'))`)
});

// ---- GISE ----

export const giseEscalas = sqliteTable('gise_escalas', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	data_inicio: text('data_inicio').notNull(),
	data_fim: text('data_fim').notNull(),
	hora_entrada: text('hora_entrada').notNull().default('08'),
	hora_saida: text('hora_saida').notNull().default('16'),
	status: text('status', {
		enum: ['em_preenchimento', 'aguardando_assinatura', 'assinada', 'finalizada']
	})
		.notNull()
		.default('em_preenchimento'),
	supervisor_sabado_id: integer('supervisor_sabado_id'),
	supervisor_domingo_id: integer('supervisor_domingo_id'),
	created_at: text('created_at')
		.notNull()
		.default(sql`(datetime('now'))`)
});

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
		status: text('status', { enum: ['pendente', 'preenchida'] }).notNull().default('pendente')
	},
	(table) => [
		index('idx_gise_seccionais_gise').on(table.gise_id),
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
		slots_oip: integer('slots_oip').notNull().default(0)
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
			.references(() => policiais.id, { onDelete: 'cascade' }),
		dia: text('dia', { enum: ['sabado', 'domingo', 'ambos'] }).notNull().default('ambos')
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
		.unique()
		.references(() => giseEscalas.id, { onDelete: 'cascade' }),
	r2_key: text('r2_key').notNull(),
	assinante_id: integer('assinante_id'),
	assinante_nome: text('assinante_nome').notNull().default(''),
	assinante_cpf: text('assinante_cpf').notNull().default(''),
	verificacao_hash: text('verificacao_hash').unique(),
	created_at: text('created_at').default(sql`(datetime('now'))`)
});

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
