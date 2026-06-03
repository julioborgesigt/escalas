-- Recria dois_fatores_tokens expandindo o CHECK para incluir
-- 'verificacao_email' (já usado no código mas ausente da constraint anterior)
-- e 'login_certificado' (novo: autenticação via Token A3 ICP-Brasil).
DROP TABLE IF EXISTS dois_fatores_tokens_backup_0028;
ALTER TABLE dois_fatores_tokens RENAME TO dois_fatores_tokens_backup_0028;

CREATE TABLE dois_fatores_tokens (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	desafio_id TEXT NOT NULL UNIQUE,
	tipo TEXT NOT NULL CHECK(tipo IN (
		'policial',
		'admin',
		'assinatura',
		'reset_policial',
		'reset_admin',
		'verificacao_email',
		'login_certificado'
	)),
	usuario_id INTEGER NOT NULL,
	codigo TEXT NOT NULL,
	tentativas INTEGER NOT NULL DEFAULT 0,
	expires_at TEXT NOT NULL,
	usado INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

INSERT INTO dois_fatores_tokens (
	id, desafio_id, tipo, usuario_id, codigo,
	tentativas, expires_at, usado, created_at
)
SELECT
	id, desafio_id, tipo, usuario_id, codigo,
	tentativas, expires_at, usado, created_at
FROM dois_fatores_tokens_backup_0028;

CREATE UNIQUE INDEX IF NOT EXISTS dois_fatores_tokens_desafio_id_unique
	ON dois_fatores_tokens (desafio_id);
CREATE INDEX IF NOT EXISTS idx_2fa_desafio
	ON dois_fatores_tokens (desafio_id);

DROP TABLE dois_fatores_tokens_backup_0028;
