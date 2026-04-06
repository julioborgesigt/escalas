-- Adicionar metadados de auditoria e GPS para assinaturas e presenças GISE
ALTER TABLE gise_presencas ADD COLUMN ip_address TEXT;
ALTER TABLE gise_presencas ADD COLUMN user_agent TEXT;
ALTER TABLE gise_presencas ADD COLUMN latitude REAL;
ALTER TABLE gise_presencas ADD COLUMN longitude REAL;

ALTER TABLE gise_assinaturas_relatorios ADD COLUMN ip_address TEXT;
ALTER TABLE gise_assinaturas_relatorios ADD COLUMN user_agent TEXT;
ALTER TABLE gise_assinaturas_relatorios ADD COLUMN latitude REAL;
ALTER TABLE gise_assinaturas_relatorios ADD COLUMN longitude REAL;

ALTER TABLE gise_documentos ADD COLUMN ip_address TEXT;
ALTER TABLE gise_documentos ADD COLUMN user_agent TEXT;
ALTER TABLE gise_documentos ADD COLUMN latitude REAL;
ALTER TABLE gise_documentos ADD COLUMN longitude REAL;

-- Também para documentos de escala normal (quando assinados via sistema)
ALTER TABLE escala_documentos ADD COLUMN ip_address TEXT;
ALTER TABLE escala_documentos ADD COLUMN user_agent TEXT;
ALTER TABLE escala_documentos ADD COLUMN latitude REAL;
ALTER TABLE escala_documentos ADD COLUMN longitude REAL;
