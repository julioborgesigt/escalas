-- Estado que o `preparar` produz e o `finalizar` precisa, carregado pela
-- INTENÇÃO em vez de pelo corpo da requisição.
--
-- Nasce com a assinatura em DUAS FASES da escala (passkey): o `preparar` valida
-- as evidências, monta o PDF e sobe a selfie; o `finalizar`, que só chega depois
-- da cerimônia biométrica, grava a linha em `escala_documentos` — e precisa dos
-- mesmos valores que foram desenhados no manifesto.
--
-- Por que não pelo cliente:
--
--   * `selfie_key` aponta para um objeto do bucket. Deixar o cliente devolvê-la
--     permitiria apontar o documento para a selfie de outra pessoa — a mesma
--     classe do FLW-DOC-001, quando era o cliente quem escolhia a chave no R2.
--   * `latitude`/`longitude` já estão DESENHADAS no PDF que a passkey assinou.
--     Recebê-las de novo do cliente deixaria o banco dizer um lugar e o
--     documento assinado dizer outro, sem nada acusando a divergência.
--
-- Tudo NULL no fluxo por Token A3 e quando foto/GPS não são exigidos. Nenhuma
-- linha existente muda.

ALTER TABLE `assinatura_intencoes` ADD COLUMN `selfie_key` text;
--> statement-breakpoint
ALTER TABLE `assinatura_intencoes` ADD COLUMN `latitude` real;
--> statement-breakpoint
ALTER TABLE `assinatura_intencoes` ADD COLUMN `longitude` real;
