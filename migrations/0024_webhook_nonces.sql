-- M24: tabela para replay protection dos webhooks (P1.3 da auditoria).
--
-- A autenticação atual (HMAC ou Bearer em webhook-auth.ts) garante a
-- AUTENTICIDADE do payload, mas não previne reenvio: um atacante que
-- capture um body+assinatura válidos pode reenviar indefinidamente.
--
-- Padrão clássico (Stripe, Slack, GitHub):
--  1. Sender adiciona X-Webhook-Timestamp + X-Webhook-Nonce.
--  2. Receiver rejeita se timestamp fora da janela (ex: ±5min).
--  3. Receiver rejeita se nonce já visto (esta tabela).
--
-- `received_at` permite limpeza periódica: nonces fora da janela de
-- aceitação não precisam ficar armazenados — o gate de timestamp já
-- recusa qualquer replay mais antigo que `windowSeconds`.

CREATE TABLE IF NOT EXISTS webhook_nonces (
	nonce TEXT PRIMARY KEY NOT NULL,
	received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_nonces_received_at
	ON webhook_nonces (received_at);
