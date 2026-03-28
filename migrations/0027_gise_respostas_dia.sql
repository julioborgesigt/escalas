-- Migration: GISE Respostas por Dia
-- Adiciona a coluna 'dia' à tabela gise_respostas_formulario e atualiza a restrição de unicidade.

-- Primeiro, renomeamos a tabela antiga para caso haja necessidade de rollback ou para copiar os dados
CREATE TABLE IF NOT EXISTS gise_respostas_formulario_old AS SELECT * FROM gise_respostas_formulario;
DROP TABLE gise_respostas_formulario;

-- Criamos a nova tabela com a coluna 'dia' e a nova restrição
CREATE TABLE gise_respostas_formulario (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gise_id INTEGER NOT NULL REFERENCES gise_escalas(id) ON DELETE CASCADE,
    policial_id INTEGER NOT NULL REFERENCES policiais(id) ON DELETE CASCADE,
    dia TEXT NOT NULL CHECK (dia IN ('sabado', 'domingo')) DEFAULT 'sabado',
    respostas TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(gise_id, policial_id, dia)
);

-- Migramos os dados antigos (assumindo que as respostas anteriores eram para o 'sábado' ou contemplavam tudo)
INSERT INTO gise_respostas_formulario (gise_id, policial_id, dia, respostas, created_at, updated_at)
SELECT gise_id, policial_id, 'sabado', respostas, created_at, updated_at
FROM gise_respostas_formulario_old;

-- Removemos a tabela temporária
DROP TABLE gise_respostas_formulario_old;
