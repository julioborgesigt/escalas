-- Rubrica reutilizável do policial — cadastro para assinatura por Token A3 no
-- computador (desktop). Armazenada como PNG transparente em dataURL,
-- dimensionada para o campo de rubrica dos documentos/relatórios da GISE.
--
-- LGPD: o armazenamento reutilizável da rubrica é uma NOVA finalidade
-- (Art. 6º I) com consentimento próprio (Art. 8º), registrado em
-- `rubrica_consentimento_em`. O titular pode excluir a qualquer momento
-- (Art. 18) via DELETE /api/perfil/rubrica, que zera os três campos.
ALTER TABLE `policiais` ADD `rubrica` text;
ALTER TABLE `policiais` ADD `rubrica_atualizada_em` text;
ALTER TABLE `policiais` ADD `rubrica_consentimento_em` text;
