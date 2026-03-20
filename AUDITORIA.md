# Auditoria do Projeto - Sistema de Escalas de Plantao Policial

**Data:** 2026-03-19
**Escopo:** Boas praticas, seguranca, funcionalidades ausentes e recomendacoes

---

## Resumo Executivo

O projeto e uma aplicacao full-stack (SvelteKit + Cloudflare D1) para gestao de escalas de plantao policial. A arquitetura e moderna e bem organizada, mas existem **vulnerabilidades de seguranca criticas**, **funcionalidades essenciais ausentes** e **melhorias de boas praticas** que devem ser implementadas.

---

## 1. SEGURANCA - Problemas Criticos

### 1.1 Hash de senha sem salt (CRITICO)

**Arquivo:** `src/lib/auth.ts:10-16`

O sistema usa SHA-256 puro sem salt para hash de senhas. Isso torna todas as senhas vulneraveis a ataques de rainbow table.

**Problema:**
```ts
const hashBuffer = await crypto.subtle.digest('SHA-256', data);
```

**Solucao recomendada:** Usar PBKDF2 ou bcrypt com salt aleatorio por usuario. No ambiente Cloudflare Workers, PBKDF2 esta disponivel via `crypto.subtle`:

```ts
async function hashSenha(senha: string, salt?: string): Promise<string> {
  const saltBytes = salt
    ? new Uint8Array(salt.match(/.{2}/g)!.map(b => parseInt(b, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
    key, 256
  );
  const saltHex = Array.from(saltBytes).map(b => b.toString(16).padStart(2,'0')).join('');
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
  return `${saltHex}:${hashHex}`;
}
```

### 1.2 Cookie sem flag `secure` (ALTO)

**Arquivo:** `src/routes/api/auth/login/+server.ts:26-31`

```ts
secure: false  // Permite transmissao em HTTP nao criptografado
```

**Recomendacao:** Usar `secure: true` em producao. Pode-se condicionar:
```ts
secure: !import.meta.env.DEV
```

### 1.3 Sessoes expiradas nao sao limpas (MEDIO)

**Arquivo:** `migrations/0005_auth.sql`

Nao existe mecanismo de limpeza de sessoes expiradas na tabela `sessoes`. Isso causa acumulo indefinido de dados.

**Recomendacao:** Criar um Cloudflare Cron Trigger ou limpar sessoes expiradas no endpoint de login:
```sql
DELETE FROM sessoes WHERE expires_at < datetime('now');
```

### 1.4 Sem rate limiting no login (ALTO)

**Arquivo:** `src/routes/api/auth/login/+server.ts`

Nao ha protecao contra brute force. Um atacante pode tentar infinitas combinacoes de senha.

**Recomendacao:** Implementar rate limiting por IP usando Cloudflare Rate Limiting ou um contador no D1:
- Bloquear apos 5 tentativas falhas por 15 minutos
- Registrar tentativas de login em tabela separada

### 1.5 Senha padrao exposta na tela de login (MEDIO)

**Arquivo:** `src/routes/login/+page.svelte:92-95`

```svelte
<p>Senha inicial: <strong>12345678</strong></p>
```

Exibir a senha padrao na tela de login e uma informacao sensivel visivel a qualquer pessoa.

**Recomendacao:** Remover essa informacao da interface e comunica-la apenas por canal seguro (email, documento interno).

### 1.6 Senha fixa em 8 caracteres (MEDIO)

**Arquivo:** `src/routes/api/auth/alterar-senha/+server.ts:17`

```ts
if (!nova_senha || nova_senha.length !== 8)
```

A senha DEVE ter exatamente 8 caracteres - isso e excessivamente restritivo e enfraquece a seguranca.

**Recomendacao:** Exigir minimo de 8 caracteres com criterios de complexidade:
```ts
if (!nova_senha || nova_senha.length < 8 || nova_senha.length > 64)
```

### 1.7 Sem headers de seguranca (MEDIO)

O projeto nao define headers como:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security`
- `Content-Security-Policy`

**Recomendacao:** Adicionar em `hooks.server.ts`:
```ts
const response = await resolve(event);
response.headers.set('X-Content-Type-Options', 'nosniff');
response.headers.set('X-Frame-Options', 'DENY');
response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
return response;
```

### 1.8 DELETE via query string (BAIXO)

**Arquivos:** `src/routes/api/policiais/+server.ts:51`, `src/routes/api/escalas/+server.ts:52`

O DELETE usa `url.searchParams.get('id')` em vez do body ou path param. Isso e incomum e pode ser explorado via CSRF em links.

---

## 2. FUNCIONALIDADES AUSENTES

### 2.1 Gestao de administradores

Nao existe CRUD para administradores. O unico admin e criado via migration SQL. Nao ha como:
- Criar novos admins pela interface
- Editar/remover admins
- Listar admins existentes

### 2.2 Recuperacao de senha

Nao existe funcionalidade de "Esqueci minha senha". Se um usuario esquecer a senha, a unica opcao e intervencao direta no banco.

**Recomendacao:** Implementar reset de senha pelo admin (que pode redefinir a senha de qualquer policial para a padrao).

### 2.3 Log de auditoria / Historico de acoes

Nao existe registro de quem fez o que no sistema. Em um sistema policial, isso e fundamental para:
- Rastrear quem criou/editou/excluiu policiais
- Saber quem modificou escalas
- Registrar logins e tentativas falhas

**Recomendacao:** Criar tabela `audit_log`:
```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER,
  usuario_tipo TEXT,
  acao TEXT NOT NULL,
  entidade TEXT NOT NULL,
  entidade_id INTEGER,
  detalhes TEXT,
  ip TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 2.4 Paginacao nas listagens

Os endpoints `GET /api/policiais` e `GET /api/escalas` retornam TODOS os registros sem paginacao. Com centenas de policiais, isso impacta performance.

**Recomendacao:** Adicionar `?page=1&limit=20` nos endpoints.

### 2.5 Busca e filtros

Nao ha funcionalidade de busca por nome, matricula ou cargo na listagem de policiais. Nem filtro por cidade/periodo nas escalas.

### 2.6 Validacao de conflitos de escala

O sistema permite alocar o mesmo policial em duas escalas no mesmo dia/horario sem nenhum aviso ou bloqueio.

**Recomendacao:** Verificar conflitos antes de inserir em `adicionarPolicialEscala()`:
```sql
SELECT COUNT(*) FROM escala_policiais
WHERE policial_id = ? AND data_plantao = ? AND escala_id != ?
```

### 2.7 Dashboard / Painel de resumo

A pagina inicial (`+page.svelte`) e apenas uma tela com dois cards de navegacao. Nao ha:
- Total de policiais ativos
- Escalas ativas/proximas
- Proximos plantoes do usuario logado
- Estatisticas por lotacao

### 2.8 Notificacoes

Nao ha sistema de notificacao para:
- Policial alocado em nova escala
- Escala proxima (lembrete)
- Alteracoes em escalas ja publicadas

### 2.9 Soft delete para escalas

Ao excluir uma escala (`DELETE FROM escalas WHERE id = ?`), todos os vinculos sao perdidos permanentemente (CASCADE). Nao ha como recuperar.

**Recomendacao:** Adicionar campo `ativo` na tabela `escalas` (como ja existe em `policiais`).

### 2.10 Impressao / Visualizacao antes de exportar

Nao ha preview da escala antes de exportar em PDF/DOCX. O usuario precisa baixar para ver como ficou.

---

## 3. BOAS PRATICAS DE CODIGO

### 3.1 Sem testes automatizados (CRITICO)

O projeto nao possui nenhum teste unitario, de integracao ou e2e. Para um sistema de gestao de escalas policiais, isso e inaceitavel.

**Recomendacao:**
- Vitest para testes unitarios (ja compativel com SvelteKit)
- Playwright para testes e2e
- Testar ao menos: autenticacao, CRUD de policiais, CRUD de escalas, permissoes

### 3.2 Sem validacao de entrada robusta

A validacao dos dados e feita manualmente com `if (!data.nome)`. Nao ha biblioteca de validacao.

**Recomendacao:** Usar `zod` para validacao de schemas:
```ts
const PolicialSchema = z.object({
  nome: z.string().min(3).max(100),
  matricula: z.string().length(8),
  cargo: z.enum(['DPC', 'OIP']),
  telefone: z.string().optional(),
  lotacao: z.string().min(1)
});
```

### 3.3 Erros internos expostos ao usuario

**Arquivo:** `src/routes/api/policiais/+server.ts:47`
```ts
return json({ error: message }, { status: 500 });
```

Mensagens de erro do banco de dados sao enviadas diretamente ao cliente, podendo expor informacoes internas.

**Recomendacao:** Logar o erro internamente e retornar mensagem generica:
```ts
console.error('Erro ao criar policial:', e);
return json({ error: 'Erro interno do servidor' }, { status: 500 });
```

### 3.4 Sem `.env.example`

Nao ha arquivo de exemplo para variaveis de ambiente, dificultando onboarding de novos desenvolvedores.

### 3.5 Sem linter/formatter configurado

Nao ha ESLint ou Prettier configurado no projeto. Isso leva a inconsistencias de estilo.

**Recomendacao:** Adicionar ESLint + Prettier com configuracao para Svelte:
```json
// package.json
"devDependencies": {
  "eslint": "^9.x",
  "prettier": "^3.x",
  "prettier-plugin-svelte": "^3.x"
}
```

### 3.6 CI/CD sem etapa de verificacao

**Arquivo:** `.github/workflows/deploy.yml`

O pipeline faz build e deploy direto, sem:
- Rodar `npm run check` (type checking)
- Rodar testes
- Rodar linter

**Recomendacao:** Adicionar etapas antes do deploy:
```yaml
- run: npm run check
- run: npm run lint
- run: npm test
```

### 3.7 Falta tratamento de erro na exclusao

Ao excluir um policial (`DELETE /api/policiais`), nao se verifica se ele esta vinculado a escalas ativas. O CASCADE deleta silenciosamente todos os vinculos.

---

## 4. EXPERIENCIA DO USUARIO (UX)

### 4.1 Sem confirmacao em acoes destrutivas

Nao ha dialogo de confirmacao ao:
- Excluir um policial
- Excluir uma escala
- Remover policial de uma escala

### 4.2 Sem feedback de carregamento em listagens

As paginas de listagem nao mostram estado de loading enquanto buscam dados da API.

### 4.3 Sem pagina 404

Nao existe pagina customizada para rotas inexistentes.

### 4.4 Sem breadcrumbs

A navegacao nao indica ao usuario onde ele esta (ex: Inicio > Escalas > Escala #5).

### 4.5 Sem acessibilidade (a11y)

- Faltam `aria-label` em varios botoes de acao
- Nao ha skip links
- Contraste de cores nao foi verificado

---

## 5. INFRAESTRUTURA E DEVOPS

### 5.1 Sem ambiente de staging

O deploy vai direto para producao ao fazer push na `main`. Nao ha ambiente de homologacao.

### 5.2 Sem backup automatizado do D1

Nao ha estrategia de backup do banco de dados Cloudflare D1.

### 5.3 Sem monitoramento/observabilidade

Nao ha integracao com ferramentas de monitoramento (Sentry, LogFlare, etc.) para rastrear erros em producao.

### 5.4 Sem versionamento de migrations

As migrations sao arquivos SQL numerados sem controle de estado (quais ja foram executadas). Cloudflare D1 usa `wrangler d1 migrations apply`, mas nao ha documentacao de como executa-las.

---

## 6. PRIORIDADES DE IMPLEMENTACAO

| # | Item | Severidade | Esforco |
|---|------|-----------|---------|
| 1 | Hash de senha com salt (PBKDF2) | Critico | Medio |
| 2 | Testes automatizados (Vitest + Playwright) | Critico | Alto |
| 3 | Rate limiting no login | Alto | Baixo |
| 4 | Cookie secure em producao | Alto | Baixo |
| 5 | Headers de seguranca | Medio | Baixo |
| 6 | Log de auditoria | Medio | Medio |
| 7 | Validacao com Zod | Medio | Medio |
| 8 | Conflito de escalas | Medio | Baixo |
| 9 | Paginacao e busca | Medio | Medio |
| 10 | Dashboard com estatisticas | Baixo | Medio |
| 11 | CRUD de administradores | Medio | Medio |
| 12 | Limpeza de sessoes expiradas | Medio | Baixo |
| 13 | ESLint + Prettier | Baixo | Baixo |
| 14 | CI com check/lint/test | Baixo | Baixo |
| 15 | Confirmacao em acoes destrutivas | Baixo | Baixo |
| 16 | Soft delete para escalas | Baixo | Baixo |
| 17 | Reset de senha pelo admin | Medio | Baixo |
| 18 | Remover senha padrao da tela de login | Medio | Baixo |

---

## 7. PONTOS POSITIVOS

- Arquitetura bem organizada seguindo convencoes do SvelteKit
- Separacao clara entre camadas (db, auth, types, routes)
- Uso de prepared statements no D1 (previne SQL injection)
- RBAC funcional com filtragem por lotacao
- Primeiro acesso obriga troca de senha
- Export para multiplos formatos (PDF, DOCX, XLSX, ODS)
- UI moderna com tema institucional
- Responsivo (mobile e desktop)
- CI/CD com GitHub Actions + Cloudflare Pages
- TypeScript com strict mode

---

*Auditoria realizada de forma automatizada. Recomenda-se priorizacao dos itens criticos e de seguranca antes de qualquer nova funcionalidade.*
