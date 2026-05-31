-- Aceite EXPRESSO da assinatura eletronica avancada (Lei 14.063/2020 art. 4o II).
--
-- A oponibilidade da assinatura AVANCADA depende de aceitacao previa pelas
-- partes (art. 4o, II, da Lei 14.063/2020 e art. 10, par. 2o, da MP 2.200-2/2001).
-- Ate aqui o aceite do termo era generico (aceitou_termo + aceitou_lgpd). Esta
-- coluna registra uma manifestacao ESPECIFICA e separada de que o usuario aceita
-- a assinatura avancada como valida e suficiente, renunciando a impugna-la apenas
-- por ser eletronica/nao-ICP. Evidencia mais dificil de contestar em juizo.
--
-- Registros antigos ficam com 0 (aceitaram um termo anterior, sem esta clausula);
-- o bump da versao do termo (1.1 -> 1.2) forca o reaceite com a nova caixa.

ALTER TABLE aceites_termos ADD COLUMN aceitou_assinatura_avancada INTEGER NOT NULL DEFAULT 0;
