-- Account lockout: throttle por CONTA, complementando o throttle por IP.
--
-- O brute-force distribuído (vários IPs contra UMA matrícula) não era pego pelo
-- limite por IP. Esta coluna guarda o HASH do identificador da conta
-- (SHA-256 de `tipo:matricula`, normalizado) para contar tentativas falhas por
-- conta — sem armazenar a matrícula em texto no log.
--
-- Nullable: linhas antigas e fluxos que não identificam a conta (ex.: login por
-- certificado) ficam NULL e não entram na contagem por conta.
ALTER TABLE login_attempts ADD COLUMN identifier TEXT;

CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier_time
	ON login_attempts (identifier, attempted_at);
