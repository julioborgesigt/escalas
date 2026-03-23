CREATE TABLE `administradores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`login` text NOT NULL,
	`senha` text NOT NULL,
	`nome` text NOT NULL,
	`primeiro_acesso` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `administradores_login_unique` ON `administradores` (`login`);--> statement-breakpoint
CREATE TABLE `escala_documentos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`escala_id` integer NOT NULL,
	`r2_key` text NOT NULL,
	`assinante_nome` text NOT NULL,
	`assinante_cpf` text,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`escala_id`) REFERENCES `escalas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `escala_documentos_escala_id_unique` ON `escala_documentos` (`escala_id`);--> statement-breakpoint
CREATE TABLE `escala_policiais` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`escala_id` integer NOT NULL,
	`policial_id` integer NOT NULL,
	`data_plantao` text NOT NULL,
	`data_saida` text DEFAULT '' NOT NULL,
	`horario` text DEFAULT '' NOT NULL,
	`hora_entrada` text DEFAULT '' NOT NULL,
	`hora_saida` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`escala_id`) REFERENCES `escalas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policial_id`) REFERENCES `policiais`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_escala_policiais_escala` ON `escala_policiais` (`escala_id`);--> statement-breakpoint
CREATE INDEX `idx_escala_policiais_policial` ON `escala_policiais` (`policial_id`);--> statement-breakpoint
CREATE TABLE `escalas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`titulo` text NOT NULL,
	`cidade` text NOT NULL,
	`data_inicio` text NOT NULL,
	`data_fim` text NOT NULL,
	`horario` text DEFAULT '08H A 08H' NOT NULL,
	`hora_entrada` text DEFAULT '08' NOT NULL,
	`hora_saida` text DEFAULT '08' NOT NULL,
	`lotacao` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `policiais` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nome` text NOT NULL,
	`matricula` text NOT NULL,
	`cargo` text NOT NULL,
	`telefone` text,
	`lotacao` text NOT NULL,
	`ativo` integer DEFAULT 1 NOT NULL,
	`senha` text DEFAULT 'ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f' NOT NULL,
	`primeiro_acesso` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `policiais_matricula_unique` ON `policiais` (`matricula`);--> statement-breakpoint
CREATE INDEX `idx_policiais_lotacao` ON `policiais` (`lotacao`);--> statement-breakpoint
CREATE INDEX `idx_policiais_cargo` ON `policiais` (`cargo`);--> statement-breakpoint
CREATE TABLE `sessoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`tipo` text NOT NULL,
	`usuario_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessoes_token_unique` ON `sessoes` (`token`);--> statement-breakpoint
CREATE INDEX `idx_sessoes_token` ON `sessoes` (`token`);--> statement-breakpoint
CREATE INDEX `idx_sessoes_expires` ON `sessoes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `unidades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nome` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unidades_nome_unique` ON `unidades` (`nome`);--> statement-breakpoint
CREATE INDEX `idx_unidades_nome` ON `unidades` (`nome`);