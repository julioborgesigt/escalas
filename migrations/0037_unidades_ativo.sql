-- Unidade passa a ser PERMANENTE: nunca é excluída, só desativada.
--
-- Motivo (decisão de produto, jul/2026): o nome da unidade é a chave que amarra
-- lotação de policial, escala e — via `seccional_id` — assinatura de relatório
-- de GISE. Apagar uma unidade destruía prova de documento já assinado, porque
-- `gise_assinaturas_relatorios.seccional_id` tem FK `ON DELETE CASCADE` para
-- `unidades(id)` e o D1 aplica FK de verdade (verificado). Uma unidade que só
-- some da lista de escolhas, mas continua existindo, elimina a classe inteira
-- de acidente: não há DELETE para dar errado.
--
-- `ativo = 1` para tudo que já existe: nenhuma unidade nasce desativada nesta
-- migração.

ALTER TABLE `unidades` ADD COLUMN `ativo` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint

-- A listagem de seleção filtra por `ativo`; o índice evita varredura completa
-- nas telas que montam combo de unidade (nova escala, lotação, seccional GISE).
CREATE INDEX IF NOT EXISTS `idx_unidades_ativo` ON `unidades` (`ativo`);
