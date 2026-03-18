-- Policiais (officers)
CREATE TABLE IF NOT EXISTS policiais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    matricula TEXT NOT NULL UNIQUE,
    cargo TEXT NOT NULL CHECK(cargo IN ('DPC', 'OIP')),
    telefone TEXT,
    lotacao TEXT NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Escalas (schedules)
CREATE TABLE IF NOT EXISTS escalas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    cidade TEXT NOT NULL,
    data_inicio TEXT NOT NULL,
    data_fim TEXT NOT NULL,
    horario TEXT NOT NULL DEFAULT '08H A 08H',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Escala items (which officers are on which schedule)
CREATE TABLE IF NOT EXISTS escala_policiais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    escala_id INTEGER NOT NULL,
    policial_id INTEGER NOT NULL,
    data_plantao TEXT NOT NULL,
    FOREIGN KEY (escala_id) REFERENCES escalas(id) ON DELETE CASCADE,
    FOREIGN KEY (policial_id) REFERENCES policiais(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_escala_policiais_escala ON escala_policiais(escala_id);
CREATE INDEX IF NOT EXISTS idx_escala_policiais_policial ON escala_policiais(policial_id);
CREATE INDEX IF NOT EXISTS idx_policiais_lotacao ON policiais(lotacao);
CREATE INDEX IF NOT EXISTS idx_policiais_cargo ON policiais(cargo);
