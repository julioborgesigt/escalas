-- Rubrica desenhada no `preparar` da presença avançada por passkey.
--
-- O `preparar` monta o PDF (e estampa a rubrica) sem gravar a linha de
-- presença: cancelar o Face ID não pode marcar o plantão. O `finalizar`,
-- depois da asserção, precisa da MESMA rubrica que o PDF já carrega — para
-- `gise_presencas` e o relatório extra não divergirem do termo selado.
--
-- Vai pela intenção, não pelo corpo do finalizar: a mesma classe do
-- `selfie_key` / GPS da migração 0057 (FLW-DOC-001). NULL no Token A3 e
-- nos fluxos que não carregam rubrica de tela.

ALTER TABLE `assinatura_intencoes` ADD COLUMN `rubrica` text;
