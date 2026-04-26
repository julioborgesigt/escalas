-- E-mail do assessor para avisos de preenchimento das seccionais (GISE).
-- Preenchido/confirmado pelo Admin Geral ao salvar o quadro de supervisão.
ALTER TABLE gise_escalas ADD COLUMN assessor_email_notificacao TEXT;
