-- Sigla de unidade, quando existe, é ÚNICA — e o cargo do signatário passa a
-- sair por extenso.
--
-- Fase 1 do módulo de diárias (plano de set/2026, decisões 69 e 70).
--
-- Índice PARCIAL: só as siglas preenchidas entram. Delegacia e seccional ficam
-- com '' (a 0076 define que vazio é "não tem"), e um UNIQUE pleno recusaria a
-- segunda unidade sem sigla. Violação vira 409 legível em /unidades, como já
-- acontece com o nome.
CREATE UNIQUE INDEX IF NOT EXISTS `idx_unidades_sigla_unica`
	ON `unidades` (`sigla`) WHERE `sigla` <> '';--> statement-breakpoint
-- O cargo do signatário deixa de ser lista literal ("Diretor Titular do DPI
-- SUL", desde a 0069) e passa a ser gerado do departamento em `unidades`, com o
-- nome POR EXTENSO: sob a assinatura, o cargo é qualificação da autoridade que
-- decide, e abreviação empobrece o ato (decisão 69).
--
-- É o inverso exato da 0069, pelo mesmo motivo que ela deu: a tela só exibe
-- selecionado o que está na lista, e tela e PDF não podem discordar. Só a
-- string EXATA da lista antiga é reescrita; cargo digitado à mão fica como está
-- e o editor o normaliza na primeira gravação.
UPDATE `planos_operacionais`
   SET `diretor_cargo` = 'Diretor Titular do Departamento de Polícia do Interior Sul'
 WHERE `diretor_cargo` = 'Diretor Titular do DPI SUL';--> statement-breakpoint
UPDATE `planos_operacionais`
   SET `diretor_cargo` = 'Diretor Adjunto do Departamento de Polícia do Interior Sul'
 WHERE `diretor_cargo` = 'Diretor Adjunto do DPI SUL';
