ALTER TABLE escala_documentos ADD COLUMN selfie_key text;
ALTER TABLE escala_documentos ADD COLUMN arquivo_hash text;

ALTER TABLE gise_documentos ADD COLUMN selfie_key text;
ALTER TABLE gise_documentos ADD COLUMN arquivo_hash text;

ALTER TABLE gise_assinaturas_relatorios ADD COLUMN selfie_key text;
ALTER TABLE gise_assinaturas_relatorios ADD COLUMN arquivo_hash text;
