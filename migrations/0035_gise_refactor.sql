-- Refatoração GISE: cada escala agora representa um único dia específico.
-- Eliminados todos os campos 'dia' (sabado/domingo/ambos) — o dia é implícito pelo gise_id.
-- Horas unificadas por nível (escala → seccional → equipe).
-- Supervisor único por dia.

-- Remover tabelas dependentes primeiro (ordem inversa de FK)
DROP TABLE IF EXISTS gise_assinaturas_relatorios;
DROP TABLE IF EXISTS gise_presencas;
DROP TABLE IF EXISTS gise_respostas_formulario;
DROP TABLE IF EXISTS gise_membros;
DROP TABLE IF EXISTS gise_documentos;
DROP TABLE IF EXISTS gise_equipes;
DROP TABLE IF EXISTS gise_seccionais;
DROP TABLE IF EXISTS gise_escalas;

-- Escala GISE: um registro = um dia
CREATE TABLE gise_escalas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data_inicio TEXT NOT NULL,
  hora_entrada TEXT NOT NULL DEFAULT '08:00',
  hora_saida TEXT NOT NULL DEFAULT '16:00',
  status TEXT NOT NULL DEFAULT 'em_preenchimento'
    CHECK(status IN ('em_preenchimento','aguardando_assinatura','assinada','finalizada')),
  supervisor_id INTEGER REFERENCES policiais(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seccionais participantes do dia
CREATE TABLE gise_seccionais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gise_id INTEGER NOT NULL REFERENCES gise_escalas(id) ON DELETE CASCADE,
  seccional_id INTEGER NOT NULL REFERENCES unidades(id),
  unidade_operacional_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK(status IN ('pendente','preenchida','retificada','preenchida_retificada')),
  hora_entrada TEXT,
  hora_saida TEXT,
  UNIQUE(gise_id, seccional_id)
);
CREATE INDEX idx_gise_seccionais_gise ON gise_seccionais(gise_id);

-- Equipes dentro de cada seccional no dia
CREATE TABLE gise_equipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gise_seccional_id INTEGER NOT NULL REFERENCES gise_seccionais(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('operacional','seint')),
  slots_dpc INTEGER NOT NULL DEFAULT 0,
  slots_oip INTEGER NOT NULL DEFAULT 0,
  hora_entrada TEXT,
  hora_saida TEXT,
  UNIQUE(gise_seccional_id, tipo)
);
CREATE INDEX idx_gise_equipes_sec ON gise_equipes(gise_seccional_id);

-- Membros escalados para uma equipe neste dia
CREATE TABLE gise_membros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipe_id INTEGER NOT NULL REFERENCES gise_equipes(id) ON DELETE CASCADE,
  policial_id INTEGER NOT NULL REFERENCES policiais(id) ON DELETE CASCADE
);
CREATE INDEX idx_gise_membros_equipe ON gise_membros(equipe_id);
CREATE INDEX idx_gise_membros_policial ON gise_membros(policial_id);

-- Documento assinado do dia (um por escala)
CREATE TABLE gise_documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gise_id INTEGER NOT NULL REFERENCES gise_escalas(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  assinante_id INTEGER,
  assinante_nome TEXT NOT NULL DEFAULT '',
  assinante_cpf TEXT NOT NULL DEFAULT '',
  verificacao_hash TEXT UNIQUE,
  selfie_key TEXT,
  arquivo_hash TEXT,
  rubrica TEXT,
  ip_address TEXT,
  user_agent TEXT,
  latitude REAL,
  longitude REAL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(gise_id)
);

-- Presenças do dia (entrada/saída)
CREATE TABLE gise_presencas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gise_id INTEGER NOT NULL REFERENCES gise_escalas(id) ON DELETE CASCADE,
  policial_id INTEGER NOT NULL REFERENCES policiais(id) ON DELETE CASCADE,
  entrada_timestamp TEXT,
  entrada_rubrica TEXT,
  saida_timestamp TEXT,
  saida_rubrica TEXT,
  ip_address TEXT,
  user_agent TEXT,
  latitude REAL,
  longitude REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(gise_id, policial_id)
);

-- Respostas do formulário de produtividade do dia
CREATE TABLE gise_respostas_formulario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gise_id INTEGER NOT NULL REFERENCES gise_escalas(id) ON DELETE CASCADE,
  policial_id INTEGER NOT NULL REFERENCES policiais(id) ON DELETE CASCADE,
  equipe_id INTEGER REFERENCES gise_equipes(id) ON DELETE CASCADE,
  respostas TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(gise_id, policial_id)
);
CREATE INDEX idx_gise_respostas_equipe ON gise_respostas_formulario(gise_id, equipe_id);

-- Assinaturas de relatórios por seccional no dia
CREATE TABLE gise_assinaturas_relatorios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gise_id INTEGER NOT NULL REFERENCES gise_escalas(id) ON DELETE CASCADE,
  seccional_id INTEGER NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('extraordinario','produtividade')),
  assinante_id INTEGER,
  assinante_nome TEXT NOT NULL,
  assinante_cpf TEXT,
  tipo_assinatura TEXT NOT NULL CHECK(tipo_assinatura IN ('simples','webpki','serpro')),
  rubrica TEXT,
  selfie_key TEXT,
  arquivo_hash TEXT,
  verification_hash TEXT UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  latitude REAL,
  longitude REAL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(gise_id, seccional_id, tipo)
);
CREATE INDEX idx_gise_ass_rel_gise ON gise_assinaturas_relatorios(gise_id);
