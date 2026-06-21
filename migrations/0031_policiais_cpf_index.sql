-- LGPD: CPF cifrado em repouso.
-- A coluna `cpf` passa a guardar o CPF cifrado (AES-GCM, formato `enc:v1:...`).
-- Como o GCM é não-determinístico, o lookup (login por certificado) usa um
-- índice cego determinístico HMAC-SHA256(CPF_INDEX_KEY, cpf) gravado aqui.
-- Sem backfill: a base é repopulada pela sincronização da planilha já cifrando.
ALTER TABLE policiais ADD COLUMN cpf_index TEXT;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_policiais_cpf_index ON policiais (cpf_index);
