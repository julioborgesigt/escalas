# Deploy e operação (Cloudflare Pages + D1 + R2)

Este runbook descreve o que é necessário para colocar e manter o sistema em produção com o stack atual (SvelteKit, adapter Cloudflare, Wrangler).

## Pré-requisitos

- Conta Cloudflare com **Pages**, **D1** e **R2** habilitados.
- Node.js **22+** (alinhado ao `engines` do `package.json` e ao [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)).
- API token da Cloudflare com permissão de deploy em Pages (e acesso à conta).

## Variáveis e secrets

Configurar no projeto Pages (**Settings → Environment variables**) ou via `wrangler secret`, conforme o fluxo da equipe. A **lista completa e comentada** de todas as variáveis está em [`.env.example`](.env.example) (fonte autoritativa); os tipos em [`src/app.d.ts`](src/app.d.ts). A tabela abaixo cobre as **mais importantes / não-óbvias**.

| Variável                                                        | Obrigatório                                    | Uso                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PASSWORD_PEPPER`                                               | **Recomendado (ver aviso)**                    | Pepper de senha (achado A3): HMAC-SHA256 aplicado à senha antes do PBKDF2 (formato `pbkdf2v3`). Neutraliza brute-force offline se o D1 vazar. **CRÍTICO:** uma vez ligado, hashes v3 só verificam com este exato valor — **guarde em cofre e NUNCA rotacione** sem plano de migração (trocá-lo invalida todos os logins v3). Ver [Hashing de senha e o pepper](#hashing-de-senha-e-o-password_pepper). Gere com `openssl rand -hex 32`. |
| **E-mail** (2FA / primeiro acesso / reset)                      | Sim, para login                                | Binding `EMAIL` (Cloudflare Email Sending — Settings → Functions/Bindings) como primário **ou** `RESEND_API_KEY` + `RESEND_FROM_EMAIL` como fallback. `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` habilitam o caminho via API da Cloudflare. **Sem e-mail funcionando, o 2FA (fail-closed A1) e o primeiro acesso travam.**                                                                                                          |
| `SYNC_TOKEN`                                                    | Sim, para webhooks                             | Bearer token usado por [`/api/webhook/sync-policiais`](src/routes/api/webhook/sync-policiais/+server.ts) e [`/api/webhook/sync-unidades`](src/routes/api/webhook/sync-unidades/+server.ts)                                                                                                                                                                                                                                              |
| `RESET_TOKEN`                                                   | **Apenas** se quiser permitir reset destrutivo | Segredo **separado**, distinto do `SYNC_TOKEN`, exigido por [`/api/webhook/reset-policiais`](src/routes/api/webhook/reset-policiais/+server.ts). Sem ele configurado, o endpoint sempre retorna 401 (fail-closed).                                                                                                                                                                                                                      |
| `SUPER_ADMIN_LOGIN` / `SUPER_ADMIN_SENHA` / `SUPER_ADMIN_EMAIL` | Bootstrap / break-glass                        | Conta root de emergência via env. `SUPER_ADMIN_EMAIL` (recomendado) passa a exigir 2FA no login root. A senha pode (e DEVE) ser um **hash PBKDF2 v2** em vez de texto claro — gere com `HASH_PASSWORD=SENHA npx tsx scripts/hash-password.ts` (emite v2 **de propósito**: o break-glass NÃO depende do `PASSWORD_PEPPER`, então o root entra mesmo se o pepper for perdido).                                                            |
| `ADMIN_GERAL_LOGIN` / `ADMIN_GERAL_SENHA`                       | Opcional / ambiente admin                      | Login de Admin Geral via env. Mesma regra de hash do `SUPER_ADMIN_SENHA` acima.                                                                                                                                                                                                                                                                                                                                                         |
| `RATE_LIMIT_IP_SALT`                                            | Recomendado em produção                        | Segredo (`openssl rand -hex 32`) que muda a chave de rate-limit de "/24 anonimizada" para **hash salteado do IP completo**. Sem ele, 5 falhas de login bloqueiam a /24 inteira (ex.: o NAT da corporação — DoS barato e lockout mútuo). Com ele, o bloqueio é por endereço, sem persistir IP em claro (LGPD ok).                                                                                                                        |
| `APP_ORIGIN`                                                    | Recomendado em produção                        | Origem canônica (`https://...`) usada nos links de e-mail, fechando host-header injection. Sem ela, usa a origem da requisição.                                                                                                                                                                                                                                                                                                         |
| `HEALTH_DETAIL_TOKEN`                                           | Recomendado                                    | Sem ele, `/api/health` devolve só `{status}`. Com `?detail=<token>`, devolve o detalhe (D1/R2/retenção) — ver [Failsafe](#failsafe-da-limpeza-de-retenção).                                                                                                                                                                                                                                                                             |
| `SENTRY_*` / DSN                                                | Se Sentry estiver ligado                       | Erros no worker (`@sentry/cloudflare`). Logins via credenciais de bootstrap (SUPER_ADMIN/ADMIN_GERAL) geram evento `warning` no Sentry.                                                                                                                                                                                                                                                                                                 |
| `SESSION_CACHE_TTL_SECONDS`                                     | Opcional                                       | TTL (s) do cache edge de sessão (default 60, clamp [0,300]). `0` desliga (revogação imediata, mais queries D1).                                                                                                                                                                                                                                                                                                                         |
| `WEBHOOK_REPLAY_ENFORCE`                                        | Após rollout (ver abaixo)                      | Quando truthy (`1`, `true`, `yes`, `on`), webhooks rejeitam requisições sem `X-Webhook-Timestamp` + `X-Webhook-Nonce`. Default: aceita por compatibilidade, mas loga `info` para cada chamada sem headers.                                                                                                                                                                                                                              |

> **Outras** (assinatura/GISE/flags) estão em `.env.example` e nas seções específicas: `ICP_BRASIL_TRUST_STORE_REQUIRED`, `TSA_*`/`EXIGIR_TSA_QUALIFICADA`, `EMBED_PADES_LT_DSS`, `PA_AD_RB_HASH_HEX`, `SELO_INSTITUCIONAL_PEM`, `GISE_BASE_EQUIPE_*`, `WEBHOOK_ALLOW_PAPEL_CHANGES`.
>
> **Legado removido:** `GMAIL_USER`/`GMAIL_APP_PASSWORD` (SMTP via Gmail) **não são mais lidos** — podem ser apagados do ambiente. O envio usa o binding `EMAIL` + Resend.

**Secrets sensíveis:** nunca commitar `.dev.vars` com valores reais; usar apenas localmente ou CI.

> **Importante:** `RESET_TOKEN` deve ser **estritamente diferente** de `SYNC_TOKEN`. O design separa os dois para que comprometer o token de webhook não baste para apagar o banco. Gere com `openssl rand -hex 32` e armazene apenas no Cloudflare + na planilha de operações.

### Hashing de senha e o `PASSWORD_PEPPER`

As senhas são hasheadas com **PBKDF2-HMAC-SHA256, 100 000 iterações** (formato versionado em [`src/lib/crypto/password-hash.ts`](src/lib/crypto/password-hash.ts), re-exportado por `$lib/auth`):

| Formato     | Quando                                                                  |
| ----------- | ----------------------------------------------------------------------- |
| `pbkdf2v1:` | Legado (100k implícito) — aceito, migra no login.                       |
| `pbkdf2v2:` | Atual sem pepper.                                                       |
| `pbkdf2v3:` | **Atual com pepper** — `PBKDF2( HMAC-SHA256(PASSWORD_PEPPER, senha) )`. |

**Por que pepper e não "600k iterações" (achado A3):** o runtime da Cloudflare (workerd — o mesmo no Pages e no Workers) impõe um **teto rígido de 100 000 iterações** na API `crypto.subtle`; pedir mais lança erro. O pepper (HMAC com um segredo global do ambiente, custo de CPU ~zero) resolve o brute-force offline **sem** depender de iterações altas. A migração para Workers foi avaliada e **arquivada** por causa disso — a avaliação completa (`MIGRACAO-WORKERS.md`) está no histórico do Git, ver [`docs/HISTORICO.md`](docs/HISTORICO.md).

**Operação do `PASSWORD_PEPPER`:**

- Com o segredo setado, `hashSenha` emite `pbkdf2v3`; no login bem-sucedido, hashes `v1`/`v2` **re-hasham para v3** progressivamente (sem big-bang no banco).
- ⚠️ **É load-bearing:** hashes `v3` só verificam com **este exato valor**. **Guarde em cofre e NUNCA rotacione** sem um plano de migração — trocar/perder o valor invalida **todos** os logins v3 (todos os usuários precisariam redefinir a senha). Gere uma única vez com `openssl rand -hex 32`.
- O login de **break-glass** (`SUPER_ADMIN`/`ADMIN_GERAL` por env) **não** depende do pepper (compara o segredo da env, aceitando `pbkdf2v2` ou texto) — continua funcionando mesmo se o pepper for perdido.

**Hashes pré-PBKDF2 (SHA-256 sem salt) NÃO são mais aceitos** (o suporte legado foi removido). Contas que ainda estejam nesse formato **não autenticam por senha** e precisam ser resetadas para primeiro acesso — ver [Primeiro acesso e reset em massa (go-live)](#primeiro-acesso-e-reset-em-massa-go-live).

### Endpoint destrutivo `/api/webhook/reset-policiais`

Apaga TODAS as tabelas operacionais (policiais, unidades, escalas, GISE, documentos). Exige **3 camadas** de autenticação:

1. `Authorization: Bearer <SYNC_TOKEN>` — token padrão de webhooks.
2. `X-Reset-Token: <RESET_TOKEN>` — segredo separado.
3. `X-Confirm-Reset: <YYYY-MM-DD em UTC>` — janela de 24 h, evita replay.

Antes de deletar, o endpoint registra no logger estruturado um snapshot com a contagem de linhas por tabela. Esse snapshot é devolvido na resposta e pode ser consultado em Workers Logs / Sentry para recuperação forense.

**Operação recomendada:** disparar pelo menu da planilha (`scripts/GoogleAppsScript_Sync.gs` → "⚠️ ZERAR Banco de Dados"). Há dupla confirmação (botão + frase digitada) para evitar acidente. Ver setup em [Sincronização Google Sheets](#sincronização-google-sheets).

### Replay protection dos webhooks (P1.3)

Além da autenticação HMAC/Bearer, todos os webhooks (`sync-policiais`, `sync-unidades`, `reset-policiais`) suportam dois headers extras para impedir reenvio de payload capturado:

| Header                | Valor                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Webhook-Timestamp` | Unix em segundos (10 dígitos), milissegundos (13 dígitos), ou ISO 8601. Servidor aceita janela de ±5 min (clock skew).                  |
| `X-Webhook-Nonce`     | Único por requisição, ≥16 chars. UUID v4 ou similar. Persistido em `webhook_nonces` (PRIMARY KEY) — reenvio do mesmo nonce devolve 401. |

O `scripts/GoogleAppsScript_Sync.gs` já envia ambos os headers em todas as chamadas a partir do `sendToAPI()`. **Republicar a Web App do Apps Script após o deploy é o que ativa a geração desses headers no caller.**

#### Rollout em duas fases

1. **Deploy do código (esta versão)**: servidor passa a aceitar e validar os headers quando presentes, mas **não exige**. Sem headers, vai um `info` no log dizendo "sem headers de replay protection — rollout".
2. **Republicar a Apps Script**: passa a enviar os headers. Confirmar nos logs do Worker que toda chamada agora vem com timestamp+nonce.
3. **~~Setar `WEBHOOK_REPLAY_ENFORCE=1`~~** — **FEITO 06/ago** (Pages production secret
   do projeto `escalas`). Qualquer chamada sem os headers devolve 401.

A limpeza periódica de `webhook_nonces` (e das demais tabelas de retenção) é automatizada por `executarLimpezaRetencao`, disparada pelo cron `cleanup-retencao.yml` (GitHub Actions) — ver [Failsafe da limpeza de retenção](#failsafe-da-limpeza-de-retenção).

Entre as tabelas varridas está `assinatura_intencoes` (migração `0040`), que amarra cada PDF preparado ao documento, ao assinante e a um único uso. Cada linha vive 15 minutos e some junto com os tokens de redefinição — é o mesmo tipo de dado: segredo de curta duração atrelado a uma pessoa. Nenhuma variável de ambiente nova.

### Pendências de auditoria

O mesmo cron da limpeza de retenção reprocessa `audit_pendencias`: eventos que
não conseguiram entrar na cadeia de auditoria. A política é **registrar
pendência durável e seguir** — falha de trilha não desfaz a operação do
usuário, mas o evento não some.

A resposta do webhook traz `pendenciasRestantes`. **É o número a monitorar.**
Zero é o normal. Crescendo entre execuções, há evento que a cadeia recusa de
forma permanente — o campo `tentativas` de cada linha separa isso da corrida de
`seq`, que some na primeira retentativa:

```sql
SELECT acao, entidade, motivo, tentativas, created_at
FROM audit_pendencias ORDER BY tentativas DESC, created_at;
```

Um `tentativas` alto com o mesmo `motivo` é defeito, não ruído: o evento nunca
vai entrar sozinho, e a trilha está incompleta até alguém agir.

### Failsafe da limpeza de retenção

O Cloudflare Pages não tem cron nativo, então a limpeza depende do agendador externo (`cleanup-retencao.yml`, diário). Se ele parar de disparar (workflow desabilitado, segredo rotacionado, repositório arquivado), as tabelas de retenção crescem **silenciosamente** e consomem cota do D1.

Para flagrar isso sem nova tabela nem armazenamento extra, `GET /api/health?detail=<HEALTH_DETAIL_TOKEN>` reporta o campo `retencao` derivado do último `audit_log` de limpeza:

```json
{
	"status": "degraded",
	"checks": { "limpezaRetencao": "stale" },
	"retencao": { "ultimaExecucao": "...", "horasDesdeUltima": 73.2, "atrasada": true }
}
```

**Ação do operador:** aponte um monitor externo (UptimeRobot, Better Stack, etc.) para essa URL e alerte quando `retencao.atrasada` for `true` (ou `status` for `degraded`). A tolerância padrão é 48h (o cron roda a cada 24h). A liveness pública (`/api/health` sem `detail`) **não** muda por causa da defasagem — continua `200 ok` enquanto D1/R2 respondem.

## Papéis e privilégios de administrador

Há quatro níveis. O **Super Admin é um Admin Geral com poderes extras** (é `tipo='admin'` + `isSuperAdmin`), então faz tudo que o Admin Geral faz **mais** a coluna exclusiva. Os dois admins de banco (`administradores`) nascem **só** dos bootstraps por env (`SUPER_ADMIN_*` / `ADMIN_GERAL_*`); **não há tela para criá-los**. Já os admins **operacionais** (Seccional/Unidade) são **policiais promovidos** — e só o **Super Admin** promove.

| Capacidade                                                          | Super Admin | Admin Geral | Admin Seccional |  Admin Unidade   |
| ------------------------------------------------------------------- | :---------: | :---------: | :-------------: | :--------------: |
| **Promover/alterar papéis** (criar admins)                          |     ✅      |     ❌      |       ❌        |        ❌        |
| **Gerenciar policiais** (cadastrar/editar/excluir/upload CSV)       |     ✅      |     ❌      |       ❌        |        ❌        |
| **Gerenciar unidades/seccionais** (CRUD)                            |     ✅      |     ❌      |       ❌        |        ❌        |
| **Configurar política de assinatura** (foto/GPS/código/smartphone)  |     ✅      |     ❌      |       ❌        |        ❌        |
| **Baixar PDF forense íntegro** (`?manifesto=true` nos downloads)    |     ✅      |     ✅      |       ❌        |      ❌ (¹)      |
| **Baixar o forense pelo portal `/validar`** (rota semi-pública)     |     ✅      |     ❌      |       ❌        |        ❌        |
| Escalas — **escopo**                                                |   global    |   global    |  sua seccional  |   sua unidade    |
| GISE (finalizar/reabrir/exportar histórico)                         |     ✅      |     ✅      |       ❌        |        ❌        |
| LGPD / Compliance / incidentes / direitos dos titulares             |     ✅      |     ✅      |       ❌        |        ❌        |
| Consoles de **auditoria** (`/auditoria`, `/auditoria/logs`, export) |     ✅      |     ❌      |       ❌        |        ❌        |
| Alternar módulo (escalas ↔ GISE)                                    |     ✅      |     ✅      |       ❌        |        ❌        |
| Receber a **cópia de conferência** dos documentos                   |     ✅      |     ✅      |       ✅        | ✅ (e policiais) |

(¹) Exceção pontual à linha do forense: um **DPC que assinou o próprio documento** também pode baixá-lo com manifesto (`podeBaixarComManifesto` em `src/lib/manifesto.ts` — fonte única da regra, aplicada pelo servidor e pela visibilidade do botão "C/ manifesto").

**Leitura rápida:**

- **Super Admin** = _dono/configurador_: define **quem existe** (policiais), **a estrutura** (unidades), **quem é admin** (papéis) e **a política de assinatura**; único que baixa o forense pelo portal **`/validar`**. **Insubstituível** — sem ele, não há como promover admins nem recriá-lo pela interface. Mantenha-o lacrado (senha em hash `pbkdf2v2` + `SUPER_ADMIN_EMAIL` para 2FA).
- **Admin Geral** = _operador global_: opera **toda a operação** (escalas/GISE/LGPD) em **todas** as unidades, mas **não remodela a base** (não cadastra policial/unidade, não promove, não configura assinatura). Dispensável após o setup — ver [bootstrap dos admins por env](#variáveis-e-secrets).
- **Admin Seccional / Unidade** = _operador com escopo_: policiais promovidos pelo Super Admin; operam **escalas** dentro da própria seccional/unidade (fecha IDOR cross-unidade).

> **Para criar um admin operacional:** logado como Super Admin, abra `/policiais/[id]` da pessoa (que precisa existir como policial — via sync da planilha ou `/policiais/upload`), defina o **papel** (Admin Seccional/Unidade) e salve. Ela passa a logar por matrícula+senha (que nasce `pbkdf2v3`) + 2FA.

## Banco de dados (D1)

- Configuração de binding: [`wrangler.toml`](wrangler.toml) (`escalas_db`, diretório `migrations/`).
- **Migrações locais:** `npm run db:migrate`
- **Produção / remoto:** `npm run db:migrate:prod -- --yes` (usa `--remote`; o flag `--yes` é obrigatório como salvaguarda contra mutação acidental de produção — ver [Separação staging vs produção](#separação-staging-vs-produção))
- **Automático no CI:** os jobs de deploy do [`deploy.yml`](.github/workflows/deploy.yml) rodam a migração do ambiente alvo (staging/produção) **antes** do `pages deploy`. O script é incremental (tabela de controle `_migrations_aplicadas` — só as pendentes executam), então rodá-lo em todo push é barato e idempotente. O comando manual acima permanece como fallback/execução avulsa. ⚠️ O `CLOUDFLARE_API_TOKEN` dos secrets precisa da permissão **D1:Edit** além de Pages.

Após mudanças de schema, gerar migrações com Drizzle conforme o fluxo já usado no repositório; o CI as aplica no deploy seguinte (migrations devem ser retrocompatíveis com o código anterior — expand/contract).

### Migrações 0048–0051 (operações) — o que elas SEMEIAM

Estas três não só criam tabela: elas gravam dados de negócio. Vale saber o que
esperar ao vê-las passar em staging e em produção.

- **`0048_operacoes.sql`** cria a tabela `operacoes` e insere a operação
  **`GISE`**. Em seguida acrescenta `operacao_id` a `gise_escalas` e a
  `gise_modelo_formulario` e faz o **backfill de TODAS as linhas existentes para
  essa operação** — ou seja, tudo que já estava no banco passa a ser "GISE", e
  nada muda de comportamento. A migração também **remove duplicatas** de
  `gise_modelo_formulario` antes de criar o índice único `(operacao_id, tipo)`:
  nunca houve unicidade nessa tabela e a aplicação lia a PRIMEIRA linha do tipo,
  então uma segunda linha já estava invisível — o `DELETE` só descarta o que
  ninguém lia. Confira antes, se quiser o número:
  `SELECT operacao_id, tipo, count(*) FROM gise_modelo_formulario GROUP BY 1,2 HAVING count(*) > 1;`
- **`0049_operacao_linha_base.sql`** cria a tabela da linha de base. Vazia.
- **`0050_seed_operacao_crajubar.sql`** insere a **OPERAÇÃO CRAJUBAR**, copia
  para ela os formulários do GISE e acrescenta os cinco indicadores da tabela §9
  do Plano Operacional Estratégico. Num banco em uso (produção) a CRAJUBAR nasce
  com as perguntas do GISE **mais** os cinco indicadores; num banco novo, em que
  o GISE ainda não tem modelo gravado, ela nasce só com os cinco (as perguntas
  padrão vivem no código, e SQL não as alcança). Nos dois casos o Admin Geral
  ajusta pelo editor.

- **`0051_operacao_config.sql`** acrescenta a `operacoes` as colunas de
  configuração de escala (vagas padrão, horários e textos do breve relatório).
  Todas nascem **NULL**, que significa "herda o padrão do sistema" — as chaves em
  `configuracoes` que a antiga `/gise/config` gravava continuam sendo lidas, e
  nenhum PDF muda. A tela `/gise/config` sai do menu e passa a redirecionar
  (308) para `/gise/operacoes`; o que ela editava vive agora no botão
  **Configurações** de cada operação.

  Consequência a comunicar ao Admin Geral: **não há mais um editor do valor
  GLOBAL.** O que estava gravado continua valendo como herança, e a partir daqui
  cada operação define o seu.

Depois do deploy, confira em `/gise/operacoes` que as duas operações aparecem
(cada uma com os botões Formulário · Configurações · Editar), e em `/gise` que as
escalas antigas exibem o selo **GISE**.

## Armazenamento (R2)

- Binding `escalas_docs` em [`wrangler.toml`](wrangler.toml) — documentos e artefatos de assinatura dependem deste bucket.

## Separação staging vs produção

**Status: configurado.** Staging é o ambiente **Preview** do projeto Pages, com D1/R2 **dedicados** (`escalas-db-staging` / `escalas-docs-staging`), declarados na seção **`[env.preview]`** do [`wrangler.toml`](wrangler.toml). As bindings de **produção** ficam no top-level (inalteradas) — produção nunca escreve no banco de staging e vice-versa.

- **Deploy de staging:** push para a branch **`staging`** → o [`deploy.yml`](.github/workflows/deploy.yml) roda `pages deploy --branch=staging` (um _preview deployment_ do mesmo projeto Pages).
- **Migrações de staging:** `npm run db:migrate:staging` (alvo `--staging` do [`scripts/migrate.ts`](scripts/migrate.ts)).
- **Secrets de staging:** configurar no Pages → Settings → Environment variables, escopo **Preview**. Para o staging exercitar o caminho `pbkdf2v3`, defina também o `PASSWORD_PEPPER` no escopo Preview (pode ser um valor de teste, distinto do de produção — o D1 é isolado).
- **Guarda de produção:** só a **migração remota de produção** (`npm run db:migrate:prod`) exige `-- --yes`, abortando antes de tocar o D1 sem confirmação explícita.

> **Migração Pages → Workers (arquivada).** Houve uma avaliação de migrar para Cloudflare Workers (para subir o PBKDF2 a 600k); ela foi **descartada** porque o teto de 100k iterações é do runtime (idêntico em Pages e Workers) — o A3 foi resolvido pelo pepper. Avaliação completa (`MIGRACAO-WORKERS.md`) arquivada no histórico do Git, ver [`docs/HISTORICO.md`](docs/HISTORICO.md). **O stack é Cloudflare Pages.**

## Primeiro acesso e reset em massa (go-live)

No go-live (ou ao limpar dados de teste), reset todos os **policiais** para o fluxo de primeiro acesso — eles definem a própria senha (que nasce em `pbkdf2v3`) e verificam o e-mail pessoal:

```sh
npm run users:clear-passwords-non-admins:prod   # zera senha + primeiro_acesso=1 (PRESERVA admins)
```

**Antes de rodar para toda a base:**

1. **E-mail funcionando em produção** (binding `EMAIL` ou `RESEND_API_KEY`) — o primeiro acesso e o 2FA (fail-closed A1) **dependem** de envio de e-mail.
2. **Teste com UMA conta** o ciclo completo: primeiro acesso → define senha → verifica e-mail → 2FA → login → **logout → login de novo** (o 2º login confirma o caminho `v3`+pepper de ponta a ponta).
3. Só então rode o script acima e **comunique** aos policiais como fazer o primeiro acesso.

> Para **re-habilitar** uma senha-padrão compartilhada em ambiente de teste (não produção real), use `SET_PASSWORD=... PASSWORD_PEPPER=<valor> npm run users:set-default-password:prod` — o script é pepper-aware e grava em `pbkdf2v3`.

## Backup, restauração e rollback (D1 + R2)

Sistema com valor jurídico (assinaturas) exige plano de recuperação. Resumo dos mecanismos e procedimentos.

### D1 — backup lógico automatizado (export diário cifrado)

O workflow [`backup-d1.yml`](.github/workflows/backup-d1.yml) roda **diariamente** (05:43 UTC): exporta o banco de produção com `wrangler d1 export`, valida o dump (piso de tamanho + tabelas-chave — um export vazio falha o job em vez de subir silencioso), comprime, **cifra com [`age`](https://github.com/FiloSottile/age)** e grava no bucket R2 privado `escalas-backups`:

- `d1/diario/backup-d1-AAAA-MM-DD.sql.gz.age` — um por dia
- `d1/mensal/backup-d1-AAAA-MM.sql.gz.age` — snapshot do dia 1º (retenção mais longa)

O dump contém dados pessoais em claro (nome, e-mail, telefone) — por isso é cifrado **antes** de sair do runner, com a **chave pública** `age`; a chave privada nunca passa pelo CI. Falha do workflow gera a notificação padrão do GitHub Actions (aba Actions + e-mail para quem assina o repositório).

**Setup (uma vez, pelo operador):**

1. **Par de chaves age:** `age-keygen -o backup-key.txt` — guarde o arquivo (chave privada) em cofre **offline**; a linha `# public key: age1...` é o valor do secret `BACKUP_AGE_PUBLIC_KEY`. ⚠️ Sem a chave privada, os backups são ilegíveis — trate-a como o `PASSWORD_PEPPER`.
2. **Bucket:** crie `escalas-backups` no R2 e configure no dashboard:
   - **Lifecycle:** apagar objetos de `d1/diario/` após **90 dias** e de `d1/mensal/` após **12 meses**;
   - **Lock de retenção** (Settings do bucket): impede deleção dentro da janela mesmo com token comprometido.
3. **Token dedicado:** crie um API token com escopo mínimo (**D1 read** + **R2 write restrito ao bucket `escalas-backups`**) e cadastre como secret `CLOUDFLARE_BACKUP_API_TOKEN`. **Não reutilize** o token de deploy.
4. Confira os 3 secrets em Settings → Secrets and variables → Actions (`CLOUDFLARE_ACCOUNT_ID` já existe do deploy) e rode o workflow manualmente (aba Actions → _Backup D1_ → Run workflow) para validar ponta a ponta.

**Restauração** (para um banco novo/vazio — nunca por cima de produção sem export prévio):

```bash
# 1. Baixar o backup do R2
npx wrangler r2 object get escalas-backups/d1/diario/backup-d1-AAAA-MM-DD.sql.gz.age \
  --file=backup.sql.gz.age --remote
# 2. Decifrar (exige a chave privada, fora do CI) e descomprimir
age -d -i backup-key.txt backup.sql.gz.age | gunzip > backup.sql
# 3. Aplicar no banco de destino
npx wrangler d1 execute <db-destino> --remote --file=backup.sql
```

> Faça um **teste de restauração** após o setup (num D1 descartável) e depois periodicamente — backup que nunca foi restaurado não é backup.

**Export manual avulso** (fallback / pré-migração):

```bash
# Produção
npx wrangler d1 export escalas-db --remote --output=backup-$(date +%F).sql
# Staging
npx wrangler d1 export escalas-db-staging --remote --output=backup-staging-$(date +%F).sql
```

Guarde o `.sql` manual em local seguro e **privado** — contém dados pessoais; trate como o `dump.sql` (que é git-ignored).

### D1 — Time Travel (point-in-time recovery, ~30 dias)

O D1 mantém recuperação para qualquer ponto dos últimos ~30 dias, sem backup manual — útil para reverter migração ruim ou DELETE acidental:

```bash
npx wrangler d1 time-travel info escalas-db --remote
npx wrangler d1 time-travel restore escalas-db --remote --timestamp="2026-06-05T12:00:00Z"
```

> Time Travel **substitui** o estado atual pelo do instante escolhido — faça um `export` **antes** de restaurar, para não perder dados gravados depois do ponto.

### R2 — documentos assinados

Os PDFs/artefatos são **imutáveis por hash** (a chave deriva do conteúdo), então não há sobrescrita; o risco é **perda** (deleção). O R2 não tem PITR nativo — opções: ativar **versionamento/lock** no bucket (Dashboard → R2 → bucket → Settings) e/ou um job periódico que liste e copie os objetos para um bucket de backup. Como o `arquivo_hash` de cada documento está no D1, o backup do D1 permite **detectar objetos R2 ausentes**.

> **Cópias de conferência (`conferencia/<hash>.pdf`).** Além do blob assinado (com manifesto forense), o `preparar-assinatura` de cada fluxo por token grava, _best-effort_, uma **cópia de conferência** — idêntica por construção às páginas de conteúdo do documento assinado (mesmos bytes: base + rodapé universal + rubrica), **sem** manifesto e **sem** assinatura embutida. É **não-probatória** (a fé pública fica no blob assinado + no portal `/validar`) e serve os downloads padrão. Perdê-la é inócuo: os endpoints regeneram a partir do rascunho quando ela falta (assinaturas legadas incluídas). Revogar/excluir um documento apaga também sua cópia. Uma preparação abandonada (assinatura não concluída) deixa um objeto órfão inofensivo (~dezenas de KB) sob esse prefixo.

### Rollback de um deploy ruim (Cloudflare Pages)

O Pages mantém o histórico de deployments. Para reverter **código** instantaneamente (sem rebuild): Dashboard → Pages → projeto → Deployments → no último deployment bom, **"Rollback to this deployment"**. Não afeta D1/R2 (dados).

### Rollback de uma migração ruim

Migrações não têm "down" automático. Para reverter: (1) `wrangler d1 time-travel restore` para o instante **antes** da migração; ou (2) aplicar uma migração corretiva nova (preferível para mudanças pequenas). Rode **sempre** a migração em staging primeiro (`npm run db:migrate:staging`).

## Modelos do face-api (assets estáticos)

O reconhecimento facial usado pelo `SignaturePad.svelte` carrega o modelo `tinyFaceDetector` de [`@vladmandic/face-api`](https://github.com/vladmandic/face-api). Os arquivos (`tiny_face_detector_model-weights_manifest.json` + `tiny_face_detector_model.bin`, ~196 KB) ficam **versionados em [`static/face-api/`](static/face-api/)** e são servidos pela CDN do Cloudflare Pages em `/face-api/`.

- **Antes:** baixados de `cdn.jsdelivr.net`. Risco de rate-limit, indisponibilidade e exigia entrada extra no CSP.
- **Hoje:** servidos `same-origin` com cache imutável. CSP `connect-src` mais estrita.

**Quando atualizar `@vladmandic/face-api`:** copie os arquivos novos do `node_modules` para `static/face-api/` (instruções em [`static/face-api/README.md`](static/face-api/README.md)). Sem esse passo, a versão da lib em runtime fica dessincronizada do modelo servido.

## Cache edge das flags de assinatura

As flags `exigir_foto_assinatura`, `exigir_gps_assinatura`, `exigir_codigo_email_assinatura` e `restringir_smartphone` são lidas via [`lerFlagsAssinatura`](src/lib/server/assinatura/cfg-ass-cache.ts) — wrapper sobre `caches.default` (Cache API edge do Cloudflare) com TTL de 5 min.

- Em **miss**, consulta o D1 e popula o cache.
- Quando o admin altera uma flag em [`PUT /api/configuracoes/assinatura`](src/routes/api/configuracoes/assinatura/+server.ts), o handler chama `invalidarFlagsAssinatura()` para zerar o cache em todos os PoPs.
- Não há nada a configurar no Cloudflare — o `caches.default` é nativo do runtime e **não exige binding**.

> **Por que não cookie?** Antes essas flags eram cacheadas em um cookie do cliente (`cfg_ass`). Como o cookie não era assinado, um usuário podia editá-lo no devtools e desligar exigências de selfie/GPS/código antes de chamar os endpoints de assinatura. A migração para Cache API server-side fechou esse vetor.

## Trust Store ICP-Brasil (assinatura qualificada)

A verificação da cadeia ICP-Brasil em [`pdf-verification.ts`](src/lib/server/assinatura/pdf-verification.ts) depende dos arquivos [`src/lib/server/assinatura/icp-brasil/roots.pem`](src/lib/server/assinatura/icp-brasil/roots.pem) e [`intermediates.pem`](src/lib/server/assinatura/icp-brasil/intermediates.pem). Estes nascem vazios no repo — **antes do primeiro deploy em produção**, popule-os:

```sh
cd src/lib/server/assinatura/icp-brasil
./update-trust-store.sh   # baixa raízes da ITI + ZIP das ACs credenciadas
git diff roots.pem intermediates.pem   # confira o que mudou
git add roots.pem intermediates.pem
git commit -m "chore(icp-brasil): popula trust store ($(date +%F))"
```

Há também um GitHub Action mensal ([`update-icp-brasil-trust-store.yml`](.github/workflows/update-icp-brasil-trust-store.yml)) que abre PR automaticamente quando a ITI publica mudanças.

**Após popular, ative a checagem estrita em produção:**

```
ICP_BRASIL_TRUST_STORE_REQUIRED=1
```

Sem essa env (default), o sistema apenas loga warning e aceita assinaturas mesmo com trust store vazio — útil em dev/staging, **perigoso em produção** (sem cadeia validada, qualquer cert auto-assinado passaria como "qualificada ICP-Brasil").

## Carimbo de tempo qualificado (TSA RFC 3161)

O fluxo de assinatura qualificada pode receber `TimeStampToken` por dois caminhos:

1. **Do cliente:** Web PKI / Assinador SERPRO v4+ podem embarcar TST direto no CMS. Quando presente, é validado e adotado como `act_icp`.

2. **Server-side:** quando o cliente não embarca, [`cades-finalizer.ts`](src/lib/server/assinatura/cades-finalizer.ts) consulta a TSA configurada via env e **reescreve o CMS** anexando o TST como `UnsignedAttribute` do `SignerInfo` (promove CAdES-BES → CAdES-T).

Configuração:

```
TSA_URL=https://act.exemplo.com.br/tsa     # endpoint RFC 3161 da ACT
TSA_USERNAME=...                           # se a ACT exigir basic auth
TSA_PASSWORD=...
EXIGIR_TSA_QUALIFICADA=1                   # produção: recusa assinatura sem TST
```

Provedores credenciados ICP-Brasil: Bry, Soluti, Certisign, AC Safeweb, ICP-EDU. Provedores públicos (não-ICP) como `timestamp.digicert.com` funcionam mas têm valor probatório menor.

> **Aviso:** sem `EXIGIR_TSA_QUALIFICADA=1`, o sistema aceita assinaturas com apenas o `signingTime` do servidor — sem oponibilidade a terceiros conforme DOC-ICP-15.

> ⚠️ **Armadilha — não ligue `EXIGIR_TSA_QUALIFICADA=1` sem trocar a `TSA_URL`.** O default embarcado em `wrangler.toml` é a DigiCert (`timestamp.digicert.com`), que **não é ACT ICP-Brasil** → o carimbo é sempre `tsa_externa`, nunca `act_icp`. Com o flag ligado e a `TSA_URL` ainda na DigiCert, o [`cades-finalizer.ts`](src/lib/server/assinatura/cades-finalizer.ts) **rejeita 100% das assinaturas qualificadas com HTTP 422**. Ligue o flag **somente** depois de apontar `TSA_URL` para uma ACT credenciada. O `cades-finalizer` detecta essa combinação e emite `[CADES][CONFIG]` no log (configure alerta no Sentry).

## Sincronização Google Sheets

O script [`scripts/GoogleAppsScript_Sync.gs`](scripts/GoogleAppsScript_Sync.gs) faz o upsert de servidores e unidades a partir de uma planilha. Ele consome `SYNC_TOKEN` (e opcionalmente `RESET_TOKEN`) via `PropertiesService` da própria planilha — **nunca** colocados no código-fonte.

**Setup inicial:**

1. Cole o script em `Extensões → Apps Script` na planilha.
2. Recarregue a planilha — surge o menu **"🚀 Sincronização D1"**.
3. Clique em **"⚙️ Configurar tokens"** e cole `SYNC_TOKEN` (e `RESET_TOKEN` se for usar reset).

**Rotação de tokens:** atualize o secret no Cloudflare Pages e refaça o passo 3. Não há recarga necessária.

## Build e deploy

1. `npm ci`
2. `npm run build` — saída em `.svelte-kit/cloudflare`
3. Deploy Pages (exemplo do workflow): `wrangler pages deploy .svelte-kit/cloudflare --project-name=escalas`

Branches **`main`** e **`staging`** disparam o workflow [Deploy to Cloudflare Pages](.github/workflows/deploy.yml).

## CI antes do deploy

O job `test` executa, em ordem:

- Vitest (`npx vitest run`)
- `svelte-check`
- ESLint e Prettier (`format:check`)
- Playwright (`npx playwright install --with-deps chromium` + `npx playwright test`)

Falhas bloqueiam staging e produção.

**E2E local:** após clonar ou atualizar o Playwright, execute `npx playwright install` (ou `npx playwright install chromium`) para baixar o browser; sem isso, testes que usam `page` falham com “Executable doesn't exist”.

## Dependabot (atualizações automatizadas)

Configurado em `.github/dependabot.yml`. O bot do GitHub abre PRs automaticamente:

- **Semanalmente (segundas, 06:00 BRT)**: novas versões de dependências npm.
- **Mensalmente**: novas versões de actions do GitHub Actions.
- **Imediatamente**: qualquer vulnerabilidade publicada que afete uma dependência atual (CVE / GitHub Advisory).

PRs do bot:

- Aparecem com label `dependencies` (+ `security` se for fix de CVE, `npm` ou `github-actions`).
- Passam pelo CI normal — só mergeie depois que o job `test` ficar verde.
- Vêm agrupadas por ecossistema (ex.: todas as `@sveltejs/*` numa PR só, `@types/*` em outra) para reduzir ruído.

### Quando NÃO mergeiar direto

O `dependabot.yml` ignora **upgrades major** de algumas dependências críticas:

| Dependência  | Por quê                                                        |
| ------------ | -------------------------------------------------------------- |
| `node-forge` | Mudança pode alterar validação de cadeia ICP-Brasil            |
| `pdf-lib`    | Caminho da assinatura digital — pode quebrar PDFs já assinados |
| `@signpdf/*` | Idem — placeholder/embed pode mudar formato                    |

Para esses, qualquer upgrade major precisa ser feito manualmente após testar o fluxo de assinatura ponta-a-ponta em staging.

### Boas práticas

1. Para alertas de **vulnerabilidade**, mergeie em até 7 dias (24h se severidade `critical`).
2. Para upgrades rotineiros, agrupe a revisão em uma única sessão semanal — evita PRs antigas quebrando contra mudanças recentes.
3. Se uma PR do bot quebrar testes que **não são** da dependência atualizada, é sinal de teste frágil; abra issue separada antes de fechar a PR.

## Checklist rápido de release

1. Migrações D1 aplicadas no ambiente alvo.
2. Variáveis e secrets conferidos no dashboard Cloudflare (lista completa em [`.env.example`](.env.example)):
   - `PASSWORD_PEPPER` definido **e guardado em cofre** (nunca rotacionar — ver [aviso](#hashing-de-senha-e-o-password_pepper)).
   - **E-mail funcionando**: binding `EMAIL` **ou** `RESEND_API_KEY` (sem ele, 2FA e primeiro acesso travam).
   - `SYNC_TOKEN` definido.
   - `RESET_TOKEN` definido **e diferente do SYNC_TOKEN** (ou intencionalmente vazio para desabilitar reset).
   - `RATE_LIMIT_IP_SALT` e (se aplicável) `ICP_BRASIL_TRUST_STORE_REQUIRED`, `TSA_*`.
3. **Login real validado** (não só o bootstrap): logar → logout → logar de novo, confirmando a migração para `pbkdf2v3`.
4. Smoke manual: rota protegida, `/api/health`, fluxo crítico de negócio (ex.: validação pública se aplicável).
5. Conferir que o admin consegue alterar flags em `/api/configuracoes/assinatura` e que a próxima assinatura reflete a mudança em ≤ 5 min (TTL do cache edge).
6. Monitorar logs no dashboard Pages e alertas no Sentry, se configurado.

## Versão

O campo `version` em [`package.json`](package.json) é informativo; para releases formais, manter changelog ou tags Git alinhados ao processo interno da equipe.
