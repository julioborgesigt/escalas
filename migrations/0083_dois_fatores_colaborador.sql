-- `dois_fatores_tokens.tipo` passa a admitir `colaborador`.
--
-- Fase 2b do módulo de diárias: o colaborador entra por e-mail e SEMPRE com
-- 2FA (o e-mail é obrigatório na conta), e o desafio grava `tipo`. O CHECK da
-- 0028 não o admite — no BANCO, não no TypeScript —, então o primeiro login de
-- colaborador falharia em runtime sem que type-check acusasse. É o mesmo caso
-- que a 0081 tratou em `aceites_termos`; o plano listou aquela e não esta
-- (seção 13.1 fala da "única" reconstrução — passaram a ser duas).
--
-- Baixo risco, ao contrário da 0081: a tabela guarda desafios de MINUTOS,
-- expurgados de rotina. Mesmo assim copia-se tudo, como a 0010 e a 0028
-- fizeram — quem estiver no meio de um login durante o deploy não perde o
-- código que acabou de receber. As 9 colunas são as da 0028; nenhuma ALTER
-- veio depois (0056 e 0061 criaram tabelas próprias justamente para não
-- reconstruir esta).
DROP TABLE IF EXISTS dois_fatores_tokens_backup_0083;--> statement-breakpoint
ALTER TABLE dois_fatores_tokens RENAME TO dois_fatores_tokens_backup_0083;--> statement-breakpoint

CREATE TABLE dois_fatores_tokens (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	desafio_id TEXT NOT NULL UNIQUE,
	tipo TEXT NOT NULL CHECK(tipo IN (
		'policial',
		'admin',
		'colaborador',
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
);--> statement-breakpoint

INSERT INTO dois_fatores_tokens (
	id, desafio_id, tipo, usuario_id, codigo,
	tentativas, expires_at, usado, created_at
)
SELECT
	id, desafio_id, tipo, usuario_id, codigo,
	tentativas, expires_at, usado, created_at
FROM dois_fatores_tokens_backup_0083;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS dois_fatores_tokens_desafio_id_unique
	ON dois_fatores_tokens (desafio_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_2fa_desafio
	ON dois_fatores_tokens (desafio_id);--> statement-breakpoint

DROP TABLE dois_fatores_tokens_backup_0083;
