-- Migration 0036: Refatoração do fluxo de status da escala GISE
-- Expande o enum de 4 para 8 valores para suportar o ciclo operacional completo.

-- SQLite não suporta ALTER COLUMN com novos CHECK constraints diretamente.
-- A estratégia é recriar a tabela com o novo CHECK e migrar os dados.

PRAGMA foreign_keys = OFF;

-- 1. Criar tabela temporária com o novo schema de status
CREATE TABLE gise_escalas_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  data_inicio  TEXT    NOT NULL,
  hora_entrada TEXT    NOT NULL DEFAULT '08:00',
  hora_saida   TEXT    NOT NULL DEFAULT '16:00',
  status       TEXT    NOT NULL DEFAULT 'em_definicao_supervisor'
               CHECK (status IN (
                 'em_definicao_supervisor',
                 'em_preenchimento',
                 'aguardando_assinatura',
                 'em_andamento',
                 'aguardando_relatorios',
                 'aguardando_assinatura_relat',
                 'pronta_para_finalizar',
                 'finalizada'
               )),
  supervisor_id INTEGER,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 2. Migrar dados existentes mapeando os status antigos para os novos
INSERT INTO gise_escalas_new (id, data_inicio, hora_entrada, hora_saida, status, supervisor_id, created_at)
SELECT
  id,
  data_inicio,
  hora_entrada,
  hora_saida,
  CASE status
    -- 'em_preenchimento' sem supervisor → volta para a etapa mais cedo
    WHEN 'em_preenchimento' THEN
      CASE WHEN supervisor_id IS NOT NULL THEN 'em_preenchimento' ELSE 'em_definicao_supervisor' END
    -- 'aguardando_assinatura' → mantém
    WHEN 'aguardando_assinatura' THEN 'aguardando_assinatura'
    -- 'assinada' → agora é 'em_andamento'
    WHEN 'assinada' THEN 'em_andamento'
    -- 'finalizada' → mantém
    WHEN 'finalizada' THEN 'finalizada'
    -- fallback seguro
    ELSE 'em_preenchimento'
  END AS status,
  supervisor_id,
  created_at
FROM gise_escalas;

-- 3. Remover tabela antiga e renomear a nova
DROP TABLE gise_escalas;
ALTER TABLE gise_escalas_new RENAME TO gise_escalas;

-- 4. Recriar índices
CREATE INDEX IF NOT EXISTS idx_gise_escalas_status ON gise_escalas(status);

PRAGMA foreign_keys = ON;
