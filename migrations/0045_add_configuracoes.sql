-- Tabela de configurações globais do sistema (chave-valor)
CREATE TABLE IF NOT EXISTS configuracoes (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

-- Valor padrão: exigir foto (prova de vida) na assinatura em tela
INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('exigir_foto_assinatura', '1');
