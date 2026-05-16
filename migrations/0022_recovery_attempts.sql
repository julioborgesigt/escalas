-- M22: tabela dedicada para rate-limit de fluxos de recuperação de senha
-- e verificação de e-mail pessoal.
--
-- Antes: solicitar-redefinicao, confirmar-redefinicao e primeiro-acesso
-- gravavam em `login_attempts(ip, success=0)` para qualquer request, inflando
-- a contagem usada pelo rate-limit de LOGIN. Atacante "queimava" janela e
-- bloqueava logins legítimos durante 15 min.
--
-- Agora: cada fluxo grava em recovery_attempts isoladamente. Login (auth-flow)
-- continua usando login_attempts.

CREATE TABLE IF NOT EXISTS recovery_attempts (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	ip TEXT NOT NULL,
	purpose TEXT NOT NULL,           -- 'solicitar_redefinicao' | 'confirmar_redefinicao' | 'primeiro_acesso'
	attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recovery_attempts_ip_purpose_time
	ON recovery_attempts (ip, purpose, attempted_at);
