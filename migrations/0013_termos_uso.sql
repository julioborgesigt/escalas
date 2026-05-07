-- Aceites do Termo de Uso e Política de Privacidade.
--
-- O CONTEÚDO do termo (e a versão vigente) ficam versionados em código
-- (src/lib/server/termo/termo-vigente.ts), não no banco — assim cada
-- mudança passa por code review. O banco armazena apenas as MANIFESTAÇÕES
-- de aceite individual, com prova jurídica suficiente (Lei 14.063/2020
-- art. 4º §1º + LGPD art. 7º, V).

CREATE TABLE aceites_termos (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	usuario_tipo TEXT NOT NULL CHECK (usuario_tipo IN ('policial', 'admin')),
	usuario_id INTEGER NOT NULL,
	versao_termo TEXT NOT NULL,
	hash_termo TEXT NOT NULL,
	aceitou_lgpd INTEGER NOT NULL DEFAULT 0,
	ip TEXT,
	user_agent TEXT,
	aceitou_em TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);

CREATE INDEX idx_aceites_termos_usuario
	ON aceites_termos (usuario_tipo, usuario_id, aceitou_em DESC);
