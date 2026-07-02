> 📌 **Registro histórico (mai/2026).** Plano derivado do [`LGPD_AUDIT.md`](LGPD_AUDIT.md). A maior parte dos itens já foi implementada — ver a reavaliação na [auditoria geral de 28/jun/2026](AUDITORIA_GERAL_2026-06-28.md) e as migrações `0017`–`0027` (anonimização de IPs, retenção, incidentes, solicitações de titulares, consentimento granular).

# Plano de Implementação LGPD — Sistema de Escalas PCCE

**Baseado em:** `LGPD_AUDIT.md`  
**Data:** 15 de maio de 2026  
**Itens:** 4 críticos · 11 altos · 7 médios  
**Duração estimada:** 3 sprints (~5–6 semanas)

---

## Caminho Crítico

```
C1 (dump.sql) ─── independente, fazer ANTES de qualquer push
C2 (CPF público) ─── independente
C3 (senha hardcoded) ─── independente
C4 (bypass 2FA) ─── independente

A5 (anonimizar IP) ──► A6 (retenção)
                   └──► M18 (user-agent) — refatorar junto

A7 (reset em URL) ──► A8 (primeiro acesso por link)

A9 (email pessoal) ┐
M17 (consentimento)├──► A11 (DPO + novo bump de versão do termo) ──► A16 (direitos)
A10 (incidentes)   ┘
```

---

## Fase 0 — Emergencial (fazer antes do próximo push)

### C1 — `dump.sql` com dados reais versionado no repositório
**Complexidade:** S | **Artigo LGPD:** 46, 48

**O que fazer:**

1. Adicionar ao `.gitignore`:
   ```
   dump.sql
   *.backup
   backup/
   ```

2. Remover do histórico Git:
   ```bash
   git filter-repo --path dump.sql --invert-paths
   git push origin --force --all
   ```

3. Criar script de sanitização para uso em dev:
   ```bash
   # scripts/sanitize-dump.sh
   # Substitui CPF, telefone e email pessoal por placeholders
   sed -i "s/'[0-9]\{11\}'/'***.***.***-**'/g" dump.sql
   sed -i "s/'(8[0-9]) [0-9 -]\{9,14\}'/'(XX) XXXXX-XXXX'/g" dump.sql
   ```

---

## Sprint 1 — Críticos de Segurança (~2 dias)

### C2 — CPF completo + lat/lng + IP expostos em `/validar/[hash]` público
**Complexidade:** S | **Arquivo:** `src/routes/validar/[hash]/+page.server.ts:172`

No objeto retornado pelo `load`, filtrar os campos de auditoria antes de serializar para o cliente:

```typescript
// ANTES — enviando ao browser sem filtro:
assinante_cpf: documento.assinante_cpf,   // CPF completo
ip_address:    documento.ip_address,       // IP completo
user_agent:    documento.user_agent,       // UA completo
latitude:      documento.latitude,         // precisão ~11 cm
longitude:     documento.longitude,

// DEPOIS — mascarar no servidor antes de enviar:
assinante_cpf: documento.assinante_cpf
  ? documento.assinante_cpf.replace(/^(\d{3})\d{5}(\d{2})$/, '$1.***.***-$2')
  : null,
// ip_address: OMITIR
// user_agent: OMITIR
latitude:  documento.latitude  ? Math.round(documento.latitude  * 100) / 100 : null,
longitude: documento.longitude ? Math.round(documento.longitude * 100) / 100 : null,
```

No `+page.svelte`, remover qualquer chamada a `mascararCPF()` sobre esse campo
(o mascaramento agora acontece no servidor).

---

### C3 — Senha padrão `J1a2b3cd4j` hardcoded em script
**Complexidade:** S | **Arquivo:** `scripts/set-default-password-all-users.ts:14`

```typescript
// REMOVER:
const DEFAULT_PASSWORD = 'J1a2b3cd4j';
console.log(`Senha padrão aplicada: ${DEFAULT_PASSWORD}`);

// SUBSTITUIR POR:
const DEFAULT_PASSWORD = process.argv.find(a => a.startsWith('--password='))?.slice(11);
if (!DEFAULT_PASSWORD) {
  console.error('Forneça --password=SENHA como argumento. Nunca use senha fixa em código.');
  process.exit(1);
}
// Nunca imprimir a senha — apenas confirmar a quantidade de usuários afetados
```

**Ação operacional:** verificar nos logs de CI/CD se o script foi executado recentemente
e rotacionar senhas dos usuários afetados.

---

### C4 — Credenciais de bootstrap contornam 2FA
**Complexidade:** M | **Arquivo:** `src/lib/server/auth-flow.ts:162`

Desativar o bypass automaticamente quando o admin já tiver email configurado
(ou seja, o setup inicial foi concluído):

```typescript
// Após localizar envAdmin no banco:
if (envAdmin && envAdmin.email && envAdmin.primeiro_acesso === 0) {
  // Admin já configurado — recusar bootstrap, forçar fluxo normal
  logger.error('[security] Bootstrap negado: admin já configurado. Remova ADMIN_GERAL_LOGIN/SENHA.', { ip });
  await recordAttempt(db, ip, false);
  return { sucesso: false, statusCode: 401, erro: 'Login ou senha inválidos', fields: { matricula, tipo } };
}
```

**Ação operacional imediata:** remover `ADMIN_GERAL_LOGIN` e `ADMIN_GERAL_SENHA`
do ambiente de produção e auditar logs das últimas 2 semanas.

---

## Sprint 2 — Vulnerabilidades Altas (~4 dias)

### A5 — IP não anonimizado em 6 tabelas
**Complexidade:** M | **Artigo:** 6º (finalidade e necessidade)

A função `anonimizarIp()` existe em `src/lib/db/audit.ts` mas é chamada
**apenas** para `audit_log`. Deve ser exportada e aplicada em:

| Arquivo | Função | Campo |
|---------|--------|-------|
| `src/lib/db/documentos.ts` | `salvarDocumentoEscala` | `ip_address` |
| `src/lib/db/gise/documentos.ts` | `salvarGiseDocumento` | `ip_address` |
| `src/lib/db/gise/presencas.ts` | `salvarEntradaGise`, `salvarSaidaGise` | `ip_address` |
| `src/lib/db/gise/assinaturas.ts` | `salvarAssinaturaRelatorioGise` | `ip_address` |
| `src/lib/db/termos.ts` | `registrarAceite` | `ip` |
| `src/lib/server/auth-flow.ts` | `recordAttempt` | `ip` (em `loginAttempts`) |

Padrão de aplicação em cada arquivo:
```typescript
import { anonimizarIp } from '$lib/db/audit';
// ...
ip_address: anonimizarIp(ipAddress) ?? undefined,
```

**Migração histórica** — criar `migrations/0017_anonimizar_ips_historico.sql`
via script TypeScript (usar `anonimizarIp()` em lote, pois SQLite no D1
não tem `reverse()` nativa):

```typescript
// scripts/anonimizar-ips-historico.ts
const tabelas = ['login_attempts','escala_documentos','gise_documentos',
                  'gise_presencas','gise_assinaturas_relatorios','aceites_termos'];
// Para cada tabela: SELECT id, ip FROM ... WHERE ip NOT LIKE '%.0'
// UPDATE ... SET ip = anonimizarIp(ip) WHERE id = ...
```

---

### A6 — Sem política de retenção implementada
**Complexidade:** L | **Artigo:** 16 (eliminação), 5º I (necessidade)

**a) Novas chaves em `src/lib/db/configuracoes.ts`:**
```typescript
export const LGPD_RETENCAO_SESSOES_DIAS         = 'lgpd.retencao.sessoes_dias';         // 30
export const LGPD_RETENCAO_LOGIN_ATTEMPTS_DIAS  = 'lgpd.retencao.login_attempts_dias';  // 90
export const LGPD_RETENCAO_2FA_DIAS             = 'lgpd.retencao.dois_fatores_dias';    // 1
export const LGPD_RETENCAO_RESET_TOKENS_DIAS    = 'lgpd.retencao.reset_tokens_dias';    // 7
export const LGPD_RETENCAO_AUDIT_LOG_ANOS       = 'lgpd.retencao.audit_log_anos';       // 5
```

**b) Novo arquivo `src/lib/db/lgpd-retencao.ts`:**
```typescript
export async function executarLimpezaRetencao(db: Database, config: RetencaoConfig) {
  const cutoff = (dias: number) =>
    new Date(Date.now() - dias * 86_400_000).toISOString();

  return Promise.all([
    db.delete(sessoes).where(lt(sessoes.expires_at, cutoff(config.sessoesDias))),
    db.delete(loginAttempts).where(lt(loginAttempts.attempted_at, cutoff(config.loginAttemptsDias))),
    db.delete(doisFatoresTokens).where(lt(doisFatoresTokens.expires_at, cutoff(config.doisFatoresDias))),
    db.delete(resetSenhaTokens).where(lt(resetSenhaTokens.expires_at, cutoff(config.resetTokensDias))),
    // audit_log e tabelas de assinatura: retenção mínima 5 anos — NÃO deletar automaticamente
  ]);
}
```

**c) Endpoint `src/routes/api/admin/lgpd/limpeza/+server.ts`:**
POST autenticado (apenas admin geral) que chama `executarLimpezaRetencao`
e registra resultado em `audit_log`.

**d) Migração `migrations/0018_lgpd_retencao_config.sql`:**
```sql
INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES
  ('lgpd.retencao.sessoes_dias',        '30'),
  ('lgpd.retencao.login_attempts_dias', '90'),
  ('lgpd.retencao.dois_fatores_dias',   '1'),
  ('lgpd.retencao.reset_tokens_dias',   '7'),
  ('lgpd.retencao.audit_log_anos',      '5');
```

**Dependência:** A5 concluído (IPs anonimizados antes de apagar registros).

---

### A7 — Token de reset exposto em URL
**Complexidade:** S | **Arquivo:** `src/routes/api/auth/confirmar-redefinicao/+server.ts:124`

O token já é criptograficamente forte. O risco está em aparecer em logs de proxy/CDN.
Corrigir adicionando headers de privacidade na resposta do email e na rota de reset:

```typescript
// Em confirmar-redefinicao/+server.ts, na response:
return json({ ok: true }, {
  headers: { 'Cache-Control': 'no-store' }
});

// Em redefinir-senha/+page.server.ts, no load:
return { ... , headers: { 'Cache-Control': 'no-store, no-cache' } };
```

Para maior segurança futura, trocar pelo padrão de "resetId opaco → validado via POST":
o link contém apenas uma referência, e o token real fica somente no servidor.

---

### A8 — Senha provisória enviada em texto claro por email
**Complexidade:** M | **Arquivo:** `src/routes/api/auth/primeiro-acesso/+server.ts:65`

Substituir senha provisória por link de configuração de senha (token de 1 uso):

```typescript
// REMOVER:
const senhaProvisoria = gerarSenhaProvisoria();
await enviarSenhaProvisoria(policial.email, senhaProvisoria, policial.nome, platform);

// SUBSTITUIR POR:
const token = await criarTokenRedefinicao(db, 'policial', policial.id);
const link  = `${url.origin}/redefinir-senha?token=${token}&primeiro_acesso=1`;
await enviarLinkPrimeiroAcesso(policial.email, link, policial.nome, platform);
// Adicionar enviarLinkPrimeiroAcesso em src/lib/server/email.ts (adaptar enviarLinkRedefinicaoSenha)
```

Na rota `redefinir-senha/+page.server.ts`, detectar `?primeiro_acesso=1`
e omitir o campo "senha atual" da UI.

**Dependência:** A7 concluído.

---

### A9 + A11 — Email pessoal sem documentação + DPO sem contato no Termo
**Complexidade:** S | **Arquivo:** `src/lib/server/termo/termo-vigente.ts`

Agrupar as duas alterações num único bump de versão do Termo:

1. **Bump:** `VERSAO = '1.1'` e atualizar `VIGENTE_DESDE`

2. **Cláusula 3.1** — adicionar:
   > `E-mail pessoal (quando voluntariamente fornecido pelo usuário), utilizado exclusivamente para recuperação de conta e notificações operacionais.`

3. **Cláusula 3.3** — substituir menção genérica por:
   > `O Encarregado de Dados (DPO) pode ser contatado pelo e-mail dpo@pcce.ce.gov.br
   > ou pelo endereço: [endereço físico da PCCE].`

4. **Nova página** `src/routes/termo/dpo/+page.svelte` + `+page.server.ts`:
   Página pública com dados do DPO e formulário de exercício de direitos (art. 18).
   Usar padrões Svelte 5 (`$state()`, `$props()`, Server Actions em `+page.server.ts`).

---

### A10 — Sem notificação de incidentes (art. 48)
**Complexidade:** L | **Artigo:** 48

**Migração `migrations/0019_lgpd_incidentes.sql`:**
```sql
CREATE TABLE lgpd_incidentes (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo                  TEXT    NOT NULL,
  descricao               TEXT    NOT NULL,
  dados_afetados          TEXT    NOT NULL, -- JSON: categorias de dados
  titulares_estimados     INTEGER,
  detectado_em            TEXT    NOT NULL DEFAULT (datetime('now', '-3 hours')),
  notificado_anpd_em      TEXT,
  notificado_titulares_em TEXT,
  status                  TEXT    NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto','em_investigacao','notificado','encerrado')),
  responsavel_nome        TEXT,
  medidas_mitigacao       TEXT,
  created_by              INTEGER,
  created_at              TEXT    NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
```

Adicionar type em `src/lib/server/schema.ts`.

**Endpoints:**
- `src/routes/api/admin/lgpd/incidentes/+server.ts` — GET (listar) + POST (registrar)
- `src/routes/api/admin/lgpd/incidentes/[id]/+server.ts` — PATCH (atualizar status/datas)

---

### A12 — Webhooks sem assinatura HMAC
**Complexidade:** S | **Arquivos:** `src/routes/api/webhook/sync-policiais/+server.ts`,
`sync-unidades/+server.ts`

Adicionar verificação de `X-Hub-Signature-256` (padrão GitHub-like):

```typescript
const signature  = request.headers.get('X-Hub-Signature-256');
const HMAC_SECRET = (platform?.env as Env).WEBHOOK_HMAC_SECRET;

if (HMAC_SECRET && signature) {
  const body = await request.text(); // ler body bruto antes do JSON.parse
  const key  = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(HMAC_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac      = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expected = 'sha256=' + Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return json({ error: 'Assinatura inválida' }, { status: 401 });
  }
  // Agora parsear body como JSON
}
```

Adicionar `WEBHOOK_HMAC_SECRET` ao tipo `Env` em `src/app.d.ts`.

---

### A14 — Sessões de 12 horas (reduzir para 1 hora)
**Complexidade:** S | **Artigo:** 46

```typescript
// src/lib/auth.ts — função criarSessao:
- const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
+ const expiresAt = new Date(Date.now() +  1 * 60 * 60 * 1000).toISOString();

// src/lib/server/auth-flow.ts — função cookieOptions:
- maxAge: 12 * 60 * 60
+ maxAge:  1 * 60 * 60
```

**Impacto UX:** usuários serão deslogados após 1h de inatividade.
Considerar refresh silencioso no `+layout.server.ts` enquanto a aba estiver aberta.

---

### A15 — Exports sem auditoria de acesso
**Complexidade:** S | **Artigo:** 32

Adicionar ao tipo `AcaoAudit` em `src/lib/db/audit.ts`:
```typescript
| 'exportar_escala' | 'exportar_gise'
```

Chamar `registrarAuditComContexto` após geração bem-sucedida em:
- `src/routes/api/escalas/[id]/download/+server.ts`
- `src/routes/api/gise/[id]/download/+server.ts`
- `src/routes/api/gise/historico/export/+server.ts`

---

### A16 — Direitos dos titulares (art. 18) não implementados
**Complexidade:** L | **Artigos:** 17–22

**Migração `migrations/0020_lgpd_solicitacoes.sql`:**
```sql
CREATE TABLE lgpd_solicitacoes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo           TEXT NOT NULL
    CHECK (tipo IN ('acesso','portabilidade','correcao','anonimizacao','oposicao')),
  usuario_tipo   TEXT NOT NULL,
  usuario_id     INTEGER NOT NULL,
  descricao      TEXT,
  status         TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','em_analise','concluida','negada')),
  resposta       TEXT,
  prazo_resposta TEXT, -- 15 dias corridos (art. 18 §3º)
  created_at     TEXT NOT NULL DEFAULT (datetime('now', '-3 hours')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now', '-3 hours'))
);
```

**Endpoints a criar:**

| Rota | Método | Descrição |
|------|--------|-----------|
| `src/routes/api/policiais/[id]/lgpd/+server.ts` | GET | Exporta dados do titular (portabilidade) |
| `src/routes/api/policiais/[id]/lgpd/+server.ts` | DELETE | Anonimiza dados não obrigatórios |
| `src/routes/api/admin/lgpd/solicitacoes/+server.ts` | GET | Lista solicitações pendentes |
| `src/routes/api/admin/lgpd/solicitacoes/[id]/+server.ts` | PATCH | Responde e encerra solicitação |

**Dependência:** A11 (DPO disponível antes da página de exercício de direitos).

---

## Sprint 3 — Médios (~3 dias)

### M17 — Consentimento não granular
**Complexidade:** M | **Artigo:** 8º

Separar o único `aceitou_lgpd` em consentimentos por finalidade:

**Migração:**
```sql
ALTER TABLE aceites_termos ADD COLUMN aceitou_assinatura_eletronica INTEGER NOT NULL DEFAULT 0;
ALTER TABLE aceites_termos ADD COLUMN aceitou_geolocalizacao         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE aceites_termos ADD COLUMN aceitou_selfie                 INTEGER NOT NULL DEFAULT 0;
```

Atualizar `src/lib/server/schema.ts` e `src/routes/aceitar-termo/+page.svelte`
(Svelte 5: `$state()` por checkbox, snippets para blocos de texto explicativo).
Atualizar `src/routes/aceitar-termo/+page.server.ts` para ler e salvar os novos campos.

**Dependência:** A11 (novo bump de versão do Termo — unificar em `VERSAO = '1.2'`).

---

### M18 — User-agent completo (device fingerprinting)
**Complexidade:** S | **Artigo:** 6º

Criar `resumirUserAgent()` em `src/lib/db/audit.ts`:
```typescript
export function resumirUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const os =
    /iPhone|iPad|iPod/.test(ua) ? 'iOS' :
    /Android/.test(ua)          ? 'Android' :
    /Windows/.test(ua)          ? 'Windows' :
    /Macintosh/.test(ua)        ? 'macOS' :
    /Linux/.test(ua)            ? 'Linux' : 'Outro';
  const br =
    /Edg\//.test(ua)                        ? 'Edge' :
    /Chrome\//.test(ua)                     ? 'Chrome' :
    /Firefox\//.test(ua)                    ? 'Firefox' :
    /Safari\//.test(ua)                     ? 'Safari' : 'Outro';
  return `${os} / ${br}`;
}
```

Aplicar nos mesmos 6 arquivos do item A5, além de `registrarAudit` em `src/lib/db/audit.ts`.

---

### M19 — Tokens de 2FA armazenados em texto plano
**Complexidade:** M | **Artigo:** 46

Em `criarDesafio2FA` (`src/lib/auth.ts:280`), hashear o código antes de persistir:
```typescript
const codigoHash = Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codigo)))
).map(b => b.toString(16).padStart(2, '0')).join('');

await db.insert(doisFatoresTokens).values({ ..., codigo: codigoHash });
```

Em `verificarDesafio2FA` (`src/lib/auth.ts:357`), hashear o input antes de comparar:
```typescript
const inputHash = Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(codigoInput))))
).map(b => b.toString(16).padStart(2, '0')).join('');

// Usar timingSafeEqual com inputHash vs desafio.codigo
```

---

### M20 — Mascaramento de email revela domínio completo
**Complexidade:** S | **Arquivo:** `src/lib/server/auth-flow.ts:26`

```typescript
export function mascararEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***@***';
  const local = email.slice(0, at);
  const domainParts = email.slice(at + 1).split('.');
  // Manter apenas TLD — nunca domínio completo
  const maskedDomain = domainParts.length >= 2
    ? `***.${domainParts[domainParts.length - 1]}`
    : '***';
  const maskedLocal = local.length <= 2
    ? '*'.repeat(local.length)
    : `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}`;
  return `${maskedLocal}@${maskedDomain}`;
}
```

---

### M21 — Lat/lng com precisão de centímetros em PDF
**Complexidade:** S | **Arquivo:** `src/lib/server/pdf-signing-visual.ts:345`

Reduzir para 2 casas decimais (~1,1 km de precisão) ao renderizar no PDF.
Os dados precisos continuam no banco para fins forenses:

```typescript
const lat = s.latitude  ? s.latitude.toFixed(2)  : null;
const lng = s.longitude ? s.longitude.toFixed(2) : null;
drawP('Localização', (lat && lng) ? `${lat}, ${lng}` : 'Não capturado');
```

---

## Resumo por Arquivo

| Arquivo | Issues |
|---------|--------|
| `src/routes/validar/[hash]/+page.server.ts` | C2 |
| `src/lib/server/auth-flow.ts` | C4 · A5 (recordAttempt) · A14 · M20 |
| `src/lib/auth.ts` | A14 · M19 |
| `src/lib/db/audit.ts` | A5 (exportar anonimizarIp) · A15 (tipo AcaoAudit) · M18 |
| `src/lib/db/documentos.ts` | A5 |
| `src/lib/db/gise/documentos.ts` | A5 |
| `src/lib/db/gise/presencas.ts` | A5 |
| `src/lib/db/gise/assinaturas.ts` | A5 |
| `src/lib/db/termos.ts` | A5 |
| `src/lib/server/termo/termo-vigente.ts` | A9 · A11 · M17 |
| `src/lib/server/schema.ts` | A10 · A16 · M17 |
| `src/lib/server/pdf-signing-visual.ts` | M21 |
| `src/lib/db/configuracoes.ts` | A6 |
| `src/lib/server/email.ts` | A8 |
| `src/app.d.ts` | A12 (Env.WEBHOOK_HMAC_SECRET) |
| `scripts/set-default-password-all-users.ts` | C3 |
| `.gitignore` | C1 |
| `migrations/0017_*.sql` | A5 (histórico) |
| `migrations/0018_*.sql` | A6 (config) |
| `migrations/0019_*.sql` | A10 (incidentes) |
| `migrations/0020_*.sql` | A16 (solicitações) |
| **Novos arquivos** | |
| `src/lib/db/lgpd-retencao.ts` | A6 |
| `src/routes/api/admin/lgpd/limpeza/+server.ts` | A6 |
| `src/routes/api/admin/lgpd/incidentes/+server.ts` | A10 |
| `src/routes/api/admin/lgpd/solicitacoes/+server.ts` | A16 |
| `src/routes/api/policiais/[id]/lgpd/+server.ts` | A16 |
| `src/routes/termo/dpo/+page.svelte` + `+page.server.ts` | A11 |
| `scripts/anonimizar-ips-historico.ts` | A5 (migração histórica) |

---

## Estimativas por Sprint

| Item | Descrição | Porte | Sprint |
|------|-----------|-------|--------|
| C1 | dump.sql no git | S | 0 |
| C2 | Exposição de dados em /validar/[hash] | S | 1 |
| C3 | Senha hardcoded em script | S | 1 |
| C4 | Bypass 2FA com env vars | M | 1 |
| A5 | Anonimizar IP nas 6 tabelas + migração histórica | M | 2 |
| A6 | Política de retenção + job de limpeza | L | 2 |
| A7 | Headers no fluxo de reset de senha | S | 2 |
| A8 | Primeiro acesso por link, não senha em email | M | 2 |
| A9+A11 | email_pessoal no Termo + DPO com contato | S | 2 |
| A10 | Notificação de incidentes (tabela + endpoints) | L | 2 |
| A12 | HMAC nos webhooks | S | 2 |
| A14 | Sessão de 12h → 1h | S | 2 |
| A15 | Auditoria em exports PDF/XLSX/DOCX | S | 2 |
| A16 | Direitos dos titulares (acesso, exclusão, portabilidade) | L | 2 |
| M17 | Consentimento granular | M | 3 |
| M18 | Resumir user-agent | S | 3 |
| M19 | Hash nos tokens 2FA | M | 3 |
| M20 | Mascaramento de email (ocultar domínio) | S | 3 |
| M21 | Lat/lng com 2 casas no PDF | S | 3 |

**Total estimado:** ~5–6 semanas de desenvolvimento (1 dev)
