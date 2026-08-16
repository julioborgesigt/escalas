-- Colunas webauthn_* nos documentos GISE, extra e termo de presença.
--
-- A fase 0 gravou a asserção só em `escala_documentos`. Copiar o cano de
-- duas fases para GISE/extra/presença sem estas colunas nasceria já furado:
-- o manifesto afirmaria a chave e `reconferirAssercaoDocumento` não teria
-- o que reconferir. Mesmo precedente da migração 0058.
--
-- Tudo NULL para assinatura por token A3 e para a avançada em tela sem
-- passkey. Nenhuma linha existente muda.
--
-- Estas colunas vêm DEPOIS do rebuild da 0038. Reexecutar a 0038 por cima
-- dropa-as. O `migrate.ts` une `_migrations_aplicadas` com `d1_migrations`
-- para o CI (`wrangler d1 migrations apply` + global-setup) não fazer isso.

ALTER TABLE `gise_documentos` ADD COLUMN `webauthn_credential_id` text;
--> statement-breakpoint
ALTER TABLE `gise_documentos` ADD COLUMN `webauthn_client_data` text;
--> statement-breakpoint
ALTER TABLE `gise_documentos` ADD COLUMN `webauthn_authenticator_data` text;
--> statement-breakpoint
ALTER TABLE `gise_documentos` ADD COLUMN `webauthn_assinatura` text;
--> statement-breakpoint
ALTER TABLE `gise_documentos` ADD COLUMN `webauthn_backup_ativo` integer;
--> statement-breakpoint
ALTER TABLE `gise_assinaturas_relatorios` ADD COLUMN `webauthn_credential_id` text;
--> statement-breakpoint
ALTER TABLE `gise_assinaturas_relatorios` ADD COLUMN `webauthn_client_data` text;
--> statement-breakpoint
ALTER TABLE `gise_assinaturas_relatorios` ADD COLUMN `webauthn_authenticator_data` text;
--> statement-breakpoint
ALTER TABLE `gise_assinaturas_relatorios` ADD COLUMN `webauthn_assinatura` text;
--> statement-breakpoint
ALTER TABLE `gise_assinaturas_relatorios` ADD COLUMN `webauthn_backup_ativo` integer;
--> statement-breakpoint
ALTER TABLE `gise_presenca_termos` ADD COLUMN `webauthn_credential_id` text;
--> statement-breakpoint
ALTER TABLE `gise_presenca_termos` ADD COLUMN `webauthn_client_data` text;
--> statement-breakpoint
ALTER TABLE `gise_presenca_termos` ADD COLUMN `webauthn_authenticator_data` text;
--> statement-breakpoint
ALTER TABLE `gise_presenca_termos` ADD COLUMN `webauthn_assinatura` text;
--> statement-breakpoint
ALTER TABLE `gise_presenca_termos` ADD COLUMN `webauthn_backup_ativo` integer;
