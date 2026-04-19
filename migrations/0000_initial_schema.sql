CREATE TABLE IF NOT EXISTS `administradores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`login` text NOT NULL,
	`senha` text NOT NULL,
	`nome` text NOT NULL,
	`email` text,
	`email_pessoal` text,
	`email_pessoal_verificado` integer DEFAULT 0 NOT NULL,
	`primeiro_acesso` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now', '-3 hours'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `administradores_login_unique` ON `administradores` (`login`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`usuario_id` integer,
	`usuario_nome` text DEFAULT '' NOT NULL,
	`usuario_papel` text,
	`acao` text NOT NULL,
	`entidade` text NOT NULL,
	`entidade_id` integer,
	`detalhes` text,
	`ip` text,
	`user_agent` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_usuario` ON `audit_log` (`usuario_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_entidade` ON `audit_log` (`entidade`,`entidade_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_acao` ON `audit_log` (`acao`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_created_at` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `configuracoes` (
	`chave` text PRIMARY KEY NOT NULL,
	`valor` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '-3 hours')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `dois_fatores_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`desafio_id` text NOT NULL,
	`tipo` text NOT NULL,
	`usuario_id` integer NOT NULL,
	`codigo` text NOT NULL,
	`tentativas` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`usado` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now', '-3 hours')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `dois_fatores_tokens_desafio_id_unique` ON `dois_fatores_tokens` (`desafio_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_2fa_desafio` ON `dois_fatores_tokens` (`desafio_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `escala_documentos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`escala_id` integer NOT NULL,
	`r2_key` text NOT NULL,
	`assinante_nome` text NOT NULL,
	`assinante_cpf` text,
	`assinante_email` text,
	`verificacao_hash` text,
	`selfie_key` text,
	`arquivo_hash` text,
	`ip_address` text,
	`user_agent` text,
	`latitude` real,
	`longitude` real,
	`tipo_carimbo_tempo` text DEFAULT 'servidor',
	`created_at` text DEFAULT (datetime('now', '-3 hours')),
	FOREIGN KEY (`escala_id`) REFERENCES `escalas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `escala_documentos_escala_id_unique` ON `escala_documentos` (`escala_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `escala_documentos_verificacao_hash_unique` ON `escala_documentos` (`verificacao_hash`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `escala_policiais` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`escala_id` integer NOT NULL,
	`policial_id` integer NOT NULL,
	`data_plantao` text NOT NULL,
	`data_saida` text DEFAULT '' NOT NULL,
	`horario` text DEFAULT '' NOT NULL,
	`hora_entrada` text DEFAULT '' NOT NULL,
	`hora_saida` text DEFAULT '' NOT NULL,
	`observacoes` text DEFAULT '' NOT NULL,
	`equipe` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`escala_id`) REFERENCES `escalas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policial_id`) REFERENCES `policiais`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escala_policiais_escala` ON `escala_policiais` (`escala_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escala_policiais_policial` ON `escala_policiais` (`policial_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escala_policiais_escala_policial` ON `escala_policiais` (`escala_id`,`policial_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `escalas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`titulo` text NOT NULL,
	`cidade` text NOT NULL,
	`data_inicio` text NOT NULL,
	`data_fim` text NOT NULL,
	`horario` text DEFAULT '08H A 08H' NOT NULL,
	`hora_entrada` text DEFAULT '08' NOT NULL,
	`hora_saida` text DEFAULT '08' NOT NULL,
	`lotacao` text DEFAULT '' NOT NULL,
	`tipo` text,
	`visto_por_admin` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now', '-3 hours')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalas_lotacao` ON `escalas` (`lotacao`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalas_created_at` ON `escalas` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalas_data_inicio` ON `escalas` (`data_inicio`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalas_tipo` ON `escalas` (`tipo`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalas_lotacao_tipo_data` ON `escalas` (`lotacao`,`tipo`,`data_inicio`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `gise_assinaturas_relatorios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gise_id` integer NOT NULL,
	`seccional_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`assinante_id` integer,
	`assinante_nome` text NOT NULL,
	`assinante_cpf` text,
	`assinante_email` text,
	`tipo_assinatura` text NOT NULL,
	`rubrica` text,
	`selfie_key` text,
	`arquivo_hash` text,
	`verification_hash` text,
	`ip_address` text,
	`user_agent` text,
	`latitude` real,
	`longitude` real,
	`r2_key` text,
	`tipo_carimbo_tempo` text DEFAULT 'servidor',
	`created_at` text DEFAULT (datetime('now', '-3 hours')),
	FOREIGN KEY (`gise_id`) REFERENCES `gise_escalas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seccional_id`) REFERENCES `unidades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `gise_assinaturas_relatorios_verification_hash_unique` ON `gise_assinaturas_relatorios` (`verification_hash`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_ass_rel_gise` ON `gise_assinaturas_relatorios` (`gise_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_gise_ass_rel` ON `gise_assinaturas_relatorios` (`gise_id`,`seccional_id`,`tipo`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `gise_documentos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gise_id` integer NOT NULL,
	`r2_key` text NOT NULL,
	`assinante_id` integer,
	`assinante_nome` text DEFAULT '' NOT NULL,
	`assinante_cpf` text DEFAULT '' NOT NULL,
	`assinante_email` text,
	`verificacao_hash` text,
	`selfie_key` text,
	`arquivo_hash` text,
	`rubrica` text,
	`ip_address` text,
	`user_agent` text,
	`latitude` real,
	`longitude` real,
	`tipo_carimbo_tempo` text DEFAULT 'servidor',
	`created_at` text DEFAULT (datetime('now', '-3 hours')),
	FOREIGN KEY (`gise_id`) REFERENCES `gise_escalas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `gise_documentos_verificacao_hash_unique` ON `gise_documentos` (`verificacao_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_gise_documento` ON `gise_documentos` (`gise_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `gise_equipes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gise_seccional_id` integer NOT NULL,
	`gise_unidade_id` integer,
	`tipo` text NOT NULL,
	`slots_dpc` integer DEFAULT 0 NOT NULL,
	`slots_oip` integer DEFAULT 0 NOT NULL,
	`hora_entrada` text,
	`hora_saida` text,
	FOREIGN KEY (`gise_seccional_id`) REFERENCES `gise_seccionais`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_equipes_sec` ON `gise_equipes` (`gise_seccional_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_equipes_unidade` ON `gise_equipes` (`gise_unidade_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `gise_escalas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`data_inicio` text NOT NULL,
	`hora_entrada` text DEFAULT '08:00' NOT NULL,
	`hora_saida` text DEFAULT '16:00' NOT NULL,
	`status` text DEFAULT 'em_definicao_supervisor' NOT NULL,
	`supervisor_id` integer,
	`assessor_id` integer,
	`seint1_id` integer,
	`seint2_id` integer,
	`created_at` text DEFAULT (datetime('now', '-3 hours')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_escalas_status` ON `gise_escalas` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_escalas_supervisor` ON `gise_escalas` (`supervisor_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_escalas_assessor` ON `gise_escalas` (`assessor_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_escalas_seint1` ON `gise_escalas` (`seint1_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_escalas_seint2` ON `gise_escalas` (`seint2_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `gise_membros` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`equipe_id` integer NOT NULL,
	`policial_id` integer NOT NULL,
	FOREIGN KEY (`equipe_id`) REFERENCES `gise_equipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policial_id`) REFERENCES `policiais`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_membros_equipe` ON `gise_membros` (`equipe_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_membros_policial` ON `gise_membros` (`policial_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `gise_modelo_formulario` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tipo` text DEFAULT 'operacional' NOT NULL,
	`config` text DEFAULT '[]' NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '-3 hours')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_modelo_tipo` ON `gise_modelo_formulario` (`tipo`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `gise_presencas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gise_id` integer NOT NULL,
	`policial_id` integer NOT NULL,
	`entrada_timestamp` text,
	`entrada_rubrica` text,
	`entrada_selfie_key` text,
	`saida_timestamp` text,
	`saida_rubrica` text,
	`saida_selfie_key` text,
	`ip_address` text,
	`user_agent` text,
	`latitude` real,
	`longitude` real,
	`created_at` text DEFAULT (datetime('now', '-3 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '-3 hours')) NOT NULL,
	FOREIGN KEY (`gise_id`) REFERENCES `gise_escalas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policial_id`) REFERENCES `policiais`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_presencas_gise` ON `gise_presencas` (`gise_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_gise_presenca_policial` ON `gise_presencas` (`gise_id`,`policial_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `gise_respostas_formulario` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gise_id` integer NOT NULL,
	`policial_id` integer NOT NULL,
	`equipe_id` integer,
	`respostas` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (datetime('now', '-3 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '-3 hours')) NOT NULL,
	FOREIGN KEY (`gise_id`) REFERENCES `gise_escalas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policial_id`) REFERENCES `policiais`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipe_id`) REFERENCES `gise_equipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_respostas_equipe` ON `gise_respostas_formulario` (`gise_id`,`equipe_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_gise_resposta_policial` ON `gise_respostas_formulario` (`gise_id`,`policial_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `gise_seccionais` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gise_id` integer NOT NULL,
	`seccional_id` integer NOT NULL,
	`unidade_operacional_id` integer,
	`status` text DEFAULT 'pendente' NOT NULL,
	`hora_entrada` text,
	`hora_saida` text,
	FOREIGN KEY (`gise_id`) REFERENCES `gise_escalas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seccional_id`) REFERENCES `unidades`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_seccionais_gise` ON `gise_seccionais` (`gise_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_seccionais_seccional` ON `gise_seccionais` (`seccional_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_seccionais_gise_status` ON `gise_seccionais` (`gise_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_gise_seccional` ON `gise_seccionais` (`gise_id`,`seccional_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `gise_seccional_unidades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gise_seccional_id` integer NOT NULL,
	`unidade_id` integer,
	FOREIGN KEY (`gise_seccional_id`) REFERENCES `gise_seccionais`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unidade_id`) REFERENCES `unidades`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_gise_sec_unidades` ON `gise_seccional_unidades` (`gise_seccional_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `login_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ip` text NOT NULL,
	`attempted_at` text DEFAULT (datetime('now')) NOT NULL,
	`success` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_login_attempts_ip_time` ON `login_attempts` (`ip`,`attempted_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `policiais` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nome` text NOT NULL,
	`matricula` text NOT NULL,
	`cargo` text NOT NULL,
	`cpf` text,
	`telefone` text,
	`lotacao` text NOT NULL,
	`ativo` integer DEFAULT 1 NOT NULL,
	`regime` text DEFAULT 'plantao' NOT NULL,
	`classe` text DEFAULT '' NOT NULL,
	`senha` text NOT NULL,
	`email` text,
	`email_pessoal` text,
	`email_pessoal_verificado` integer DEFAULT 0 NOT NULL,
	`primeiro_acesso` integer DEFAULT 1 NOT NULL,
	`papel` text,
	`papel_unidade_id` integer,
	`created_at` text DEFAULT (datetime('now', '-3 hours')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now', '-3 hours')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `policiais_matricula_unique` ON `policiais` (`matricula`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_policiais_lotacao` ON `policiais` (`lotacao`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_policiais_cargo` ON `policiais` (`cargo`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_policiais_ativo` ON `policiais` (`ativo`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `reset_senha_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`tipo_usuario` text NOT NULL,
	`usuario_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`usado` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now', '-3 hours')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `reset_senha_tokens_token_unique` ON `reset_senha_tokens` (`token`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_reset_senha_token` ON `reset_senha_tokens` (`token`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_reset_senha_usuario` ON `reset_senha_tokens` (`tipo_usuario`,`usuario_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`tipo` text NOT NULL,
	`usuario_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now', '-3 hours')),
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `sessoes_token_unique` ON `sessoes` (`token`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sessoes_token` ON `sessoes` (`token`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sessoes_expires` ON `sessoes` (`expires_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `unidades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nome` text NOT NULL,
	`tipo` text DEFAULT 'delegacia' NOT NULL,
	`seccional_id` integer,
	`cidade` text DEFAULT '' NOT NULL,
	`tem_plantao` integer DEFAULT false NOT NULL,
	`tem_expediente` integer DEFAULT false NOT NULL,
	`tem_fds` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now', '-3 hours')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `unidades_nome_unique` ON `unidades` (`nome`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_unidades_nome` ON `unidades` (`nome`);