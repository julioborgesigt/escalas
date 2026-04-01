-- Índices de performance adicionados em 2026-04
-- Melhora queries de listagem filtrada por status, lotação e campos comuns

CREATE INDEX IF NOT EXISTS idx_policiais_ativo ON policiais(ativo);
CREATE INDEX IF NOT EXISTS idx_escalas_lotacao ON escalas(lotacao);
CREATE INDEX IF NOT EXISTS idx_escalas_created_at ON escalas(created_at);
CREATE INDEX IF NOT EXISTS idx_gise_escalas_status ON gise_escalas(status);
CREATE INDEX IF NOT EXISTS idx_gise_presencas_gise ON gise_presencas(gise_id);
