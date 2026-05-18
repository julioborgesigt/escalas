-- Preserva o User-Agent ORIGINAL (bruto) dos documentos assinados.
--
-- O sistema sempre gravou `user_agent` no formato legivel parseado pelo
-- parseUserAgent (ex.: "Chrome 114 / Windows 10 / Desktop"). Util para
-- exibicao no manifesto do PDF, mas perde dados forenses relevantes:
-- versao exata do navegador, tokens especificos do dispositivo, GPU,
-- etc. que podem ser determinantes em pericia.
--
-- Esta migracao adiciona a coluna `user_agent_raw` mantendo a string
-- bruta. A logica de gravacao passa a salvar ambas (raw + parseada).
-- Registros antigos ficam com NULL no raw (compat preservada).
--
-- Aplica nas 3 tabelas de assinatura.

ALTER TABLE escala_documentos ADD COLUMN user_agent_raw TEXT;
--> statement-breakpoint
ALTER TABLE gise_documentos ADD COLUMN user_agent_raw TEXT;
--> statement-breakpoint
ALTER TABLE gise_assinaturas_relatorios ADD COLUMN user_agent_raw TEXT;
