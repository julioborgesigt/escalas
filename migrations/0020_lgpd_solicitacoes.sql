-- LGPD A16: Solicitações de direitos dos titulares (art. 18)
CREATE TABLE IF NOT EXISTS lgpd_solicitacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitante_tipo TEXT NOT NULL,
  solicitante_id INTEGER NOT NULL,
  solicitante_nome TEXT NOT NULL,
  tipo_direito TEXT NOT NULL,
  descricao TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  resposta TEXT,
  respondido_por_nome TEXT,
  respondido_em TEXT,
  prazo_resposta TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX IF NOT EXISTS idx_lgpd_sol_solicitante ON lgpd_solicitacoes(solicitante_tipo, solicitante_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lgpd_sol_status ON lgpd_solicitacoes(status, prazo_resposta);
