-- Signatário do plano operacional: quem assina passa a ser ESCOLHIDO por plano.
--
-- Até aqui `diretor_nome`/`diretor_cargo` eram copiados de `configuracoes` na
-- criação e não tinham campo em tela nenhuma — para trocar o signatário de UM
-- plano era preciso mudar o padrão global, o que reescreveria o padrão de todos
-- os planos seguintes. O signatário varia por operação (o Titular assina umas,
-- o Adjunto outras), então ele vira campo do plano.
--
-- `diretor_id` é o SERVIDOR escolhido na busca; `diretor_nome` continua sendo o
-- nome CONGELADO que o PDF imprime. Os dois, e não um só, pela mesma razão de
-- `cargo_snapshot` no efetivo: o id serve para a tela reabrir mostrando quem
-- está selecionado, e o nome congelado garante que renomear o cadastro não
-- altere um documento já emitido.
--
-- RESTRICT como em `coordenador_id`: excluir do cadastro alguém que assinou um
-- plano tem de falhar alto, não apagar o vínculo em silêncio. Nulo é estado
-- legítimo — plano cujo signatário veio do padrão global, sem escolha explícita.
ALTER TABLE `planos_operacionais` ADD COLUMN `diretor_id` integer REFERENCES `policiais`(`id`) ON UPDATE no action ON DELETE restrict;
--> statement-breakpoint
-- O cargo do signatário passa a ser LISTA FECHADA (ver `CARGOS_SIGNATARIO` em
-- `$lib/planos/padroes`), e o padrão global encurtou de "Departamento de Polícia
-- do Interior Sul" por extenso para "DPI SUL".
--
-- Sem reescrever o que já está gravado, o plano antigo fica com a tela e o
-- documento discordando: o `<select>` mostra a forma curta (é a única que ele
-- consegue exibir selecionada) e o PDF imprime a longa, porque imprime a coluna
-- crua. Divergência entre o que o admin confere e o que o papel diz é
-- exatamente o que este módulo existe para não ter.
--
-- Só a string EXATA do padrão antigo é reescrita — é o mesmo cargo, grafado como
-- a lista o grafa. Cargo digitado à mão fica como está e o editor o normaliza na
-- primeira gravação.
UPDATE `planos_operacionais`
   SET `diretor_cargo` = 'Diretor Titular do DPI SUL'
 WHERE `diretor_cargo` = 'Diretor Titular do Departamento de Polícia do Interior Sul';
--> statement-breakpoint
UPDATE `configuracoes`
   SET `valor` = 'Diretor Titular do DPI SUL'
 WHERE `chave` = 'plano.diretor_cargo'
   AND `valor` = 'Diretor Titular do Departamento de Polícia do Interior Sul';
