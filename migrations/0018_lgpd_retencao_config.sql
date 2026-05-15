-- LGPD A6: Configurações padrão de retenção de dados (art. 16)
INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES
  ('lgpd.retencao.sessoes_dias',        '30'),
  ('lgpd.retencao.login_attempts_dias', '90'),
  ('lgpd.retencao.dois_fatores_dias',   '1'),
  ('lgpd.retencao.reset_tokens_dias',   '7'),
  ('lgpd.retencao.audit_log_anos',      '5');
