-- Snapshot do CONTEUDO HTML do termo de uso no momento do aceite.
--
-- Antes a tabela aceites_termos guardava apenas (versao, hash) — o conteudo
-- real do texto era reconstruido lendo CONTEUDO_HTML de termo-vigente.ts.
-- Isso significa que em disputa judicial, reproduzir o texto aceito exigia
-- fazer git checkout da revisao do codigo que estava em producao na data do
-- aceite. Risco de "perder" a versao se o codigo for re-escrito sem
-- preservar o historico em git (ex.: squash/rewrite).
--
-- Esta migracao adiciona a coluna `conteudo_html_snapshot` para guardar o
-- HTML completo (~10 KB por aceite) junto com o registro. Garante:
--
--   1. Reproducao byte-a-byte do texto aceito, sem dependencia de git.
--   2. Hash do conteudo (versao + texto) recalculavel para conferir
--      integridade do snapshot vs hash_termo originalmente armazenado.
--   3. Auditoria forense imediata mesmo apos migracao do projeto.
--
-- Registros antigos ficam com NULL (compat preservada).

ALTER TABLE aceites_termos ADD COLUMN conteudo_html_snapshot TEXT;
