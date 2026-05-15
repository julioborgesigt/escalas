-- LGPD A10: Registro de incidentes de segurança (art. 48)
CREATE TABLE IF NOT EXISTS lgpd_incidentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  tipo_incidente TEXT NOT NULL DEFAULT 'acesso_nao_autorizado',
  data_ocorrencia TEXT,
  data_descoberta TEXT NOT NULL,
  dados_afetados TEXT NOT NULL,
  usuarios_afetados_estimativa INTEGER,
  gravidade TEXT NOT NULL DEFAULT 'media',
  status TEXT NOT NULL DEFAULT 'aberto',
  responsavel_nome TEXT NOT NULL,
  responsavel_email TEXT NOT NULL,
  notificado_anpd_em TEXT,
  prazo_notificacao_anpd TEXT,
  medidas_tomadas TEXT,
  created_by_id INTEGER NOT NULL,
  created_by_nome TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
CREATE INDEX IF NOT EXISTS idx_lgpd_incidentes_status ON lgpd_incidentes(status, created_at);
CREATE INDEX IF NOT EXISTS idx_lgpd_incidentes_gravidade ON lgpd_incidentes(gravidade);
