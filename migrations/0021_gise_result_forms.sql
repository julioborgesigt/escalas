-- Migration: GISE Result Forms
-- Adiciona tabelas para o modelo de formulário de resultados e as respostas dos policiais.

CREATE TABLE IF NOT EXISTS gise_modelo_formulario (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config TEXT NOT NULL, -- JSON com a estrutura das perguntas
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gise_respostas_formulario (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gise_id INTEGER NOT NULL REFERENCES gise_escalas(id) ON DELETE CASCADE,
    policial_id INTEGER NOT NULL REFERENCES policiais(id) ON DELETE CASCADE,
    respostas TEXT NOT NULL, -- JSON com as respostas do policial
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(gise_id, policial_id)
);

-- Inserir um modelo vazio inicial se não existir
INSERT OR IGNORE INTO gise_modelo_formulario (id, config) VALUES (1, '[]');
