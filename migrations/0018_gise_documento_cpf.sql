-- Adiciona campo assinante_cpf à tabela gise_documentos para assinatura digital
ALTER TABLE gise_documentos ADD COLUMN assinante_cpf TEXT NOT NULL DEFAULT '';
