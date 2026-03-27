-- 0017_gise.sql
-- RBAC: adicionar papel/papel_unidade_id a policiais
ALTER TABLE policiais ADD COLUMN papel TEXT CHECK(papel IN ('admin_seccional', 'admin_unidade'));
ALTER TABLE policiais ADD COLUMN papel_unidade_id INTEGER REFERENCES unidades(id) ON DELETE SET NULL;

-- GISE: escala mestre por fim de semana
CREATE TABLE IF NOT EXISTS gise_escalas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data_inicio TEXT NOT NULL,   -- sábado (ISO date YYYY-MM-DD)
  data_fim    TEXT NOT NULL,   -- domingo
  hora_entrada TEXT NOT NULL DEFAULT '08',
  hora_saida   TEXT NOT NULL DEFAULT '16',
  -- 'em_preenchimento' → seccionais preenchendo
  -- 'aguardando_assinatura' → todas enviadas, aguarda supervisor
  -- 'assinada' → supervisor assinou
  -- 'finalizada' → admin geral finalizou (gera próxima)
  status TEXT NOT NULL DEFAULT 'em_preenchimento'
    CHECK(status IN ('em_preenchimento','aguardando_assinatura','assinada','finalizada')),
  supervisor_sabado_id  INTEGER REFERENCES policiais(id) ON DELETE SET NULL,
  supervisor_domingo_id INTEGER REFERENCES policiais(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Participação de cada seccional em uma escala GISE
CREATE TABLE IF NOT EXISTS gise_seccionais (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  gise_id               INTEGER NOT NULL REFERENCES gise_escalas(id) ON DELETE CASCADE,
  seccional_id          INTEGER NOT NULL REFERENCES unidades(id),
  -- Unidade policial onde a Equipe Operacional atuará
  unidade_operacional_id INTEGER REFERENCES unidades(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK(status IN ('pendente','preenchida')),
  UNIQUE(gise_id, seccional_id)
);

-- Equipes de cada seccional (operacional / seint)
CREATE TABLE IF NOT EXISTS gise_equipes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  gise_seccional_id   INTEGER NOT NULL REFERENCES gise_seccionais(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('operacional','seint')),
  slots_dpc INTEGER NOT NULL DEFAULT 0,
  slots_oip INTEGER NOT NULL DEFAULT 0,
  UNIQUE(gise_seccional_id, tipo)
);

-- Membros de cada equipe
CREATE TABLE IF NOT EXISTS gise_membros (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  equipe_id   INTEGER NOT NULL REFERENCES gise_equipes(id) ON DELETE CASCADE,
  policial_id INTEGER NOT NULL REFERENCES policiais(id) ON DELETE CASCADE,
  dia TEXT NOT NULL DEFAULT 'ambos' CHECK(dia IN ('sabado','domingo','ambos'))
);

-- Documento da escala GISE assinada pelo Supervisor
CREATE TABLE IF NOT EXISTS gise_documentos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  gise_id        INTEGER NOT NULL UNIQUE REFERENCES gise_escalas(id) ON DELETE CASCADE,
  r2_key         TEXT NOT NULL,
  assinante_id   INTEGER REFERENCES policiais(id) ON DELETE SET NULL,
  assinante_nome TEXT NOT NULL DEFAULT '',
  verificacao_hash TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_gise_seccionais_gise   ON gise_seccionais(gise_id);
CREATE INDEX idx_gise_equipes_sec       ON gise_equipes(gise_seccional_id);
CREATE INDEX idx_gise_membros_equipe    ON gise_membros(equipe_id);
CREATE INDEX idx_gise_membros_policial  ON gise_membros(policial_id);
