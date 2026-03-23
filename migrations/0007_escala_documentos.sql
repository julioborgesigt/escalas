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
CREATE UNIQUE INDEX `escala_documentos_escala_id_unique` ON `escala_documentos` (`escala_id`);
