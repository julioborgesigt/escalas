-- Migration 0023: Consolidated GISE tables for production
-- Applies schema equivalent to 0017+0018+0019+0020+0021+0022 in one safe step.
-- Uses CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS so it's idempotent.

CREATE TABLE IF NOT EXISTS gise_escalas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data_inicio TEXT NOT NULL,
  data_fim    TEXT NOT NULL,
  hora_entrada TEXT NOT NULL DEFAULT '08',
  hora_saida   TEXT NOT NULL DEFAULT '16',
  hora_entrada_sabado TEXT NOT NULL DEFAULT '08',
  hora_saida_sabado   TEXT NOT NULL DEFAULT '16',
  hora_entrada_domingo TEXT NOT NULL DEFAULT '08',
  hora_saida_domingo   TEXT NOT NULL DEFAULT '16',
  status TEXT NOT NULL DEFAULT 'em_preenchimento'
    CHECK(status IN ('em_preenchimento','aguardando_assinatura','assinada','finalizada')),
  supervisor_sabado_id  INTEGER REFERENCES policiais(id) ON DELETE SET NULL,
  supervisor_domingo_id INTEGER REFERENCES policiais(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gise_seccionais (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  gise_id                INTEGER NOT NULL REFERENCES gise_escalas(id) ON DELETE CASCADE,
  seccional_id           INTEGER NOT NULL REFERENCES unidades(id),
  unidade_operacional_id INTEGER REFERENCES unidades(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK(status IN ('pendente','preenchida','retificada')),
  hora_entrada_sabado TEXT,
  hora_saida_sabado   TEXT,
  hora_entrada_domingo TEXT,
  hora_saida_domingo   TEXT,
  UNIQUE(gise_id, seccional_id)
);

CREATE TABLE IF NOT EXISTS gise_equipes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  gise_seccional_id INTEGER NOT NULL REFERENCES gise_seccionais(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('operacional','seint')),
  slots_dpc INTEGER NOT NULL DEFAULT 0,
  slots_oip INTEGER NOT NULL DEFAULT 0,
  hora_entrada_sabado TEXT,
  hora_saida_sabado   TEXT,
  hora_entrada_domingo TEXT,
  hora_saida_domingo   TEXT,
  UNIQUE(gise_seccional_id, tipo)
);

CREATE TABLE IF NOT EXISTS gise_membros (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  equipe_id   INTEGER NOT NULL REFERENCES gise_equipes(id) ON DELETE CASCADE,
  policial_id INTEGER NOT NULL REFERENCES policiais(id) ON DELETE CASCADE,
  dia TEXT NOT NULL DEFAULT 'ambos' CHECK(dia IN ('sabado','domingo','ambos'))
);

CREATE TABLE IF NOT EXISTS gise_documentos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  gise_id        INTEGER NOT NULL REFERENCES gise_escalas(id) ON DELETE CASCADE,
  dia            TEXT NOT NULL CHECK(dia IN ('sabado','domingo','ambos')),
  r2_key         TEXT NOT NULL,
  assinante_id   INTEGER REFERENCES policiais(id) ON DELETE SET NULL,
  assinante_nome TEXT NOT NULL DEFAULT '',
  assinante_cpf  TEXT NOT NULL DEFAULT '',
  verificacao_hash TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gise_modelo_formulario (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  config     TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gise_respostas_formulario (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  gise_id     INTEGER NOT NULL REFERENCES gise_escalas(id) ON DELETE CASCADE,
  policial_id INTEGER NOT NULL REFERENCES policiais(id) ON DELETE CASCADE,
  respostas   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(gise_id, policial_id)
);

INSERT OR IGNORE INTO gise_modelo_formulario (id, config) VALUES (1, '[]');

CREATE INDEX IF NOT EXISTS idx_gise_seccionais_gise   ON gise_seccionais(gise_id);
CREATE INDEX IF NOT EXISTS idx_gise_equipes_sec       ON gise_equipes(gise_seccional_id);
CREATE INDEX IF NOT EXISTS idx_gise_membros_equipe    ON gise_membros(equipe_id);
CREATE INDEX IF NOT EXISTS idx_gise_membros_policial  ON gise_membros(policial_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gise_documentos_gise_dia ON gise_documentos(gise_id, dia);
