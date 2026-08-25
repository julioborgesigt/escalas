-- Módulos liberados por conta de Admin Geral.
--
-- Até aqui o Admin Geral entrava nos DOIS consoles (Escalas ordinárias e GISE
-- extra) e só escolhia QUAL ver no login / pelo botão de alternar. A escolha
-- era preferência de tela, não permissão — quem tinha a conta tinha os dois.
--
-- Agora a liberação mora na linha de `administradores`: dá para conceder só
-- Escalas, só GISE, ou os dois. O cookie `admin_modulo` continua sendo a
-- preferência de tela DENTRO do que a conta permite; quem tem um módulo só
-- não vê o botão de alternar.
--
-- DEFAULT 1: toda conta já existente (e a do Super Admin / bootstrap) preserva
-- o comportamento atual — os dois módulos liberados. Conta nova vinculada
-- também nasce com os dois; a ficha do policial é quem desliga o que sobra.
ALTER TABLE `administradores` ADD COLUMN `modulo_escalas` integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE `administradores` ADD COLUMN `modulo_gise` integer NOT NULL DEFAULT 1;
