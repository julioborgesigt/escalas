-- Atualização da tabela para permitir assinaturas de administradores (id e cpf opcionais/nulos)
-- Primeiro, criamos uma nova tabela com a estrutura correta (SQLite não permite ALTER COLUMN facilmente para remover restrições FK/NOT NULL)

CREATE TABLE gise_assinaturas_relatorios_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gise_id INTEGER NOT NULL REFERENCES gise_escalas(id) ON DELETE CASCADE,
    seccional_id INTEGER NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
    dia TEXT NOT NULL CHECK (dia IN ('sabado', 'domingo')),
    tipo TEXT NOT NULL CHECK (tipo IN ('extraordinario', 'produtividade')),
    assinante_id INTEGER, -- Permite NULL para administradores
    assinante_nome TEXT NOT NULL,
    assinante_cpf TEXT, -- Permite NULL/Vazio
    tipo_assinatura TEXT NOT NULL CHECK (tipo_assinatura IN ('simples', 'webpki', 'serpro')),
    rubrica TEXT,
    verification_hash TEXT UNIQUE,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(gise_id, seccional_id, dia, tipo)
);

-- Migramos os dados se existirem
INSERT OR IGNORE INTO gise_assinaturas_relatorios_new SELECT * FROM gise_assinaturas_relatorios;

-- Substituímos a antiga pela nova
DROP TABLE gise_assinaturas_relatorios;
ALTER TABLE gise_assinaturas_relatorios_new RENAME TO gise_assinaturas_relatorios;

-- Recriamos o index
CREATE INDEX IF NOT EXISTS idx_gise_ass_rel_gise ON gise_assinaturas_relatorios(gise_id);
