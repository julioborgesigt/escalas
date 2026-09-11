-- `aceites_termos.usuario_tipo` passa a admitir `colaborador`.
--
-- Fase 2 do módulo de diárias: a terceira identidade (`colaboradores`,
-- migração 0082) vai aceitar o Termo de Uso como qualquer outro usuário, e o
-- aceite grava `usuario_tipo`. A restrição de 0013 é `CHECK (usuario_tipo IN
-- ('policial', 'admin'))` — no BANCO, não no TypeScript —, então o primeiro
-- aceite de um colaborador falharia em runtime sem que type-check ou teste sem
-- banco acusassem nada. Por isso esta migração vem ANTES de existir qualquer
-- colaborador (plano, seção 13.1).
--
-- O `CHECK` continua existindo, com o terceiro valor: é a única proteção real
-- contra `usuario_tipo` inventado, e uma quarta identidade não está no
-- horizonte (o plano descartou "colaborador em `policiais`" e "admin fraco" por
-- motivos medidos — seção 4.1).
--
-- ATENÇÃO AO REBUILD. SQLite não tem ALTER TABLE ... DROP CONSTRAINT, então a
-- troca exige recriar a tabela — e ela guarda REGISTRO DE CONFORMIDADE: a
-- manifestação de aceite de cada pessoa, com versão, hash, IP anonimizado,
-- user-agent e o snapshot do texto aceito (Lei 14.063/2020 art. 4º §1º + LGPD
-- art. 7º, V). A lista de colunas abaixo é o estado ATUAL, não o de 0013:
--   * 0021: aceitou_uso_email, aceitou_uso_localizacao;
--   * 0026: conteudo_html_snapshot;
--   * 0027: aceitou_assinatura_avancada.
-- São 13 colunas. Copiar a definição de 0013 dropa as 4 acrescentadas depois, e
-- o sintoma aparece longe daqui. O teste `aceites-termos-rebuild.test.ts`
-- confere as 13 pelo PRAGMA e a contagem antes/depois.
--
-- O runbook (DEPLOY.md) pede backup recente antes de reconstrução de tabela;
-- `npm run db:migrate:prod` só roda com `--yes`.

PRAGMA foreign_keys=OFF;
--> statement-breakpoint

CREATE TABLE `aceites_termos_nova` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`usuario_tipo` text NOT NULL CHECK (`usuario_tipo` IN ('policial', 'admin', 'colaborador')),
	`usuario_id` integer NOT NULL,
	`versao_termo` text NOT NULL,
	`hash_termo` text NOT NULL,
	`aceitou_lgpd` integer NOT NULL DEFAULT 0,
	`ip` text,
	`user_agent` text,
	`aceitou_em` text NOT NULL DEFAULT (datetime('now', '-3 hours')),
	`aceitou_uso_email` integer NOT NULL DEFAULT 0,
	`aceitou_uso_localizacao` integer NOT NULL DEFAULT 0,
	`conteudo_html_snapshot` text,
	`aceitou_assinatura_avancada` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint

INSERT INTO `aceites_termos_nova` (
	`id`, `usuario_tipo`, `usuario_id`, `versao_termo`, `hash_termo`, `aceitou_lgpd`,
	`ip`, `user_agent`, `aceitou_em`, `aceitou_uso_email`, `aceitou_uso_localizacao`,
	`conteudo_html_snapshot`, `aceitou_assinatura_avancada`
)
SELECT
	`id`, `usuario_tipo`, `usuario_id`, `versao_termo`, `hash_termo`, `aceitou_lgpd`,
	`ip`, `user_agent`, `aceitou_em`, `aceitou_uso_email`, `aceitou_uso_localizacao`,
	`conteudo_html_snapshot`, `aceitou_assinatura_avancada`
FROM `aceites_termos`;
--> statement-breakpoint

DROP TABLE `aceites_termos`;
--> statement-breakpoint

ALTER TABLE `aceites_termos_nova` RENAME TO `aceites_termos`;
--> statement-breakpoint

-- Índice recriado exatamente como em 0013.
CREATE INDEX IF NOT EXISTS `idx_aceites_termos_usuario`
	ON `aceites_termos` (`usuario_tipo`, `usuario_id`, `aceitou_em` DESC);
--> statement-breakpoint

PRAGMA foreign_keys=ON;
