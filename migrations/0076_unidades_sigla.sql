-- `unidades` ganha a sigla ("DPI SUL"), que até aqui só existia em código:
-- `DEPARTAMENTO_PADRAO` e os cargos de `CARGOS_SIGNATARIO` em
-- `src/lib/planos/padroes.ts` são literais, e por isso o sistema só sabe emitir
-- documento em nome de UM departamento.
--
-- Fase 0 do módulo de diárias (plano de set/2026, decisão 17: departamento é
-- dado, não constante). A sigla é o que o indexador do processo
-- (`DPIS-DIARIA-GERAL-2026-000487`) e a interface usam como forma curta; o
-- cargo do subscritor e o timbre saem do nome por extenso, que a coluna `nome`
-- já guarda (decisão 69).
--
-- `DEFAULT ''` e não NULL: sigla é atributo de departamento e subdepartamento;
-- seccional e delegacia ficam vazias, e vazio é "não tem", não "desconhecido".
-- Sem UNIQUE pelo mesmo motivo — todas as delegacias repetiriam ''.
--
-- Este passo NÃO liga a coluna a nada: `padroes.ts` continua com os literais
-- até a fase 1, porque o cargo sai impresso sob assinatura e a troca merece PR
-- próprio, com golden dos PDFs.
ALTER TABLE `unidades` ADD COLUMN `sigla` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- O departamento que já existe recebe a sigla que o código sempre usou, pelo
-- nome — que é único e é a chave real do modelo (ver `src/lib/db/unidades.ts`).
UPDATE `unidades`
   SET `sigla` = 'DPI SUL'
 WHERE `nome` = 'Departamento de Polícia do Interior Sul';
