-- Artefatos da asserção WebAuthn no documento assinado — para RECONFERÊNCIA.
--
-- O manifesto do PDF já imprime "CHAVE DE ASSINATURA … biometria/PIN do
-- titular". Até aqui, o `finalizar` verificava a asserção e a descartava: o
-- documento afirmava um fato verificado e o sistema não conservava com o que
-- provar isso em perícia. É a mesma forma da falha que a política de
-- dispositivo tinha enquanto vivia só na tela — prometer o que não se guarda.
--
-- O precedente está nesta própria tabela: o fluxo QUALIFICADO guarda
-- `cms_sha256`, `ocsp_response_b64` e `tst_token_b64` (migração 0012)
-- justamente para permitir reconferir depois. Estas colunas são o equivalente
-- do caminho da passkey.
--
-- **Não ampliam a superfície de dado pessoal.** `client_data` traz apenas
-- type/challenge/origin; `authenticator_data` traz hash do domínio, flags,
-- contador e AAGUID — que identifica o MODELO do autenticador, não o aparelho;
-- a assinatura é opaca. Diferente da selfie, aqui não há o que minimizar.
--
-- Tudo NULL para assinatura por token A3 e para a assinatura em tela sem
-- passkey. Nenhuma linha existente muda.

ALTER TABLE `escala_documentos` ADD COLUMN `webauthn_credential_id` text;
--> statement-breakpoint
ALTER TABLE `escala_documentos` ADD COLUMN `webauthn_client_data` text;
--> statement-breakpoint
ALTER TABLE `escala_documentos` ADD COLUMN `webauthn_authenticator_data` text;
--> statement-breakpoint
ALTER TABLE `escala_documentos` ADD COLUMN `webauthn_assinatura` text;
--> statement-breakpoint
-- Flag BS no MOMENTO da assinatura. Guardado junto porque a credencial pode
-- passar a ser sincronizada depois: o que o documento afirma é o estado de
-- então, não o de hoje.
ALTER TABLE `escala_documentos` ADD COLUMN `webauthn_backup_ativo` integer;
