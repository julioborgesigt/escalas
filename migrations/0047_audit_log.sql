-- Tabela de log de auditoria para rastreabilidade de ações no sistema.
-- Fundamental para sistema policial: registra QUEM fez O QUE, QUANDO e DE ONDE.

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    usuario_nome TEXT NOT NULL DEFAULT '',
    usuario_papel TEXT,
    acao TEXT NOT NULL,
    entidade TEXT NOT NULL,
    entidade_id INTEGER,
    detalhes TEXT,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_audit_usuario ON audit_log(usuario_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entidade ON audit_log(entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_audit_acao ON audit_log(acao);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at);
