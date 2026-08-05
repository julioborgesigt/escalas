-- Âncora de um corte de retenção na trilha de auditoria (FLW-AUDIT-005).
--
-- A retenção apaga o PREFIXO de `audit_log` além do prazo, e isso é legítimo
-- (LGPD art. 16). O problema era o verificador: ao encontrar a primeira linha
-- sobrevivente, ele aceitava tanto `GENESIS` quanto "deve ter sido a retenção"
-- e seguia em frente. Com isso, apagar as primeiras N linhas da cadeia — para
-- sumir com um evento — produzia uma trilha que continuava verificando `ok`.
-- A página de integridade dizia que estava tudo certo.
--
-- O checkpoint é o que separa as duas coisas. Ele guarda ONDE o corte parou e
-- QUAL era o `hash_registro` da última linha removida — que é exatamente o
-- `hash_anterior` que a primeira sobrevivente carrega. O verificador só aceita
-- um novo início de cadeia quando existe checkpoint casando nos dois campos;
-- sem ele, o buraco volta a ser o que sempre foi: uma remoção não explicada.
--
-- Escrito na MESMA transação do DELETE. Fora dela, uma falha entre os dois
-- recria precisamente o estado que o achado descreve.
CREATE TABLE IF NOT EXISTS `audit_checkpoints` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	-- Último `seq` removido pelo corte. A primeira linha sobrevivente é
	-- `seq_ate + 1`; qualquer outra distância é buraco não explicado.
	`seq_ate` integer NOT NULL UNIQUE,
	-- `hash_registro` daquela linha — o elo que a sobrevivente aponta.
	`hash_ate` text NOT NULL,
	-- Quantas linhas o corte levou, para o operador conferir a ordem de grandeza.
	`removidos` integer NOT NULL,
	-- Política aplicada, em texto (ex.: 'retencao:5anos'). Um corte fora da
	-- política vira um checkpoint que DIZ isso, em vez de passar despercebido.
	`politica` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
