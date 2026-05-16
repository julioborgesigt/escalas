-- M23: adiciona ON DELETE explícito às FKs de escala_solicitacoes_assinatura.
--
-- Antes: solicitante_id e destinatario_id não tinham ON DELETE — qualquer
-- DELETE em policiais com solicitações vinculadas falhava com FK constraint
-- (PRAGMA foreign_keys está ON em D1).
--
-- Agora:
--   - solicitante_id: ON DELETE CASCADE (solicitação some junto com o solicitante)
--   - destinatario_id: ON DELETE SET NULL (preserva histórico do solicitante)
--
-- SQLite não suporta ALTER de FK — precisa recriar a tabela. Padrão usado em M0010.

DROP TABLE IF EXISTS escala_solicitacoes_assinatura_backup_0023;
ALTER TABLE escala_solicitacoes_assinatura RENAME TO escala_solicitacoes_assinatura_backup_0023;
--> statement-breakpoint

CREATE TABLE escala_solicitacoes_assinatura (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	escala_id INTEGER NOT NULL UNIQUE REFERENCES escalas(id) ON DELETE CASCADE,
	solicitante_id INTEGER NOT NULL REFERENCES policiais(id) ON DELETE CASCADE,
	tipo TEXT NOT NULL CHECK(tipo IN ('unidade', 'respondencia')),
	destinatario_id INTEGER REFERENCES policiais(id) ON DELETE SET NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
--> statement-breakpoint

INSERT INTO escala_solicitacoes_assinatura (
	id, escala_id, solicitante_id, tipo, destinatario_id, created_at
)
SELECT id, escala_id, solicitante_id, tipo, destinatario_id, created_at
FROM escala_solicitacoes_assinatura_backup_0023;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_esa_escala_id
	ON escala_solicitacoes_assinatura(escala_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_esa_destinatario_id
	ON escala_solicitacoes_assinatura(destinatario_id);
--> statement-breakpoint

DROP TABLE escala_solicitacoes_assinatura_backup_0023;
