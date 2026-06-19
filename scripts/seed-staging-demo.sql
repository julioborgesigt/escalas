-- Seed de DEMO para o D1 de STAGING (escalas-db-staging).
-- Cria 1 unidade + 14 policiais + 1 escala de plantao com todos vinculados,
-- para exercitar o export (rota CPU-pesada) na validacao da Fase 2.
-- IDs na faixa 99xxx para nao colidir com dados reais. Idempotente.
-- Rodar SOMENTE no staging:
--   npx wrangler d1 execute escalas-db-staging --remote --file scripts/seed-staging-demo.sql
-- Limpeza: DELETE FROM escalas WHERE id=99100; DELETE FROM policiais WHERE id BETWEEN 99100 AND 99113; DELETE FROM unidades WHERE id=99100;

INSERT OR REPLACE INTO unidades (id, nome, tipo) VALUES (99100, 'DELEGACIA DEMO STAGING', 'delegacia');

INSERT OR REPLACE INTO policiais
  (id, matricula, nome, cargo, lotacao, senha, primeiro_acesso, email, ativo)
VALUES
  (99100, 'DM099100', 'Policial Demo 01', 'DPC', 'DELEGACIA DEMO STAGING', 'seed-no-login', 0, NULL, 1),
  (99101, 'DM099101', 'Policial Demo 02', 'OIP', 'DELEGACIA DEMO STAGING', 'seed-no-login', 0, NULL, 1),
  (99102, 'DM099102', 'Policial Demo 03', 'OIP', 'DELEGACIA DEMO STAGING', 'seed-no-login', 0, NULL, 1),
  (99103, 'DM099103', 'Policial Demo 04', 'OIP', 'DELEGACIA DEMO STAGING', 'seed-no-login', 0, NULL, 1),
  (99104, 'DM099104', 'Policial Demo 05', 'OIP', 'DELEGACIA DEMO STAGING', 'seed-no-login', 0, NULL, 1),
  (99105, 'DM099105', 'Policial Demo 06', 'OIP', 'DELEGACIA DEMO STAGING', 'seed-no-login', 0, NULL, 1),
  (99106, 'DM099106', 'Policial Demo 07', 'OIP', 'DELEGACIA DEMO STAGING', 'seed-no-login', 0, NULL, 1),
  (99107, 'DM099107', 'Policial Demo 08', 'OIP', 'DELEGACIA DEMO STAGING', 'seed-no-login', 0, NULL, 1),
  (99108, 'DM099108', 'Policial Demo 09', 'OIP', 'DELEGACIA DEMO STAGING', 'seed-no-login', 0, NULL, 1),
  (99109, 'DM099109', 'Policial Demo 10', 'OIP', 'DELEGACIA DEMO STAGING', 'seed-no-login', 0, NULL, 1),
  (99110, 'DM099110', 'Policial Demo 11', 'OIP', 'DELEGACIA DEMO STAGING', 'seed-no-login', 0, NULL, 1),
  (99111, 'DM099111', 'Policial Demo 12', 'OIP', 'DELEGACIA DEMO STAGING', 'seed-no-login', 0, NULL, 1),
  (99112, 'DM099112', 'Policial Demo 13', 'OIP', 'DELEGACIA DEMO STAGING', 'seed-no-login', 0, NULL, 1),
  (99113, 'DM099113', 'Policial Demo 14', 'OIP', 'DELEGACIA DEMO STAGING', 'seed-no-login', 0, NULL, 1);

INSERT OR REPLACE INTO escalas (id, titulo, cidade, tipo, lotacao, data_inicio, data_fim)
VALUES (99100, 'Escala DEMO Staging - Plantao', 'Fortaleza', 'plantao', 'DELEGACIA DEMO STAGING', '2026-01-15', '2026-01-15');

DELETE FROM escala_policiais WHERE escala_id = 99100;
INSERT INTO escala_policiais
  (escala_id, policial_id, data_plantao, data_saida, horario, hora_entrada, hora_saida, observacoes, equipe)
VALUES
  (99100, 99100, '2026-01-15', '2026-01-16', '08H A 08H', '08', '08', '', ''),
  (99100, 99101, '2026-01-15', '2026-01-16', '08H A 08H', '08', '08', '', ''),
  (99100, 99102, '2026-01-15', '2026-01-16', '08H A 08H', '08', '08', '', ''),
  (99100, 99103, '2026-01-15', '2026-01-16', '08H A 08H', '08', '08', '', ''),
  (99100, 99104, '2026-01-15', '2026-01-16', '08H A 08H', '08', '08', '', ''),
  (99100, 99105, '2026-01-15', '2026-01-16', '08H A 08H', '08', '08', '', ''),
  (99100, 99106, '2026-01-15', '2026-01-16', '08H A 08H', '08', '08', '', ''),
  (99100, 99107, '2026-01-15', '2026-01-16', '08H A 08H', '08', '08', '', ''),
  (99100, 99108, '2026-01-15', '2026-01-16', '08H A 08H', '08', '08', '', ''),
  (99100, 99109, '2026-01-15', '2026-01-16', '08H A 08H', '08', '08', '', ''),
  (99100, 99110, '2026-01-15', '2026-01-16', '08H A 08H', '08', '08', '', ''),
  (99100, 99111, '2026-01-15', '2026-01-16', '08H A 08H', '08', '08', '', ''),
  (99100, 99112, '2026-01-15', '2026-01-16', '08H A 08H', '08', '08', '', ''),
  (99100, 99113, '2026-01-15', '2026-01-16', '08H A 08H', '08', '08', '', '');

