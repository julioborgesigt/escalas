-- LGPD A5: Anonimiza IPs históricos nas tabelas de auditoria e assinatura.
-- IPv4: zera o último octeto (ex: 192.168.1.42 → 192.168.1.0)
-- IPv6: mantém apenas os primeiros 3 grupos (ex: 2001:db8:1::42 → 2001:db8:1::)
-- Execução: npx wrangler d1 execute escalas-db --remote --file=migrations/0017_anonimizar_ips_historico.sql
-- Para lotes grandes ou IPv6, prefira: npx tsx scripts/anonimizar-ips-historico.ts --remote --yes

-- login_attempts
UPDATE login_attempts
SET ip = substr(ip, 1,
    instr(ip, '.') +
    instr(substr(ip, instr(ip, '.') + 1), '.') +
    instr(substr(ip, instr(ip, '.') + instr(substr(ip, instr(ip, '.') + 1), '.') + 1), '.')
  ) || '0'
WHERE ip GLOB '*.*.*.*' AND ip NOT GLOB '*:*';

-- audit_log
UPDATE audit_log
SET ip = substr(ip, 1,
    instr(ip, '.') +
    instr(substr(ip, instr(ip, '.') + 1), '.') +
    instr(substr(ip, instr(ip, '.') + instr(substr(ip, instr(ip, '.') + 1), '.') + 1), '.')
  ) || '0'
WHERE ip GLOB '*.*.*.*' AND ip NOT GLOB '*:*';

-- escala_documentos
UPDATE escala_documentos
SET ip_address = substr(ip_address, 1,
    instr(ip_address, '.') +
    instr(substr(ip_address, instr(ip_address, '.') + 1), '.') +
    instr(substr(ip_address, instr(ip_address, '.') + instr(substr(ip_address, instr(ip_address, '.') + 1), '.') + 1), '.')
  ) || '0'
WHERE ip_address GLOB '*.*.*.*' AND ip_address NOT GLOB '*:*';

-- gise_documentos
UPDATE gise_documentos
SET ip_address = substr(ip_address, 1,
    instr(ip_address, '.') +
    instr(substr(ip_address, instr(ip_address, '.') + 1), '.') +
    instr(substr(ip_address, instr(ip_address, '.') + instr(substr(ip_address, instr(ip_address, '.') + 1), '.') + 1), '.')
  ) || '0'
WHERE ip_address GLOB '*.*.*.*' AND ip_address NOT GLOB '*:*';

-- gise_presencas
UPDATE gise_presencas
SET ip_address = substr(ip_address, 1,
    instr(ip_address, '.') +
    instr(substr(ip_address, instr(ip_address, '.') + 1), '.') +
    instr(substr(ip_address, instr(ip_address, '.') + instr(substr(ip_address, instr(ip_address, '.') + 1), '.') + 1), '.')
  ) || '0'
WHERE ip_address GLOB '*.*.*.*' AND ip_address NOT GLOB '*:*';

-- gise_assinaturas_relatorios
UPDATE gise_assinaturas_relatorios
SET ip_address = substr(ip_address, 1,
    instr(ip_address, '.') +
    instr(substr(ip_address, instr(ip_address, '.') + 1), '.') +
    instr(substr(ip_address, instr(ip_address, '.') + instr(substr(ip_address, instr(ip_address, '.') + 1), '.') + 1), '.')
  ) || '0'
WHERE ip_address GLOB '*.*.*.*' AND ip_address NOT GLOB '*:*';

-- aceites_termos
UPDATE aceites_termos
SET ip = substr(ip, 1,
    instr(ip, '.') +
    instr(substr(ip, instr(ip, '.') + 1), '.') +
    instr(substr(ip, instr(ip, '.') + instr(substr(ip, instr(ip, '.') + 1), '.') + 1), '.')
  ) || '0'
WHERE ip GLOB '*.*.*.*' AND ip NOT GLOB '*:*';
