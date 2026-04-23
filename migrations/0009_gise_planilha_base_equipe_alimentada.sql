-- Registra que a GISE já teve linhas enviadas com sucesso à planilha Base_Equipe (manual ou pós-finalizar).
ALTER TABLE gise_escalas ADD COLUMN planilha_base_equipe_alimentada_em TEXT;
