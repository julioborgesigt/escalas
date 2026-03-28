-- Migration: GISE Presenças e Rubricas
-- Cria a tabela para armazenar horários de entrada/saída efetivos e as rubricas dos policiais na GISE.

CREATE TABLE IF NOT EXISTS gise_presencas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gise_id INTEGER NOT NULL REFERENCES gise_escalas(id) ON DELETE CASCADE,
    policial_id INTEGER NOT NULL REFERENCES policiais(id) ON DELETE CASCADE,
    dia TEXT NOT NULL CHECK (dia IN ('sabado', 'domingo')),
    entrada_timestamp TEXT, -- ISO string da hora que clicou
    entrada_rubrica TEXT,   -- Base64 da rubrica
    saida_timestamp TEXT,   -- ISO string da hora que clicou
    saida_rubrica TEXT,     -- Base64 da rubrica
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(gise_id, policial_id, dia)
);
