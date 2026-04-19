-- Unidade sintética para assinaturas do relatório de extra do quadro de supervisão GISE
-- (supervisor DPC, assessor e SEINTs OIP). O ID é autoincremento; o código resolve por nome.
INSERT OR IGNORE INTO "unidades" ("nome", "tipo", "seccional_id", "cidade", "tem_plantao", "tem_expediente", "tem_fds")
VALUES ('__GISE_SUPERVISAO_EXTRA__', 'delegacia', NULL, '', 0, 0, 0);
