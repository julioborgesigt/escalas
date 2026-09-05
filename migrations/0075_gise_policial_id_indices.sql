-- Índices para `carimboResGise` (src/lib/server/gise/sync-estado.ts), que roda
-- em TODO `GET /api/sync/estado` — o poll de fundo de cada aba aberta (30s na
-- tela quente, 120s no resto). Duas das quatro queries dele filtram por
-- `policial_id` SOZINHO:
--
--   SELECT count(*), max(updated_at) FROM gise_presencas            WHERE policial_id = ?
--   SELECT count(*), max(updated_at) FROM gise_respostas_formulario WHERE policial_id = ?
--
-- As duas tabelas já tinham UNIQUE (gise_id, policial_id), e ele NÃO serve
-- aqui: `policial_id` não é a coluna líder do índice, então o SQLite não pode
-- usá-lo para um predicado que não fixa `gise_id`. O outro índice de cada
-- tabela é em `gise_id`. Sobrava varredura completa — na query mais frequente
-- do sistema, sobre duas tabelas que crescem uma linha por policial por GISE.
--
-- Auditoria de performance de set/2026. O par (gise_id, policial_id) continua
-- coberto pelo UNIQUE; estes índices são para o outro sentido da busca.
CREATE INDEX IF NOT EXISTS idx_gise_presencas_policial
	ON gise_presencas (policial_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_gise_respostas_policial
	ON gise_respostas_formulario (policial_id);
