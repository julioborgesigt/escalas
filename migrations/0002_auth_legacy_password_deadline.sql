INSERT INTO configuracoes (chave, valor)
VALUES ('auth.legacy_password_deadline', '2026-07-01T00:00:00Z')
ON CONFLICT (chave) DO NOTHING;
