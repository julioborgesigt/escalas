-- Tabela para assinaturas individuais de relatórios por seccional e dia
CREATE TABLE IF NOT EXISTS gise_assinaturas_relatorios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gise_id INTEGER NOT NULL REFERENCES gise_escalas(id) ON DELETE CASCADE,
    seccional_id INTEGER NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
    dia TEXT NOT NULL CHECK (dia IN ('sabado', 'domingo')),
    tipo TEXT NOT NULL CHECK (tipo IN ('extraordinario', 'produtividade')),
    assinante_id INTEGER NOT NULL REFERENCES policiais(id) ON DELETE CASCADE,
    assinante_nome TEXT NOT NULL,
    assinante_cpf TEXT NOT NULL,
    tipo_assinatura TEXT NOT NULL CHECK (tipo_assinatura IN ('simples', 'webpki', 'serpro')),
    rubrica TEXT, -- Para assinatura simples (base64)
    verification_hash TEXT UNIQUE, -- Para assinatura digital
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(gise_id, seccional_id, dia, tipo)
);

-- Index para busca rápida
CREATE INDEX IF NOT EXISTS idx_gise_ass_rel_gise ON gise_assinaturas_relatorios(gise_id);
