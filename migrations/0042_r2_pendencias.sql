-- Pendência de limpeza do R2: o objeto que NÃO conseguiu ser apagado
-- (FLW-R2-004).
--
-- `deletarChavesR2` é best-effort de propósito, e isso continua valendo: a
-- remoção da LINHA no D1 é a fonte da verdade de `/validar`, e ela não pode
-- ficar refém do storage. O que estava errado era o preço. A função devolvia
-- quantas chaves foram TENTADAS, tratava a rejeição como um `logger.warn` e
-- seguia; o chamador então apagava a linha que guardava o `r2_key`. Depois
-- disso o objeto existe no bucket e nada no sistema sabe que ele existe —
-- irrastreável por definição, porque a única referência acabou de ser apagada.
--
-- O que sobra no bucket não é lixo neutro: é PDF com manifesto forense
-- (CPF, IP, GPS) e selfie biométrica (LGPD art. 11). Dado pessoal retido sem
-- base legal e sem ninguém para responder por ele.
--
-- A política é a MESMA já decidida para a trilha de auditoria (FLW-AUDIT-001):
-- pendência durável e segue. A transição do usuário vale, a chave espera aqui,
-- e `reprocessarPendenciasR2` tenta de novo no mesmo cron de retenção. A chave
-- é capturada ANTES de a linha sumir, que é o ponto — depois seria tarde.
CREATE TABLE IF NOT EXISTS `r2_pendencias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	-- A chave do objeto no bucket. Única: a mesma chave falhando duas vezes é a
	-- mesma pendência, não duas.
	`chave` text NOT NULL UNIQUE,
	-- De onde veio, para triagem sem consultar outra tabela.
	`origem` text NOT NULL,
	-- Por que o delete falhou. Diz ao operador se é transitório (some sozinho na
	-- próxima drenagem) ou permanente (volta sempre, e alguém precisa olhar).
	`motivo` text NOT NULL,
	`tentativas` integer DEFAULT 0 NOT NULL,
	`ultima_tentativa_em` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
-- O reprocessamento drena em ordem de chegada.
CREATE INDEX IF NOT EXISTS `idx_r2_pendencias_created` ON `r2_pendencias` (`created_at`);
