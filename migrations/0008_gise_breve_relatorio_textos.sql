-- Textos do bloco "Breve relatório" nos PDFs de extra (seccional e supervisão).
-- NULL = herdar Config. GISE / padrão do sistema (não colunas forçadas).
ALTER TABLE gise_escalas ADD COLUMN breve_relatorio_titulo TEXT;
ALTER TABLE gise_escalas ADD COLUMN breve_relatorio_texto_seccional TEXT;
ALTER TABLE gise_escalas ADD COLUMN breve_relatorio_texto_supervisao TEXT;
