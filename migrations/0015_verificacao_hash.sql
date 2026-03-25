-- Adiciona coluna de hash de verificação para validação via QR code
ALTER TABLE escala_documentos ADD COLUMN verificacao_hash TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `escala_documentos_verificacao_hash_unique` ON `escala_documentos` (`verificacao_hash`);
