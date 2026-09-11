-- `colaboradores` — a terceira identidade do sistema.
--
-- Fase 2 do módulo de diárias (plano de set/2026, seção 4.1). Servidora
-- administrativa e colaboradora terceirizada não cabem nas duas identidades
-- existentes: em `policiais` apareceriam nos seletores de escala e no efetivo
-- do plano, com matrícula e cargo que não têm; em `administradores` ganhariam
-- Admin Geral em todos os ~160 pontos que perguntam `tipo === 'admin'`. Tabela
-- própria com tipo de sessão próprio FALHA FECHADO por construção: como o tipo
-- não é `'admin'` nem `'policial'`, todas essas verificações respondem "não"
-- sozinhas, e o acesso é só o que for concedido de forma explícita.
--
-- O e-mail é o identificador de login (não há matrícula) e o canal do 2FA, por
-- isso é único e obrigatório. CPF cifrado em repouso e índice cego, como em
-- `policiais` — para o Requerimento e para o login por certificado. `senha` no
-- mesmo formato PBKDF2 com pepper. `primeiro_acesso` passa pelo mesmo portão
-- de onboarding (troca de senha, aceite do termo). Desativar revoga sessões,
-- como já ocorre com policial.
--
-- Esta migração só cria a tabela. Nada a lê ainda: o login, a sessão e a tela
-- do Super Admin que cria contas vêm no passo seguinte (2b). Aceite do termo
-- por colaborador exige a 0081 (CHECK em `aceites_termos`), que vem antes.
CREATE TABLE IF NOT EXISTS `colaboradores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nome` text NOT NULL,
	`email` text NOT NULL,
	`senha` text NOT NULL,
	`cpf` text,
	`cpf_index` text,
	-- Empresa ou contrato — a quem a conta pertence, para saber quando revogar.
	`vinculo` text NOT NULL DEFAULT '',
	`primeiro_acesso` integer NOT NULL DEFAULT 1,
	`ativo` integer NOT NULL DEFAULT 1,
	-- Quem criou (Super Admin, decisão 23), em snapshot.
	`criado_por_id` integer,
	`criado_por_nome` text NOT NULL DEFAULT '',
	`created_at` text NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `colaboradores_email_unique` ON `colaboradores` (`email`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_colaboradores_cpf_index` ON `colaboradores` (`cpf_index`);
