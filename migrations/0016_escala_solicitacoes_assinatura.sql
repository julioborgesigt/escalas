-- Tabela de solicitações de assinatura para escalas mensais (plantão/expediente).
-- Criada pelo admin seccional/unidade com cargo OIP; direciona a assinatura ao DPC competente.
CREATE TABLE IF NOT EXISTS escala_solicitacoes_assinatura (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    escala_id INTEGER NOT NULL UNIQUE REFERENCES escalas(id) ON DELETE CASCADE,
    solicitante_id INTEGER NOT NULL REFERENCES policiais(id),
    tipo TEXT NOT NULL CHECK(tipo IN ('unidade', 'respondencia')),
    destinatario_id INTEGER REFERENCES policiais(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
--> statement-breakpoint
CREATE INDEX idx_esa_escala_id ON escala_solicitacoes_assinatura(escala_id);
--> statement-breakpoint
CREATE INDEX idx_esa_destinatario_id ON escala_solicitacoes_assinatura(destinatario_id);
