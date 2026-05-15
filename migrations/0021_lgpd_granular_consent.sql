-- M17: Consentimento granular (art. 7, V e IX, LGPD)
-- Adiciona flags de consentimento separados por finalidade à tabela aceites_termos.
ALTER TABLE aceites_termos ADD COLUMN aceitou_uso_email INTEGER NOT NULL DEFAULT 0;
ALTER TABLE aceites_termos ADD COLUMN aceitou_uso_localizacao INTEGER NOT NULL DEFAULT 0;
