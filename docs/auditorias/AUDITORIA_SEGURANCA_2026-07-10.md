# 🔐 Auditoria de Segurança — Sistema de Escalas (PCCE)

| | |
|---|---|
| **Data** | 10 de julho de 2026 |
| **Escopo** | Segurança aplicacional voltada a produção (pré-go-live) |
| **Stack** | SvelteKit 5 (runes) + Cloudflare Pages / D1 / R2 |
| **Repositório** | `github.com/julioborgesigt/escalas` |
| **Branch auditada** | `claude/code-security-audit-q92jrp` (base `main` @ `b345908`) |
| **Método** | Revisão manual de código: autenticação, sessão, 2FA, autorização/IDOR, CSRF, XSS/CSP, injeção SQL, SSRF, webhooks, uploads, segredos e cabeçalhos. |

> Este documento é um **registro histórico** (ver `CLAUDE.md`). Reflete o estado
> na data acima. Achados anteriores (A1–A8, I-1…I-4, M-3/M-4) são citados quando
> a mitigação já existente cobre o tópico.

---

## 📊 Resumo executivo

**Veredito:** postura de segurança **forte e madura**. O código já incorpora, em
camadas, defesas para praticamente todos os vetores clássicos (OWASP Top 10). A
maioria das superfícies sensíveis foi endurecida em auditorias anteriores e os
comentários no código são rastreáveis a esses achados.

Não foram encontradas vulnerabilidades **críticas** ou **altas** exploráveis por
um atacante não autenticado. Os achados abaixo são **1 médio** (revogação de
certificado no login) e alguns **baixos / defesa-em-profundidade / operacionais**
para revisar antes e depois do go-live.

| Severidade | Qtd | Bloqueia produção? |
|---|---|---|
| 🔴 Crítica | 0 | — |
| 🟠 Alta | 0 | — |
| 🟡 Média | 1 | Não, mas recomenda-se tratar |
| 🔵 Baixa / Defesa-em-profundidade | 3 | Não |
| ⚪ Operacional / Verificar em produção | 1 (checklist) | **Sim — validar antes do go-live** |

`npm audit --omit=dev`: **0 vulnerabilidades** nas dependências de produção.

---

## ✅ O que já está bem feito (não regredir)

Estes controles foram verificados e estão sólidos — a lista serve para não
enfraquecê-los em mudanças futuras:

- **Senhas.** PBKDF2-HMAC-SHA256 com **pepper** global (`PASSWORD_PEPPER`, formato
  v3) — um dump do D1 sozinho não permite brute-force offline. Comparações
  timing-safe, migração progressiva de hashes legados no login, política de
  complexidade (mín. 8, maiúscula/minúscula/número) e blocklist de senhas comuns
  (`src/lib/schemas/auth.ts`). Teto de 100k iterações é limitação da API do
  workerd, compensada pelo pepper — decisão documentada e correta.
- **Sessão.** Token de 256 bits, **hasheado em repouso** (`sha256:`), cookie
  `httpOnly` + `sameSite=strict` + `secure`. Expiração deslizante (8 h) e
  **rotação total de sessões** na troca de senha. Respostas autenticadas recebem
  `Cache-Control: private, no-store` por padrão no hook de segurança.
- **2FA (e-mail).** Códigos **hasheados** antes de persistir, com `bindExtra`
  amarrando o desafio ao tipo de usuário e ao e-mail destino (fecha I-1/I-2,
  confused-deputy). `expectedTipos` obrigatório impede reutilizar um desafio de
  um canal em outro. Contadores por desafio + por IP.
- **CSRF.** Double-submit cookie com comparação timing-safe + verificação de
  `Origin` nas rotas `/api/auth/*` (fecha forced-login / session-fixation). Form
  actions do SvelteKit ficam cobertas pela verificação de origem nativa do
  framework (não desabilitada).
- **Injeção SQL.** Drizzle ORM parametrizado em todo o código. Os únicos
  `sql.raw` (`auth-flow.ts`) interpolam **apenas constantes numéricas** internas
  (`LOGIN_WINDOW_MINUTES`), sem entrada de usuário.
- **SSRF.** `urlOcspPermitida` (`ocsp.ts`) bloqueia loopback, RFC 1918, CGNAT,
  link-local e o endpoint de metadados de nuvem (169.254.169.254) em **todos os
  encodings** de IPv4 (decimal/octal/hex/inteiro) e IPv6 (incluindo IPv4
  embutido). Excelente cobertura.
- **Webhooks.** HMAC-SHA256 do body (estilo GitHub) **ou** Bearer, ambos
  timing-safe, com comprimento mínimo de segredo (128 bits) e **proteção
  anti-replay** (timestamp + nonce `UNIQUE`). Reset destrutivo exige três
  segredos independentes + confirmação datada (fail-closed).
- **Uploads (selfies).** Validação de **magic bytes** (não confia no prefixo
  `data:`), teto de 5 MB e chave R2 aleatória (UUID) — sem enumeração por URL.
- **XSS.** O único `{@html}` é o Termo de Uso, versionado em código e
  **sanitizado no servidor** (`termo/sanitize.ts`, allowlist + cap anti-ReDoS).
- **CSP.** `script-src 'self'` **sem** `unsafe-inline` (nonces automáticos do
  SvelteKit), `object-src 'none'`, `frame-src 'none'`, HSTS com preload, além de
  COOP/COEP/CORP e `X-Frame-Options: DENY`.
- **Segredos.** `.gitignore` cobre `.env*`, `.dev.vars`, `*.key.pem`, dumps
  (`*.backup`, `dump.sql`). `wrangler.toml` só contém variáveis não-secretas e
  IDs de binding (não são segredos). Nenhum segredo real detectado no versionado.
- **LGPD.** CPF cifrado em repouso (AES-GCM) com índice cego para busca; IP
  pseudonimizado com `RATE_LIMIT_IP_SALT`; mascaramento de e-mail nas respostas.

---

## 🟡 Achado M-1 (Médio) — Login por certificado não verifica revogação (OCSP/CRL)

**Arquivos:** `src/routes/api/auth/certificado/verificar/+server.ts`,
`src/lib/server/cert-login.ts`

**Descrição.** O login por Token A3 (ICP-Brasil) valida corretamente:
1. a assinatura CMS sobre o nonce do desafio (posse da chave privada);
2. as datas de validade do certificado;
3. a **cadeia** até uma raiz/intermediária confiável ICP-Brasil (fail-closed).

Porém **não consulta a revogação** do certificado no momento do login. Um e-CPF
que tenha sido **revogado** (token perdido/roubado e reportado à AC, ou
desligamento do titular) mas ainda dentro do período de validade continuaria
autenticando com sucesso.

Note o contraste: o fluxo de **assinatura** já faz OCSP (CAdES-LT via
`cades-finalizer` + `ocsp.ts`), mas o fluxo de **autenticação** não reaproveita
essa checagem. `grep -i "ocsp\|revog\|crl"` em `cert-login.ts` não retorna nada.

**Cenário de falha.** Servidor tem o token A3 revogado após incidente; enquanto o
certificado não expira (e-CPF costuma ter 1–3 anos de validade), ele ainda loga
no sistema por posse do token — mesmo já não devendo ter acesso.

**Impacto.** Médio. Exige posse do token físico + PIN e um certificado válido em
cadeia; não é explorável remotamente por terceiro sem o token. Mas contorna o
mecanismo institucional de revogação de credencial.

**Recomendação.** Consultar OCSP no login por certificado, reaproveitando
`ocsp.ts` (a infra já existe). Como OCSP é uma chamada de rede externa, tratar de
forma **fail-closed com cache curto** (ou soft-fail auditado, conforme apetite de
risco). Alternativa mínima: documentar explicitamente o risco residual no
`DEPLOY.md` e reforçar a desativação da conta (`ativo=0`) como controle
compensatório — hoje um policial `ativo=0` já é barrado (`eq(policiais.ativo, 1)`
no lookup), então o processo operacional de desligamento cobre parte do vetor,
mas **não** o caso de token comprometido de servidor que continua ativo.

---

## 🔵 Achado L-1 (Baixo) — Troca de e-mail pessoal do admin não re-exige senha

**Arquivo:** `src/routes/api/auth/solicitar-verificacao-email-pessoal/+server.ts`

**Descrição.** Ao trocar o e-mail pessoal (canal de recuperação de senha), o
código re-exige a senha atual — mas **apenas para policiais**:

```ts
if (u.tipo === 'policial') {
  // ... exige senha quando já existe email_pessoal
}
```

Para uma sessão de **admin standalone** (bootstrap por env, `tipo === 'admin'`
sem `adminPolicialId`), a troca do e-mail pessoal ocorre **sem reinserção de
senha**. Uma sessão de admin sequestrada poderia redirecionar o canal de
recuperação para um e-mail do atacante e, depois, disparar o reset por lá.

**Impacto.** Baixo — requer uma sessão de admin já autenticada (o atacante
nesse ponto já teria poder de admin); o vetor é sobre **persistência/tomada de
conta**, não escalonamento inicial. Admins vinculados a policial usam a
credencial do policial e caem no ramo correto.

**Recomendação.** Aplicar a mesma re-checagem de senha para admins standalone
antes de permitir a troca de `email_pessoal` já existente.

---

## 🔵 Achado L-2 (Baixo / Defesa-em-profundidade) — `style-src 'unsafe-inline'`

**Arquivo:** `svelte.config.js` (documentado como trade-off I-4)

A CSP de **scripts** é estrita, mas `style-src` mantém `'unsafe-inline'` porque
Skeleton UI + Tailwind emitem `style="..."` em runtime. Isso mantém teoricamente
possível um ataque de **exfiltração por seletor CSS** (`input[value^="a"]{...}`)
— porém **somente** se o atacante conseguir injetar HTML, e o único ponto de
`{@html}` (o termo) já é sanitizado no servidor. Risco residual conhecido e
aceito; registrado aqui para rastreabilidade. Fechar exigiria migração de engine
CSS-in-JS com nonces consistentes (fora de escopo).

---

## 🔵 Achado L-3 (Baixo / Operacional) — Rate-limits de recuperação são fail-open

**Arquivos:** `verificar-2fa`, `reenviar-codigo`, `recovery-rate-limit.ts` (e
correlatos)

Vários rate-limits capturam falhas do D1 e **seguem sem bloquear** (`fail-open`),
com log de erro. É uma escolha deliberada (não derrubar login por indisponi­bili­dade
do banco), mas em produção, se o D1 degradar, o fail-open desliga silenciosamente
a proteção de brute-force.

**Recomendação.** Garantir **alerta no Sentry** para a mensagem
`Falha no rate-limit (fail-open)` e monitorar sua frequência. Se disparar com
regularidade, é sinal de que o limite está efetivamente desligado.

---

## ⚪ Checklist operacional — validar ANTES do go-live

Itens que dependem de configuração do ambiente (não do código) e devem ser
confirmados no deploy de produção:

- [ ] **`PASSWORD_PEPPER`** configurado como secret (`wrangler secret put`). Sem
      ele, senhas caem no formato v2 (sem a proteção offline do pepper).
- [ ] **`RATE_LIMIT_IP_SALT`** configurado — sem ele o rate-limit anonimiza por
      /24, o que pode travar uma corporação inteira atrás de NAT (DoS/lockout).
- [ ] **`APP_ORIGIN`** fixado — fecha, em camadas, host-header injection nos
      links de redefinição/primeiro acesso.
- [ ] **`SYNC_TOKEN`** e **`RESET_TOKEN`** com ≥ 32 chars e **distintos** entre si.
- [ ] **`WEBHOOK_REPLAY_ENFORCE=1`** ligado após o sender (Google Apps Script)
      estar enviando `X-Webhook-Timestamp`/`X-Webhook-Nonce`.
- [ ] **`SUPER_ADMIN_EMAIL`** (e/ou `ADMIN_GERAL_EMAIL`) configurado para **exigir
      2FA** também nas contas de bootstrap. Sem e-mail, o login root é fator único
      (break-glass auditado, mas indesejável em regime normal). Após o onboarding,
      **remover `ADMIN_GERAL_LOGIN/SENHA`** do ambiente.
- [ ] **Bucket R2 `escalas_docs` NÃO público** — confirmar no Console da
      Cloudflare que o acesso é só via binding (o próprio código nota isso em
      `selfie-upload.ts`). Documentos assinados contêm manifesto forense (CPF/IP/GPS).
- [ ] **Branch protection** no GitHub exigindo o job `test` do CI antes de merge
      para `main` (o workflow já roda em PR, falta garantir o gate no repositório).
- [ ] **`HEALTH_DETAIL_TOKEN`** (≥ 16 chars) definido se quiser expor o detalhe
      estruturado de `/api/health`; caso contrário a sonda fica binária (correto).

---

## Metodologia e cobertura

Revisão manual, arquivo a arquivo, das superfícies:

- **Autenticação/sessão/2FA:** `auth.ts`, `auth-flow.ts`, `password-hash.ts`,
  `session-cache.ts`, `hooks.server.ts`, todas as rotas `api/auth/*`,
  `alterar-senha`, `redefinir-senha`.
- **Autorização/IDOR:** `escala-permissao.ts`, `api/escalas/[id]/download`,
  `api/validar/[hash]/download`, rotas `api/admin/*`, checagem de guarda por rota.
- **CSRF/XSS/CSP/cabeçalhos:** `csrf.ts`, `csp.ts`, `svelte.config.js`,
  `_headers`, `termo/sanitize.ts`, uso de `{@html}`.
- **Injeção/SSRF/webhook/upload:** `sql.raw` (grep global), `ocsp.ts`, `tsa.ts`,
  `webhook-auth.ts`, `selfie-upload.ts`, rotas `api/webhook/*`.
- **Segredos/deps/CI:** `.gitignore`, `wrangler.toml`, `.env.example`,
  `npm audit`, workflows `.github/workflows/*`.

**Fora de escopo** (não avaliado em profundidade): correção jurídica das
assinaturas (ver `ANALISE_JURIDICA_ASSINATURAS.md`), robustez criptográfica
detalhada do PAdES/CAdES, e segurança de infraestrutura da conta Cloudflare
(IAM, WAF, rate-limiting de borda) — recomenda-se habilitar o rate-limiting e o
WAF gerenciado da Cloudflare como camada adicional de borda.
