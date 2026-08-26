-- Remoção da rubrica (decisão de negócio, ago/2026).
--
-- A rubrica existia em DOIS papéis, e os dois saem:
--
--  1. CADASTRO reutilizável no perfil do policial (`policiais.rubrica*`,
--     migração 0010): PNG transparente carimbado no campo de assinatura dos
--     documentos assinados por Token A3. Com ele saem o consentimento LGPD
--     próprio dessa finalidade e a data de atualização — não há mais
--     tratamento a consentir.
--  2. Rubrica DESENHADA na cerimônia de assinatura em tela, persistida como
--     evidência do ato em `gise_documentos`, `gise_assinaturas_relatorios`,
--     `gise_presencas` (entrada/saída) e, para o fluxo por passkey, carregada
--     entre o `preparar` e o `finalizar` em `assinatura_intencoes` (0062).
--
-- O que isto NÃO apaga: os PDFs já assinados no R2 continuam com a rubrica
-- estampada dentro deles, e o hash de verificação continua fechando. O que
-- deixa de existir é a CÓPIA da imagem no banco — a partir daqui `/validar`
-- mostra o documento e as demais evidências (selfie, GPS, IP, carimbo de
-- tempo), sem a rubrica ao lado.
--
-- DROP COLUMN é seguro nestas sete: nenhuma participa de índice, view ou
-- constraint (o SQLite recusaria a instrução se participasse).
ALTER TABLE `policiais` DROP COLUMN `rubrica`;--> statement-breakpoint
ALTER TABLE `policiais` DROP COLUMN `rubrica_atualizada_em`;--> statement-breakpoint
ALTER TABLE `policiais` DROP COLUMN `rubrica_consentimento_em`;--> statement-breakpoint
ALTER TABLE `gise_documentos` DROP COLUMN `rubrica`;--> statement-breakpoint
ALTER TABLE `gise_assinaturas_relatorios` DROP COLUMN `rubrica`;--> statement-breakpoint
ALTER TABLE `gise_presencas` DROP COLUMN `entrada_rubrica`;--> statement-breakpoint
ALTER TABLE `gise_presencas` DROP COLUMN `saida_rubrica`;--> statement-breakpoint
ALTER TABLE `assinatura_intencoes` DROP COLUMN `rubrica`;
