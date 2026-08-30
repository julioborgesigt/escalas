-- PLANO OPERACIONAL: a operação COM deslocamento, e o custo dela.
--
-- O que existia até aqui era a escala extra — serviço sem deslocamento fora da
-- circunscrição, saindo de ponto de origem fixo, pago SEMPRE em hora extra. Por
-- isso o custo nunca precisou existir no banco: era uma constante do processo,
-- não um dado.
--
-- A operação especial quebra as duas premissas de uma vez. Uma ou mais equipes
-- se deslocam para cumprir mandados demandados por delegacia ou seccional, e o
-- pagamento passa a depender do DIA e do HORÁRIO: entre 08:00 e 18:00 em dia
-- útil não há custo; fora disso é hora extra; em fim de semana ou feriado é hora
-- extra em qualquer horário, acrescida de 30%. Além disso o pagamento pode ser
-- por DIÁRIA em vez de hora, e a escolha é POR EQUIPE.
--
-- ## Por que tabelas próprias, e não uma coluna `tipo` em `operacoes`
--
-- `operacoes` é o CATÁLOGO (GISE, CRAJUBAR, EDGE) do qual as escalas GISE
-- pendem por `gise_escalas.operacao_id`. Um plano operacional não é catálogo: é
-- um evento único, com equipes e efetivo próprios, que nunca recebe escala
-- nenhuma. Discriminar por coluna obrigaria TODA consulta de `/gise` e de
-- `/gise/operacoes` a passar a filtrar por um tipo que elas nunca precisaram
-- conhecer — e a primeira que esquecesse o filtro listaria plano operacional
-- como se fosse operação com formulário de produtividade.
--
-- ## Dinheiro
--
-- Todo valor monetário aqui é INTEIRO EM CENTAVOS. Não existe coluna `real` de
-- dinheiro nesta migração, e não deve passar a existir: soma de float acumula
-- erro e um total de custo que fecha por um centavo de diferença com a planilha
-- da corporação é um documento que volta. Pela mesma razão, meia diária é
-- contada em `diarias_meias` (1 a 30 = 0,5 a 15 diárias), e não em `2.5`.

-- ---- Os valores, versionados ----
--
-- APPEND-ONLY: esta tabela nunca recebe UPDATE. Cada gravação do Super Admin em
-- `/config-custos` insere uma LINHA NOVA, e o plano guarda em
-- `planos_operacionais.custo_parametro_id` qual delas usou.
--
-- É o que permite reemitir em junho o PDF de um plano de março e obter os MESMOS
-- números depois de um reajuste. Com uma linha só, sobrescrita, o documento
-- mudaria sozinho — e o PDF do plano operacional é peça que circula assinada
-- pelo Diretor: dois PDFs com o mesmo número e totais diferentes é exatamente o
-- que não pode acontecer.
--
-- Os quatro `_plus` são COLUNAS PRÓPRIAS, não derivadas de `normal * 1.3`. A
-- tela pré-preenche com o acréscimo de 30% e o Super Admin pode ajustar, mas o
-- valor efetivamente aplicado fica gravado: derivar na leitura faria uma
-- mudança futura na alíquota reescrever documento já entregue.
CREATE TABLE IF NOT EXISTS `custo_parametros` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	-- Hora extra NORMAL, por faixa de cargo/classe (centavos).
	-- OIP: classes D e C numa faixa, B e A na outra. DPC: 1ª e 2ª numa, 3ª e
	-- ESPECIAL na outra. O domínio das classes é o de `classesDoCargo()`.
	`oip_cd_normal` integer NOT NULL DEFAULT 0,
	`oip_ab_normal` integer NOT NULL DEFAULT 0,
	`dpc_12_normal` integer NOT NULL DEFAULT 0,
	`dpc_3e_normal` integer NOT NULL DEFAULT 0,
	-- Hora extra PLUS: 00:00–05:59 em dia útil, e qualquer horário em fim de
	-- semana ou feriado. Nominalmente `normal + 30%`, mas gravado.
	`oip_cd_plus` integer NOT NULL DEFAULT 0,
	`oip_ab_plus` integer NOT NULL DEFAULT 0,
	`dpc_12_plus` integer NOT NULL DEFAULT 0,
	`dpc_3e_plus` integer NOT NULL DEFAULT 0,
	-- Diária: valor único para todos os servidores, sem faixa de classe.
	`diaria_estadual` integer NOT NULL DEFAULT 0,
	`diaria_interestadual` integer NOT NULL DEFAULT 0,
	-- A vigente é a de maior (`vigente_desde`, `id`) — o `id` desempata duas
	-- gravações no mesmo dia, que é o caso de uma correção logo após um erro
	-- de digitação.
	`vigente_desde` text NOT NULL,
	`criado_por_id` integer,
	-- Copiado para a linha, como em `operacao_linha_base.informado_por_nome`:
	-- precisa continuar dizendo quem gravou depois que o cadastro mudar.
	`criado_por_nome` text NOT NULL DEFAULT '',
	`created_at` text NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_custo_parametros_vigencia` ON `custo_parametros` (`vigente_desde`, `id`);
--> statement-breakpoint

-- ---- O plano ----
--
-- `numero` é o "Nº do Plano" do documento, sequencial POR ANO — o modelo imprime
-- "PLANO OPERACIONAL 123/2026". O UNIQUE composto é a tranca real da corrida:
-- consultar o MAX antes de inserir não fecha nada (mesma lição de
-- `uq_escalas_mensal`, migração 0063), e sem ele dois planos criados no mesmo
-- instante sairiam com o mesmo número impresso.
CREATE TABLE IF NOT EXISTS `planos_operacionais` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`numero` integer NOT NULL,
	`ano` integer NOT NULL,
	`nome` text NOT NULL,
	`finalidade` text NOT NULL DEFAULT '',
	-- Item 2b do documento ("Ações a serem realizadas"), uma ação por linha.
	`acoes` text NOT NULL DEFAULT '',
	-- Nº do NUP. Opcional por decisão do solicitante: o plano é montado antes de
	-- o procedimento existir.
	`nup` text,
	`data_inicio` text NOT NULL,
	`hora_inicio` text NOT NULL DEFAULT '08:00',
	-- Previsão de término. Nullable, e é o que decide se a tela OFERECE a
	-- sugestão automática de horas: sem janela fechada não há o que classificar,
	-- e chutar um fim produziria uma sugestão que parece cálculo e é palpite.
	`data_fim` text,
	`hora_fim` text,
	-- Feriado no dia de início. Muda a classificação da hora extra inteira do
	-- dia (tudo vira "plus"), do mesmo modo que `gise_escalas.feriado`.
	`feriado` integer NOT NULL DEFAULT 0,
	`coordenador_id` integer,
	`demandante_unidade_id` integer,
	`departamento` text NOT NULL DEFAULT 'DPI SUL',
	`local_briefing_padrao` text NOT NULL DEFAULT '',
	`oip_por_equipe_padrao` integer NOT NULL DEFAULT 4,
	-- Bloco de assinatura do documento. Copiados de `configuracoes` na CRIAÇÃO e
	-- congelados aqui: o Diretor que assinou um plano de março continua sendo o
	-- signatário daquele plano depois que outro assumir a pasta.
	`diretor_nome` text NOT NULL DEFAULT '',
	`diretor_cargo` text NOT NULL DEFAULT '',
	-- Versão de `custo_parametros` aplicada. RESTRICT: apagar a versão deixaria
	-- o PDF sem como reproduzir os próprios totais.
	`custo_parametro_id` integer,
	`status` text NOT NULL DEFAULT 'rascunho',
	`created_at` text NOT NULL DEFAULT (datetime('now', '-3 hours')),
	`updated_at` text NOT NULL DEFAULT (datetime('now', '-3 hours')),
	-- RESTRICT nas duas, como `gise_seccionais.seccional_id`: unidade e policial
	-- referenciados por documento emitido não somem por baixo dele. A aplicação
	-- nem exclui unidade — desativa.
	FOREIGN KEY (`demandante_unidade_id`) REFERENCES `unidades`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`coordenador_id`) REFERENCES `policiais`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`custo_parametro_id`) REFERENCES `custo_parametros`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_planos_ano_numero` ON `planos_operacionais` (`ano`, `numero`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_planos_data_inicio` ON `planos_operacionais` (`data_inicio`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_planos_status` ON `planos_operacionais` (`status`);
--> statement-breakpoint

-- ---- As equipes ----
--
-- NULL nas três colunas de horário e em `local_briefing` significa HERDA DO
-- PLANO — não "vazio". É a mesma convenção das colunas de configuração de
-- `operacoes` (migração 0051), e pela mesma razão: a equipe que sai no horário
-- padrão não deve congelar uma cópia dele, senão mudar o horário do plano
-- deixaria de alcançá-la.
--
-- `horas_normais`/`horas_plus` convivem porque uma mesma equipe pode ter jornada
-- MISTA (sai às 05:00 de um dia útil: uma hora plus, o resto normal). Zero nos
-- dois com `tipo_custo = 'hora_extra'` é estado válido enquanto o admin ainda
-- não preencheu.
CREATE TABLE IF NOT EXISTS `plano_equipes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plano_id` integer NOT NULL,
	-- Posição na sequência ("Equipe 01", "Equipe 02"). O nome é editável e pode
	-- deixar de refletir a ordem; é a ordem que manda na apresentação.
	`ordem` integer NOT NULL DEFAULT 0,
	`nome` text NOT NULL,
	`tipo` text NOT NULL DEFAULT 'operacional',
	`viatura_modelo` text NOT NULL DEFAULT '',
	`viatura_placa` text NOT NULL DEFAULT '',
	`data_inicio` text,
	`hora_inicio` text,
	`hora_fim` text,
	`cidade_destino` text NOT NULL DEFAULT '',
	`local_briefing` text,
	`tipo_custo` text NOT NULL DEFAULT 'sem_custo',
	`horas_normais` integer NOT NULL DEFAULT 0,
	`horas_plus` integer NOT NULL DEFAULT 0,
	`diaria_tipo` text,
	-- Meias diárias: 1 a 30 (= 0,5 a 15). Inteiro para não haver float no
	-- caminho do dinheiro.
	`diarias_meias` integer NOT NULL DEFAULT 0,
	FOREIGN KEY (`plano_id`) REFERENCES `planos_operacionais`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_plano_equipes_plano` ON `plano_equipes` (`plano_id`, `ordem`);
--> statement-breakpoint

-- ---- Os membros ----
--
-- `cargo_snapshot` e `classe_snapshot` são a BASE DE CÁLCULO do custo, e por
-- isso ficam congelados na linha. Nome, matrícula, lotação e telefone continuam
-- vindo vivos de `policiais` pelo join — são identificação e contato, e o
-- documento deve sair com o dado atual. Promoção de classe muda quanto a pessoa
-- passa a ganhar DAQUI PARA A FRENTE; não muda o que foi orçado num plano já
-- emitido.
--
-- O CHEFE é flag nesta linha, e não `chefe_policial_id` em `plano_equipes`. A
-- diferença é que aqui o CASCADE resolve sozinho: tirar o membro da equipe leva
-- a chefia junto. Com o ponteiro na equipe, alguém teria de LEMBRAR de limpá-lo,
-- e o dia em que esquecesse o PDF imprimiria como chefe quem não está na equipe.
CREATE TABLE IF NOT EXISTS `plano_equipe_membros` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`equipe_id` integer NOT NULL,
	-- Denormalizado para o índice de exclusividade abaixo: o SQLite não indexa
	-- através de join. Não é segunda fonte de verdade — sai derivado da própria
	-- equipe no INSERT, e equipe não muda de plano (mesmo desenho de
	-- `gise_membros.gise_id`, migração 0044).
	`plano_id` integer NOT NULL,
	`policial_id` integer NOT NULL,
	`cargo_snapshot` text NOT NULL DEFAULT '',
	`classe_snapshot` text NOT NULL DEFAULT '',
	`chefe` integer NOT NULL DEFAULT 0,
	FOREIGN KEY (`equipe_id`) REFERENCES `plano_equipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plano_id`) REFERENCES `planos_operacionais`(`id`) ON UPDATE no action ON DELETE cascade,
	-- RESTRICT, não CASCADE: o membro é linha de um documento orçado. Excluir o
	-- cadastro do policial não pode esvaziar em silêncio o efetivo de um plano
	-- já emitido — some a pessoa da equipe e o total do Anexo II deixa de bater
	-- com o PDF entregue.
	FOREIGN KEY (`policial_id`) REFERENCES `policiais`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
-- Um servidor por PLANO (não por equipe): ninguém desloca em duas equipes da
-- mesma operação, e a dupla contagem inflaria o custo sem aparecer em lugar
-- nenhum.
CREATE UNIQUE INDEX IF NOT EXISTS `uq_plano_membros_plano_policial` ON `plano_equipe_membros` (`plano_id`, `policial_id`);
--> statement-breakpoint
-- Um chefe por equipe. Índice PARCIAL: só as linhas com `chefe = 1` colidem.
CREATE UNIQUE INDEX IF NOT EXISTS `uq_plano_membros_chefe` ON `plano_equipe_membros` (`equipe_id`) WHERE `chefe` = 1;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_plano_membros_equipe` ON `plano_equipe_membros` (`equipe_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_plano_membros_policial` ON `plano_equipe_membros` (`policial_id`);
