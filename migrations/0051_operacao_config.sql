-- Configuração de escala POR OPERAÇÃO: vagas padrão das equipes, horários e os
-- textos do breve relatório.
--
-- Estes três eram globais (chaves em `configuracoes`, editadas na tela
-- `/gise/config`), o que fazia sentido quando existia uma operação só. Com
-- CRAJUBAR e EDGE convivendo, deixam de fazer: uma força-tarefa monta equipe de
-- tamanho diferente e o texto que vai no PDF de extra fala do serviço dela.
--
-- **NULL significa "herda o padrão do sistema".** É o que mantém a migração
-- inócua: nenhuma operação existente muda de comportamento, porque todas nascem
-- sem sobrescrita e continuam caindo na mesma cadeia de antes
-- (`configuracoes` → constante do código). Zero, string vazia e NULL são coisas
-- diferentes aqui — 0 vaga de DPC é uma escolha legítima, e por isso a ausência
-- precisa ser NULL, não 0.
--
-- A precedência final da escala fica, do mais específico para o mais geral:
--   colunas de `gise_escalas` → colunas de `operacoes` → `configuracoes` → código

-- Vagas padrão de cada equipe criada nesta operação.
ALTER TABLE `operacoes` ADD COLUMN `vagas_operacional_dpc` integer;
--> statement-breakpoint
ALTER TABLE `operacoes` ADD COLUMN `vagas_operacional_oip` integer;
--> statement-breakpoint
ALTER TABLE `operacoes` ADD COLUMN `vagas_seint_dpc` integer;
--> statement-breakpoint
ALTER TABLE `operacoes` ADD COLUMN `vagas_seint_oip` integer;
--> statement-breakpoint

-- Horário padrão das escalas novas desta operação (HH:MM).
ALTER TABLE `operacoes` ADD COLUMN `hora_entrada_padrao` text;
--> statement-breakpoint
ALTER TABLE `operacoes` ADD COLUMN `hora_saida_padrao` text;
--> statement-breakpoint

-- Textos do bloco "Breve relatório" nos PDFs de extra desta operação.
ALTER TABLE `operacoes` ADD COLUMN `breve_relatorio_titulo` text;
--> statement-breakpoint
ALTER TABLE `operacoes` ADD COLUMN `breve_relatorio_texto_seccional` text;
--> statement-breakpoint
ALTER TABLE `operacoes` ADD COLUMN `breve_relatorio_texto_supervisao` text;
