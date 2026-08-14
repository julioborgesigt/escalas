-- Passkey de assinatura (WebAuthn) — a chave pública que permite exigir, na
-- assinatura avançada, uma credencial sob controle biométrico do titular.
--
-- Por que existe: até aqui, o vínculo entre a assinatura em tela e a pessoa era
-- login + senha + código por e-mail, e o "assinou pelo celular" era o
-- user-agent, que é declaração do cliente. A chave privada correspondente a
-- esta linha vive no enclave do aparelho, não é exportável e só opera após
-- biometria/PIN — é o que a Lei 14.063/2020 art. 4º II "b" chama de controle
-- exclusivo dos dados de criação.
--
-- **Migração inócua.** Nenhuma coluna nova em tabela existente e nenhum
-- documento afetado: a exigência é um REFORÇO OPCIONAL, desligado por padrão
-- (`exigir_passkey_assinatura`). Instalação que não ligar a flag não percebe
-- diferença, e assinatura já gravada continua íntegra.
--
-- O dono é a PESSOA. Quem é Admin Geral vinculado tem linha em `policiais` e
-- em `administradores`; `resolverCredencial` resolve o par antes de gravar, do
-- contrário a credencial registrada num modo não valeria no outro (é o mesmo
-- erro do FLW-AUTH-002, em que a senha ia para a linha que o login não lê).
--
-- `revogado_em` em vez de DELETE: a credencial que assinou um documento tem de
-- continuar consultável depois que a pessoa troca de aparelho, senão a
-- conferência daquela assinatura fica sem contraparte. É registro probatório.

CREATE TABLE `credenciais_webauthn` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`usuario_tipo` text NOT NULL,
	`usuario_id` integer NOT NULL,
	-- base64url; identificador da credencial, não segredo.
	`credential_id` text NOT NULL,
	-- Chave pública em SPKI (base64) — o que `getPublicKey()` devolveu.
	`public_key_spki` text NOT NULL,
	-- Contador do autenticador. Regressão indica clone; 0 = não implementado.
	`contador` integer DEFAULT 0 NOT NULL,
	-- Modelo do autenticador (hex). NULL quando a cerimônia não trouxe.
	`aaguid` text,
	-- Flags BE/BS: a credencial PODE ser sincronizada / ESTÁ sincronizada.
	-- iOS e Android sincronizam por padrão, então o caso comum é 1.
	`backup_elegivel` integer DEFAULT 0 NOT NULL,
	`backup_ativo` integer DEFAULT 0 NOT NULL,
	`apelido` text,
	`criado_em` text DEFAULT (datetime('now', '-3 hours')) NOT NULL,
	`ultimo_uso` text,
	`revogado_em` text
);
--> statement-breakpoint

CREATE UNIQUE INDEX `credenciais_webauthn_credential_id_unique` ON `credenciais_webauthn` (`credential_id`);
--> statement-breakpoint
CREATE INDEX `idx_webauthn_credential` ON `credenciais_webauthn` (`credential_id`);
--> statement-breakpoint
-- Consulta quente: "a credencial ATIVA desta pessoa" (registro, assinatura,
-- revogação). `revogado_em` entra no índice porque toda leitura filtra por ele.
CREATE INDEX `idx_webauthn_dono` ON `credenciais_webauthn` (`usuario_tipo`, `usuario_id`, `revogado_em`);
