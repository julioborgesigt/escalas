-- ============================================================================
-- O salt do rate-limit chegou ao consumidor? — diagnóstico pós-deploy
--
-- `RATE_LIMIT_IP_SALT` é a diferença entre a chave de rate-limit ser o hash
-- salteado do IP COMPLETO e ser o prefixo /24 do endereço. Com o /24, cinco
-- falhas de login bloqueiam a rede inteira — numa delegacia, onde todo mundo
-- sai pelo mesmo NAT, isso é DoS barato e lockout mútuo.
--
-- POR QUE ISTO EXISTE: até set/2026 `chaveRateLimitIp` lia a variável só de
-- `process.env`, que no Pages não é a fonte canônica (a variável do painel
-- chega por `platform.env`). Ou funcionava por acidente da
-- `compatibility_date`, ou o salt nunca chegava e a proteção estava desligada.
-- E não dava para perceber: `/api/health?detail=` confere a PRESENÇA da
-- variável em `platform.env`, então reportava `ok` para um valor que o
-- consumidor podia não estar vendo. Hoje as duas metades leem a mesma fonte
-- (`$env/dynamic/private`, com `process.env` de fallback).
--
-- O QUE ESTE ARQUIVO RESPONDE: qual formato de chave está gravado, e desde
-- quando. É o único registro que sobrou do que aconteceu ANTES da correção, e
-- serve de verificação depois de qualquer deploy que mexa na variável.
--
-- USO:
--   npx wrangler d1 execute escalas-db --remote --file=scripts/diagnostico-salt-rate-limit.sql
--   (staging: troque por escalas-db-staging)
--
-- A CONSULTA SOZINHA NÃO CONCLUI. Cruze com a presença da variável:
--   curl -s "https://<dominio>/api/health?detail=<HEALTH_DETAIL_TOKEN>" \
--     | jq '.checks.rateLimitIpSalt, .protecoesAusentes'
--
--   health    | banco  | conclusão
--   ----------|--------|--------------------------------------------------------
--   ausente   | /24    | a variável nunca foi configurada — configure e reconfira
--   ok        | /24    | O BUG MORDEU: estava configurada e não chegava ao código
--   ok        | iph:   | funcionava — a correção tirou a dependência do acaso
--   ausente   | iph:   | impossível pelo código atual — investigue se aparecer
--
-- JANELA: 90 dias. As duas tabelas são purgadas pela rotina de retenção
-- (`lgpd.retencao.login_attempts_dias` / `recovery_attempts_dias`), e nada mais
-- antigo existe para consultar.
--
-- VOLUME: `login_attempts` grava em sucesso E falha, então há linha a cada
-- login — o diagnóstico não depende de ter havido ataque.
--
-- LGPD: a saída traz chave pseudonimizada. As linhas `iph:` são hash salteado,
-- enquanto as `/24` são prefixo de IP, que identifica uma rede. Trate a saída
-- como dado pessoal: rode como operador e não a cole em canal aberto.
-- ============================================================================

-- ── A. Veredito: quantas linhas de cada formato, e o intervalo de cada um ────
--
-- Os formatos possíveis da coluna `ip`, que é a chave já pseudonimizada:
--   iph:<40 hex>            → COM salt (SHA-256 salteado do IP completo)
--   a.b.c.0                 → SEM salt, IPv4 anonimizado em /24
--   p1:p2:p3:p4::           → SEM salt, IPv6 anonimizado em /64
--   senha-atual:<tipo>:<id> → SEM salt, throttle por USUÁRIO (alterar senha,
--   pesado:<tipo>:<id>         reautenticação de assinatura, geração pesada) —
--                              essas chaves não são IP e passam intactas
--   qualquer outra coisa    → SEM salt, e a anonimização não reconheceu o valor
--
-- `MIN`/`MAX` são o que responde "desde quando": dois formatos convivendo com
-- intervalos que não se sobrepõem mostram exatamente onde foi a virada.
WITH t AS (
  SELECT 'login_attempts'    AS tabela, ip, attempted_at FROM login_attempts
  UNION ALL
  SELECT 'recovery_attempts' AS tabela, ip, attempted_at FROM recovery_attempts
)
SELECT tabela,
       CASE
         WHEN ip LIKE 'iph:%'                               THEN '1. COM salt (iph:)'
         WHEN ip LIKE 'senha-atual:%' OR ip LIKE 'pesado:%' THEN '2. SEM salt - chave por usuario'
         WHEN ip LIKE '%.0'                                 THEN '3. SEM salt - IPv4 /24'
         WHEN ip LIKE '%::'                                 THEN '4. SEM salt - IPv6 /64'
         ELSE                                                    '5. SEM salt - formato inesperado'
       END AS formato,
       COUNT(*)          AS linhas,
       MIN(attempted_at) AS primeira,
       MAX(attempted_at) AS ultima
FROM t
GROUP BY tabela, formato
ORDER BY tabela, formato;

-- ── B. Linha do tempo: um dia por linha, últimos 30 dias com movimento ───────
--
-- Serve para ver a transição acontecer (ou não acontecer) depois de um deploy
-- ou de uma troca de variável. Dia com `com_salt` e `sem_salt` ambos > 0 é o
-- dia da virada — ou sinal de que dois deployments convivem.
SELECT substr(attempted_at, 1, 10) AS dia,
       SUM(CASE WHEN ip LIKE 'iph:%' THEN 1 ELSE 0 END) AS com_salt,
       SUM(CASE WHEN ip LIKE 'iph:%' THEN 0 ELSE 1 END) AS sem_salt,
       COUNT(*)                                          AS total
FROM (
  SELECT ip, attempted_at FROM login_attempts
  UNION ALL
  SELECT ip, attempted_at FROM recovery_attempts
)
WHERE attempted_at >= datetime('now', '-90 days')
GROUP BY dia
ORDER BY dia DESC
LIMIT 30;
