-- Metadados de verificação criptográfica de assinaturas (CAdES-LT).
--
-- Adiciona, nas três tabelas que armazenam assinaturas:
--   - dados extraídos do certificado X.509 do signatário (issuer, serial, validade)
--   - hash SHA-256 do CMS embutido (detecção de adulteração do registro)
--   - resposta OCSP carimbada (snapshot RFC 6960) e momento da consulta
--   - token TSA RFC 3161 quando presente
--
-- Migração puramente aditiva e nullable: registros assinados antes desta
-- migração continuam visíveis na página /validar/[hash], com aviso de
-- "Verificação OCSP indisponível" para os campos que não existirem.

ALTER TABLE escala_documentos ADD COLUMN cert_issuer TEXT;
ALTER TABLE escala_documentos ADD COLUMN cert_serial TEXT;
ALTER TABLE escala_documentos ADD COLUMN cert_valido_de TEXT;
ALTER TABLE escala_documentos ADD COLUMN cert_valido_ate TEXT;
ALTER TABLE escala_documentos ADD COLUMN cms_sha256 TEXT;
ALTER TABLE escala_documentos ADD COLUMN ocsp_response_b64 TEXT;
ALTER TABLE escala_documentos ADD COLUMN ocsp_consultado_em TEXT;
ALTER TABLE escala_documentos ADD COLUMN tst_token_b64 TEXT;

ALTER TABLE gise_documentos ADD COLUMN cert_issuer TEXT;
ALTER TABLE gise_documentos ADD COLUMN cert_serial TEXT;
ALTER TABLE gise_documentos ADD COLUMN cert_valido_de TEXT;
ALTER TABLE gise_documentos ADD COLUMN cert_valido_ate TEXT;
ALTER TABLE gise_documentos ADD COLUMN cms_sha256 TEXT;
ALTER TABLE gise_documentos ADD COLUMN ocsp_response_b64 TEXT;
ALTER TABLE gise_documentos ADD COLUMN ocsp_consultado_em TEXT;
ALTER TABLE gise_documentos ADD COLUMN tst_token_b64 TEXT;

ALTER TABLE gise_assinaturas_relatorios ADD COLUMN cert_issuer TEXT;
ALTER TABLE gise_assinaturas_relatorios ADD COLUMN cert_serial TEXT;
ALTER TABLE gise_assinaturas_relatorios ADD COLUMN cert_valido_de TEXT;
ALTER TABLE gise_assinaturas_relatorios ADD COLUMN cert_valido_ate TEXT;
ALTER TABLE gise_assinaturas_relatorios ADD COLUMN cms_sha256 TEXT;
ALTER TABLE gise_assinaturas_relatorios ADD COLUMN ocsp_response_b64 TEXT;
ALTER TABLE gise_assinaturas_relatorios ADD COLUMN ocsp_consultado_em TEXT;
ALTER TABLE gise_assinaturas_relatorios ADD COLUMN tst_token_b64 TEXT;
