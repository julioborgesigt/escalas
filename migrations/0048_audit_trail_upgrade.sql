-- Migration 0048: Audit Trail Upgrade - Email + Tipo de Carimbo de Tempo
-- Adiciona rastreabilidade expandida para conformidade com a Lei 14.063/2020 e LGPD
-- Safe: todas as colunas têm DEFAULT NULL ou DEFAULT 'servidor'

-- Documentos de escalas regulares
ALTER TABLE escala_documentos ADD COLUMN assinante_email TEXT;
ALTER TABLE escala_documentos ADD COLUMN tipo_carimbo_tempo TEXT DEFAULT 'servidor';

-- Documentos GISE (assinatura do supervisor)
ALTER TABLE gise_documentos ADD COLUMN assinante_email TEXT;
ALTER TABLE gise_documentos ADD COLUMN tipo_carimbo_tempo TEXT DEFAULT 'servidor';

-- Assinaturas de relatórios GISE (seccionais)
ALTER TABLE gise_assinaturas_relatorios ADD COLUMN assinante_email TEXT;
ALTER TABLE gise_assinaturas_relatorios ADD COLUMN tipo_carimbo_tempo TEXT DEFAULT 'servidor';
