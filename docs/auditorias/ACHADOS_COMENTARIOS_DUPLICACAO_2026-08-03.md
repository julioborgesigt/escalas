# Achados — comentários, duplicação e compreensibilidade (03/ago/2026)

**Status:** diagnóstico concluído para o escopo abaixo, e **todos os bugs ativos da seção 1
corrigidos** (ver §9), assim como os achados de duplicação 3.23/3.24 (§8) e as correções de
comentário/docstring (§2 e §4, commit `d533633`). Seguem abertas as duplicações restantes da
seção 3 — dívida de manutenção, sem bug conhecido.
**Executor:** 6 auditorias paralelas (agentes) + verificações diretas do orquestrador.
**Referência de método e taxonomia:** [`PLANO_REVISAO_COMPREENSIBILIDADE_2026-08-02.md`](./PLANO_REVISAO_COMPREENSIBILIDADE_2026-08-02.md) (lotes 1, 2, 3, 7 — parcialmente combinados/reorganizados por domínio nesta execução) e [`PLANO_AUDITORIA_FLUXOS_INTEGRIDADE_2026-08-02.md`](./PLANO_AUDITORIA_FLUXOS_INTEGRIDADE_2026-08-02.md) (achados FLW-\* citados por referência, não reinvestigados).

## Escopo revisado

Todo `src/lib/server/**` e `src/lib/db/**`, mais `src/lib/*.ts` (raiz), `src/lib/utils/**` e `src/lib/crypto/**` — ~130 arquivos de código-fonte lidos por inteiro, com os testes adjacentes em `__tests__/` usados como evidência. `src/routes/**` (UI e servidor) e o restante de `src/lib/components|composables|gise|schemas` **ficaram fora desta rodada** — é o próximo domínio natural, priorizado por essa mesma ordem de risco.

Ferramenta de apoio: `fallow dupes` (modo `semantic`, `min-occurrences=2`, entrada ampliada para todo `src/`) como SINAL de investigação, nunca como prova — todo achado de duplicação abaixo foi confirmado por leitura direta do código, não só pela contagem do detector.

## Como ler a tabela

`Tipo`: DOC-ERR (comentário contradiz o código) · DOC-OBS (obsoleto) · DOC-INC (incompleto) · DOC-RUIDO (redundante) · DUP-EXTRAIR (unificar) · DUP-MANTER (parecido, manter separado) · COESAO (lugar errado) · RISCO (afeta segurança/jurídico/dados).
`Sev`: P0 (autorização/segredo/documento jurídico/perda de dados) · P1 (regra de negócio errada) · P2 (duplicação/manutenção sem impacto ativo conhecido) · P3 (estilo).

---

## 1. Bugs ativos encontrados por leitura (não são só comentário errado)

Estes quatro nasceram da comparação comentário↔código↔teste, mas são falhas de **comportamento real**, não só de documentação. Tratamos como P0 pelo critério do próprio plano (perda de dados / segurança de documento), ainda que os agentes tenham registrado P1 por conservadorismo.

### 1.1 — Limpeza de retenção LGPD apaga dado antes do prazo configurado, todo ciclo

**`src/lib/db/lgpd-retencao.ts:70-72,133-170`** — RISCO/P0

`cutoffISO()` devolve `"...T...Z"` (`toISOString()`), mas 5 das 8 tabelas purgadas (`login_attempts`, `recovery_attempts`, `webhook_nonces`, `audit_log`, `app_log`) gravam timestamp no formato do SQLite (`"YYYY-MM-DD HH:MM:SS"`, sem `T`/`Z`) — confirmado em `schema.ts:711-717,760-762,776-782,835-837,870-872`. Como a comparação em SQLite é lexicográfica em TEXT e `' '` (0x20) < `'T'` (0x54), toda linha do mesmo dia-calendário do corte é tratada como "mais antiga" **independente da hora** — apagando dado até ~24h antes do prazo configurado, em todo ciclo de limpeza.

O próprio arquivo já resolve esse exato problema em `avaliarSaudeLimpeza:199-202` (normaliza `' '→'T'+'Z'`, com teste dedicado), mas a correção nunca foi replicada em `cutoffISO`. `lgpd-retencao.test.ts` não cobre a comparação de purga.

**Ação:** fazer `cutoffISO()` gerar o mesmo formato usado para gravar (ou padronizar as 5 tabelas para ISO-T); teste de regressão comparando corte vs. formato real de cada tabela.

### 1.2 — Comentário morto convida a reintroduzir vulnerabilidade de shadow-attack em PDF assinado

**`src/lib/server/assinatura/pdf-verification.ts:215-221`** — RISCO/P0

Docstring órfã afirma que `extrairCmsDoPdf` "mantém comportamento legado (apenas a última [assinatura])". O código real — com docstring correta e atual em `241-251` — escolhe deliberadamente a assinatura de **maior cobertura de `/ByteRange`**, justamente para bloquear o ataque de anexar um CMS forjado ao final do arquivo. Um leitor que só veja o comentário antigo pode "corrigir" o código na direção que reabre o ataque.

**Ação:** apagar o bloco 215-221 imediatamente (é remoção pura de texto morto, sem risco).

### 1.3 — Reassinatura de relatório GISE pode reter metadado de certificado antigo

**`src/lib/db/gise/assinaturas.ts:90-162`** (`salvarAssinaturaRelatorioGise`) — RISCO/P1

Os campos opcionais (metadados CAdES, rubrica, `r2_key`, `verification_hash`, geolocalização) passam por `...resto` sem normalizar `undefined→null`; `drizzle-orm`'s `mapUpdateSet` filtra chaves `undefined` do `.set()`, então a coluna antiga sobrevive. As funções irmãs (`documentos.ts:68-75`, `assinaturas.ts:214-221`) fazem `meta.X ?? null` corretamente — só esta diverge. Efeito real: reassinar um relatório de `webpki`/`serpro` (com certificado) para `simples` (ex.: certificado vencido) — fluxo existente em `routes/api/gise/[id]/relatorios/[seccionalId]/assinar/+server.ts:302` — deixa metadado de certificado ANTIGO associado a uma assinatura que hoje diz não ter certificado.

**Ação:** normalizar como as duas funções irmãs; teste de downgrade de resignatura (o teste atual só cobre payloads com os campos CAdES presentes).

### 1.4 — DOCX/XLSX de plantão mostram o nome errado no rótulo "DELEGACIA:"

**`src/lib/server/export/pdf.ts:659` vs `docx.ts:329` vs `xlsx.ts:227`** — DOC-ERR/DUP-EXTRAIR/P1

No formato PLANTÃO, o PDF usa `escala.lotacao` para "DELEGACIA:", mas DOCX e XLSX usam `escala.cidade` — colunas distintas no schema, e o próprio código trata `cidade !== lotacao` como fato normal em outro ponto (`pdf.ts:396`). Para EXPEDIENTE e FDS os três formatos usam `lotacao` de forma consistente; só o PLANTÃO diverge. Contradiz a promessa explícita do cabeçalho de `xlsx.ts:4-7`/`docx.ts:4-7` ("garantindo que planilha, DOCX e PDF descrevam a mesma escala"). **Não há golden test para DOCX/XLSX** (só `pdf-goldens.test.ts` cobre o PDF), então nada detectaria isso hoje.

**Ação:** confirmar com o operador qual campo é o correto para "DELEGACIA:" no PLANTÃO e alinhar os três geradores; considerar golden para DOCX/XLSX.

---

## 2. Comentário que contradiz comportamento (DOC-ERR / DOC-OBS de alto risco)

| # | Local | Sev | Comentário diz / código faz |
|---|---|---|---|
| 2.1 | `src/lib/auth.ts:12-14,176-182,242-243` | P1 | Diz "UPDATE só sai quando falta menos de 30min pro vencimento"; o código dispara quando faz **mais de 30min desde a última renovação** — o oposto. Sem teste cobrindo `buscarSessaoValida`. |
| 2.2 | `src/lib/auth.ts:536-546` + `redefinir-senha/+page.server.ts:131-132` | P1 | JSDoc/caller dizem "anti-race condition"; `marcarTokenRedefinicaoUsado` é `UPDATE` incondicional (sem `WHERE usado=0`), duas requisições concorrentes passam ambas pela verificação — mesma causa-raiz do achado já confirmado **FLW-AUTH-004**. |
| 2.3 | `src/lib/server/auth/auth-flow.ts:459-465` vs `:378-382` | P1 | Duas cópias da lógica de alerta "login via bootstrap": no bloco `ADMIN_GERAL` o alerta dispara **antes** de validar a senha (falso positivo em toda tentativa com senha errada); no bloco `SUPER_ADMIN` dispara **depois**. Divergiu entre as cópias. |
| 2.4 | `src/lib/server/escalas/permissao.ts:5-16` | P1 | JSDoc de `verificarPermissaoEscala` lista 4 regras e omite a real: admin seccional/unidade cujo escopo cobre a lotação tem acesso DIRETO, sem checar solicitação/cargo — regra confirmada pelo próprio teste (`permissao.test.ts:67-84`), nunca refletida no comentário da função. |
| 2.5 | `src/lib/db/unidades.ts:1-15` (cabeçalho) | P1 | Descreve uma função `excluirUnidade` que **não existe mais** — foi substituída por soft-delete (`definirUnidadeAtiva`) num pivô de segurança (commit `9ac285b`), cujo próprio comentário 200 linhas abaixo já está correto. Cabeçalho nunca foi atualizado. |
| 2.6 | `src/lib/server/export/pdf.ts` (cabeçalho institucional, 4 ocorrências) | P1 | Nome da corporação/delegacia geral/departamento grafado de 3 formas diferentes dentro do MESMO arquivo (ex.: "POLÍCIA CIVIL DO CEARÁ" vs "...DO ESTADO DO CEARÁ"), contrariando a própria convenção que o cabeçalho do arquivo declara. Mesma divergência em `docx.ts:256-269`. Confirmar grafia oficial com o operador. |
| 2.7 | `src/lib/server/sync-estado.ts` (localização, não conteúdo) | COESAO/P1 | Arquivo mora na raiz de `server/` mas serve só 2 consumidores (não é infra transversal), com nomes já domínio-prefixados (`carimboGise*` vs `resumoEscalas*`/`carimboPainel`), e foi criado em 02/ago/2026 — um dia depois da limpeza que o próprio `CLAUDE.md` descreve ter corrigido exatamente esse padrão. Sem guard de CI para a pureza da raiz de `server/`. **Ação:** dividir em `server/escalas/sync-estado.ts` e `server/gise/sync-estado.ts`. |

## 3. Duplicação confirmada por leitura (DUP-EXTRAIR)

Agrupado por risco de drift — primitivas de segurança e lógica de estado primeiro.

| # | Local | Sev | O que está copiado |
|---|---|---|---|
| 3.1 | `src/lib/auth.ts` (×3 sites) + `password-hash.ts:92-98` | P2 | Comparação timing-safe de segredo/hash reimplementada 4×, cada uma com padding próprio. |
| 3.2 | `src/lib/crypto/cpf-cripto.ts` vs `field-cripto.ts` | P2 | Envelope AES-256-GCM idêntico linha a linha; o cabeçalho de `field-cripto.ts` já **reconhece em prosa** a duplicação em vez de extrair. |
| 3.3 | `src/lib/auth.ts`×3, `auth-flow.ts`, `recovery-rate-limit.ts`, `session-cache.ts` | P2/P3 | "SHA-256(texto)→hex" reimplementado inline 5×, apesar de `crypto/hex.ts` existir para centralizar exatamente esse idioma. |
| 3.4 | `src/lib/auth.ts:136-140` vs `server/auth/csrf.ts:14-18` | P2 | `gerarToken()`/`generateCsrfToken()` idênticas byte a byte. |
| 3.5 | `src/lib/server/assinatura/pdf-signing-prepare.ts` (4 sites) | **P1** | Localizar+validar+escrever o placeholder `/Contents` do PDF copiado 4×; já divergiu (mensagens de erro reportam tamanho em unidades diferentes). Qualquer correção exige golden de PDF. |
| 3.6 | `src/lib/db/gise/membros.ts:132-195` vs `:231-294` | P2 | `verificarConflitoHorarioPolicial`/`PorGise` repetem ~70 linhas quase idênticas de checagem de conflito de horário. |
| 3.7 | `src/lib/db/gise/escalas-status.ts` (3 sites) | P2 | Mesma agregação de "todos entraram/saíram" repetida 3×, variando só a coluna — é a máquina de estados da GISE, ponto de maior custo se uma cópia divergir. |
| 3.8 | `src/lib/server/escalas/conflict.ts:18-21` vs `$lib/gise/horarios.ts` | **RISCO/P2** | `conflict.ts` já importa `seOverlapam` de `horarios.ts`, mas define uma função LOCAL `normalizarHora` de mesmo nome e semântica diferente, em vez de importar a irmã do mesmo módulo — colisão de nome perigosa. |
| 3.9 | `src/lib/db/policiais.ts:262-280` vs `:329-347` | P2 | `criarPolicial`/`upsertPolicial` remontam os mesmos 17 campos; já diverge (`||` vs `??` no mesmo default). |
| 3.10 | `src/lib/db/audit.ts:489-491`, `:860`, `app-logs.ts:124` | P2 | Formatação de timestamp SQLite (`toISOString().slice(0,19).replace('T',' ')`) reimplementada 3× — é exatamente a peça que falta no achado 1.1. |
| 3.11 | `src/lib/db/{app-logs,audit,escalas,policiais}.ts` | P2 | Epílogo de paginação (`total`, `totalPages`, strip da coluna `total`) repetido em 4 listagens. |
| 3.12 | `src/lib/server/export/pdf.ts` (QR code, 4 sites) | P2 | Loop de desenho de QR code copiado 4× entre `pdf-signing-prepare.ts`/`pdf-signing-visual.ts` (~100 linhas). Cosmético, coberto por golden. |
| 3.13 | `src/lib/server/assinatura/{cms-tst,crypto-verify,pdf-verification,ocsp,tsa}.ts` | P2 | Conversão binary-string↔bytes reimplementada em ≥5 arquivos; `$lib/crypto/bin.ts` já existe e só é usado por 1 deles. |
| 3.14 | `cades-finalizer.ts:334-364` ↔ `server-seal.ts:174-200` | P2 | Fluxo "TSA → embutir → marcar tipo → logar falha" duplicado entre assinatura qualificada e selo institucional. |
| 3.15 | `src/lib/server/export/pdf.ts` (logo, rubrica, bloco de supervisão) | P2 | 3 helpers já extraídos (`embutirLogosGise`, `desenharRubricaSobreLinha`, `pushSlot` do relatório extra) não são reaproveitados em `gerarPdfExpediente`/`gerarPdfGise` — cada um tem cópia inline divergente (ex.: tamanho de logo diferente, sem explicação). |
| 3.16 | `src/lib/server/export/pdf.ts` + `gise/{termo-presenca,assessor-notificacao-text}.ts` | P2 | `toLocaleString('pt-BR', {timeZone:'America/Sao_Paulo'})` reimplementado inline 5×, sem passar pelos helpers de `$lib/utils/datas`. |
| 3.17 | `src/lib/server/email.ts` (5 blocos HTML) | P2 | 3 remetentes de "código" + 2 de "link" repetem HTML quase idêntico; já divergiu (1 dos 3 não tem o rótulo "Código de Verificação"). Exige golden de e-mail antes/depois de extrair. |
| 3.18 | `src/lib/db/gise/assinaturas.ts:111-119,186-193` | P2 | Tipo `AssinaturaCadesMetadata` (8 campos) redeclarado inline 2×; já existe em `$lib/db/documentos.ts` e é usado corretamente por `gise/documentos.ts`. |
| 3.19 | `routes/policiais/[id]/+page.server.ts:71-74` (achado direto do orquestrador) | P2 | `hojeBrasilISO()` local reimplementa `getNowBR()` de `$lib/utils/datas.ts` (mesma fórmula, sem importar) — fora do escopo desta rodada (é rota), registrado aqui para não se perder. |
| 3.20 | `src/lib/db/escalas.ts:262-275`, `lgpd-solicitacoes.ts:35-39` | P3 | Reimplementações menores de aritmética de data que já têm helper em `$lib/utils/datas` (`getNowBR`, `adicionarDias`). Sem bug hoje (Workers roda em UTC), frágil se o runtime mudar. |
| 3.21 | `src/lib/server/assinatura/pdf-signing-visual.ts:787-793` (`formatarDataBR`) | P2/P3 | Reimplementa o deslocamento de fuso de `getNowBR()` para uma data arbitrária; só 2 ocorrências no repo (abaixo do limiar de "disseminado"). **Colide de nome** com uma SEGUNDA função `formatarDataBR` em `gise/termo-presenca.ts:42`, de contrato totalmente diferente. DUP-MANTER quanto à lógica, mas o nome duplicado deveria mudar. |
| 3.22 | `src/lib/rotacao.ts:111-147`, `export-charts.ts:197-261` | P3 | Loops/esqueletos parecidos, baixo risco. |
| 3.23 | ~~`src/routes/api/sync/estado/+server.ts:100-131` vs `escalas/+page.server.ts:~95-105,~402-409`~~ | **P1** | **CORRIGIDO** (ver §8). Escopo de lotações de admin seccional/unidade reimplementado pela 3ª vez no arquivo novo de sync entre abas. Extraído para `lotacoesDaSeccional()` em `policial-permissao.ts`. |
| 3.24 | ~~`escalas/[id]/+page.svelte`, `FormAdicionarServidores.svelte`, `ListaFds.svelte`, `ModalEditarDias.svelte`, `ModalEditarPlantao.svelte`, `plantao-datas.ts`, `useEdicaoInlineServidor.svelte.ts`, `perfil/+page.svelte`, `solicitacoes/+page.svelte`~~ | P2 | **CORRIGIDO** (ver §8). Ramo de erro de `use:enhance` copiado em 11 handlers. Extraído para `mostrarErroDeResultado()` em `enhance-handler.ts`. |

## 4. Outros achados de documentação (DOC-INC / DOC-OBS / COESAO menores)

- `src/lib/serpro.ts:44-45` — JSDoc implica preenchimento condicional de `certificateBase64`; o código sempre devolve `undefined` neste provedor (P2).
- `src/lib/logger.ts:3` — diz que `server/logger.ts` "reexporta a mesma API"; na prática ele ENVOLVE com contexto de request e persistência (P3).
- `src/lib/rotacao.ts:33,175` — comentário ainda cita `$lib/utils` genérico (barrel que não existe mais); o import real já está correto (P3).
- `src/lib/db/gise/escalas-crud.ts:10-12` — cabeçalho afirma "só existe uma GISE não finalizada por vez" sem qualificar que isso não é protegido por constraint (achado já confirmado, FLW-GISE-010) nem que `buscarGiseAtiva` oculta as demais silenciosamente quando a premissa é violada (P2).
- `src/lib/db/gise/escalas-detalhado.ts:468-493` — `try/catch` com log de "possível migração pendente" para uma tabela que está na baseline há 39 migrações; falha real hoje é engolida silenciosamente (P2).
- `src/lib/db/gise/base-equipe.ts` — único arquivo do domínio GISE sem cabeçalho de módulo (P2).
- `src/lib/server/document-utils.ts:39-47,164-166` e `pdf-verification.ts:90-93` — docstrings órfãs deslocadas para a função errada por edições sucessivas (P2/P3).
- `src/lib/server/schema.ts:366` — referência a "migração 0054" que não existe (só há 0000-0039) (P3).
- Dois testes de GISE (`slot-remocao-equipes.test.ts`, `produtividade-lista-reutilizavel.test.ts`) moram em `db/__tests__/` em vez de `db/gise/__tests__/`, quebrando a convenção do projeto (P3).

## 5. Verificações cruzadas que deram resultado limpo

Vale registrar o que **não** precisa de ação — reduz retrabalho de quem continuar esta auditoria:

- **"Admin Geral" vs "Super Admin"**: gates centrais (`isAdminGeral`, `requireAdmin`, `requireSuperAdmin`, `verificarPermissaoEscala`, `verificarPermissaoGise`, `lotacoesAdministradas`) consistentes com seus comentários — o bug histórico documentado no `CLAUDE.md` não está reproduzido.
- **`message.includes('UNIQUE')`**: limpo — toda checagem passa por `ehViolacaoUnique()` centralizado em `db-errors.ts`.
- **Helpers de data/fuso em `$lib/utils/datas.ts`**: os 5 principais (`adicionarDias`, `intervaloDeDatas`, `hojeLocalISO`, `isoData`, `getNowBR`) têm comentário correto e documentam o próprio bug histórico que motivou a implementação atual.
- **`presencas.ts:26-30`** ("NÃO usar `getNowBR().toISOString()` aqui"): comentário confirmado correto.
- **Vaga/capacidade de equipe GISE**: implementação única (`verificarSlotEquipe`), sem duplicação.
- Todo o domínio de assinatura (`icp-policy.ts`, `signature-level.ts`, `selfie-upload.ts`, `copia-conferencia.ts`, `conferencia-pdf.ts`, `signature-service.ts`, `pades-lt.ts`, `tsa.ts`, `cms-tst.ts`, `ocsp.ts`, `crypto-verify.ts`) e a maior parte de `lib/` raiz (34 arquivos) foram lidos por inteiro sem achado de DOC-ERR.

## 6. Recomendação de sequência

1. **1.1 e 1.2** (retenção LGPD e comentário morto de shadow-attack) — corrigir primeiro; são bugs ativos, não achados de estilo. 1.2 é remoção de texto morto, zero risco. 1.1 precisa de teste de regressão antes do fix.
2. **1.3 e 1.4** — bugs de dado real, mas exigem decisão do operador (1.4: qual campo é o correto para "DELEGACIA:") ou teste de regressão específico (1.3) antes de mexer.
3. **Seção 2** (comentários que contradizem código em áreas de autorização/sessão) — corrigir o texto é baixo risco; os itens 2.3 e 2.4 têm componente de comportamento (auth-flow.ts, permissao.ts) que merece teste antes de tocar.
4. **3.5, 3.6, 3.7, 3.8** — duplicações em código que decide estado/segurança; extrair com teste antes/depois, não mecanicamente.
5. Resto da seção 3 e seção 4 — dívida de manutenção, sem urgência; boa forma de ocupar um lote de limpeza dedicado.

## 7. Verificação pós-hoc — a mesclagem `staging` → `main` de 03/ago regrediu alguma deduplicação?

Investigação disparada por dúvida do dono do projeto: a `staging` estava desatualizada, foi
atualizada a partir da `main` por um agente (Cursor) e depois mesclada de volta (PR #497,
commit `9fd04d3`, 03/ago 13:46 -03). Risco temido: a atualização ter revertido trabalho de
remoção de duplicação feito antes.

### Método

1. `git merge-base --is-ancestor` para checar se `staging` ficou totalmente contida em `main`
   (nenhum commit perdido) e se o commit da varredura de duplicação de julho (`4fafd05`,
   28/jul — acessível via `docs/HISTORICO.md`) é ancestral do estado atual.
2. Comparação de `fallow dupes` (config versionada, sem alteração) entre o último ponto de
   convergência claro entre as branches antes desta leva (`724b564`, 01/ago) e a `main` atual,
   via `git worktree`, para achar grupos de duplicação que apareceram ou sumiram no intervalo.
3. Leitura direta do código de cada grupo novo/alterado para separar ruído de fingerprint
   (reformatação) de duplicação real.

### Resultado — nenhum histórico foi perdido

`origin/staging` (`c76d193`) é ancestral estrito de `origin/main`: todo commit que já existiu em
`staging` está preservado em `main`, sem indício de reset/force-push destrutivo. `4fafd05`
(bloqueio de exclusão de unidade com vínculo, acabou substituído por algo ainda mais
conservador — ver achado 2.5 acima) é ancestral de `724b564`, ou seja, já estava consolidado
**antes** desta leva de mudanças e não dependeu dela para sobreviver. As verificações cruzadas
da seção 5 (Admin Geral × Super Admin, `UNIQUE`, helpers de data) foram todas rodadas contra o
estado **pós-merge** — continuam limpas.

### Resultado — duplicação NÃO diminuiu líquida no período, e dois pontos pioraram

`fallow dupes` (config padrão) foi de 55 para 53 grupos no período — estável, não uma regressão
ampla. Só que o número líquido esconde: **11 instâncias de duplicação genuína foram eliminadas**
(consolidação de badge/estado vazio em `TabelaEscalas`/`painel`/`policiais`/`recebidos`/
`unidades`, em `GiseEquipeCard`/`GiseSeccional`, e em `ListaFds`/`TabelaServidores` — não
investigado a fundo, mas os arquivos batem com a auditoria visual `928333a` e a limpeza do
ModalShell `7832e14`), **mas dois padrões cresceram** no mesmo intervalo:

- **Handler de toast em `use:enhance` do domínio de escalas** (`escalas/[id]/+page.svelte`,
  `FormAdicionarServidores.svelte`, `ModalEditarDias.svelte`, `ModalEditarPlantao.svelte`,
  `plantao-datas.ts`, `useEdicaoInlineServidor.svelte.ts`, `perfil/+page.svelte`,
  `solicitacoes/+page.svelte`): já eram 3 cópias antes, viraram 9 depois. `$lib/enhance-handler.ts`
  já existe e seu próprio cabeçalho diz ter sido criado para "evitar repetir ~30 vezes a mesma
  boilerplate" — mas só é usado no domínio GISE; o código novo/tocado no domínio de escalas
  neste período seguiu copiando o padrão manualmente em vez de usar a fábrica já disponível.
  DUP-EXTRAIR, P2.
- **Escopo de lotações administradas por admin seccional/unidade**
  (`or(eq(unidades.id, u.papel_unidade_id), eq(unidades.seccional_id, u.papel_unidade_id))`):
  já existiam 2 cópias inline em `src/routes/escalas/+page.server.ts` (linhas ~95-105 e
  ~402-409) desde antes de 01/ago, ao lado do helper centralizado já existente
  `lotacoesAdministradas()` (`$lib/server/policial-permissao.ts`). O arquivo **novo** desta leva,
  `src/routes/api/sync/estado/+server.ts:100-131` (parte da feature de sincronização entre abas,
  commits `83e37b0`…`c4aace9`, 02/ago), reimplementou a MESMA query pela terceira vez em vez de
  importar o helper. Nenhuma das três cópias diverge hoje, mas é exatamente a forma dos bugs
  já catalogados no `CLAUDE.md` — regra de escopo administrativo reimplementada em vez de
  centralizada. DUP-EXTRAIR, **P1** (é regra de autorização, não só estilo).
- Duplicação de grade de calendário entre `CalendarioSelecaoDias.svelte`, `ModalNovaEscala.svelte`,
  `ModalDatasHoras.svelte` (GISE) e `ModalCriarGise.svelte` (4 instâncias) permanece igual —
  não é nova nem foi corrigida neste intervalo, só teve o fingerprint alterado por reformatação
  (Prettier, commit `2698720`).

### Conclusão

Não há evidência de que a mesclagem em si tenha revertido ou perdido correções anteriores — a
varredura de julho está intacta e os padrões históricos do `CLAUDE.md` continuam corrigidos. O
risco real é outro: **código novo escrito durante essas duas atualizações de staging (parte via
Cursor, parte via outras branches `claude/*` mescladas na staging) não reaproveitou abstrações
que já existiam** (`enhance-handler.ts`, `lotacoesAdministradas()`), repetindo manualmente
uma lógica de autorização — o padrão exato que o histórico do projeto já registrou como causa de
bug. Recomenda-se tratar os dois itens acima (achados 3.23 e 3.24, adicionados à seção 3) no
próximo lote de limpeza, priorizando o de escopo administrativo por ser P1.

## 8. Correção aplicada — achados 3.23 e 3.24

Os dois achados que a §7 levantou (código novo que não reaproveitou abstração
existente) foram corrigidos. Ambos são extrações **sem mudança de comportamento**, e
cada uma ganhou o teste que faltava antes de a lógica ser movida.

### 3.23 — `lotacoesDaSeccional()` (P1, regra de autorização)

A query "a unidade `X` mais as unidades subordinadas a ela" estava escrita quatro
vezes: dentro de `lotacoesAdministradas()` e em três call sites. Foi extraída para
`lotacoesDaSeccional(db, seccionalId): Promise<string[]>` em
`$lib/server/policial-permissao.ts`, e agora os quatro pontos a usam — inclusive
`lotacoesAdministradas`, que passou a ser uma casca fina sobre ela.

Por que um helper NOVO em vez de simplesmente chamar `lotacoesAdministradas` nos três
call sites: eles divergem no tratamento dos OUTROS papéis, e a diferença é
intencional. A listagem de escalas converte `admin_unidade` num filtro de lotação
única (`lotacaoParam`), não numa lista; o poll de `/api/sync/estado` não passa lista
nenhuma para `admin_unidade`, porque `resumoEscalasPendentes` escopa esse papel pela
`lotacao` do usuário. Forçar o helper de alto nível nos três criaria acoplamento
invisível a esse detalhe. O que era genuinamente idêntico — e só isso — virou fonte
única.

**Teste novo:** `src/lib/server/__tests__/policial-permissao.test.ts` (8 casos, SQLite
real com as 42 migrações). Cobre lacuna real: `lotacoesAdministradas` é consumida por
7 pontos de autorização e até agora só tinha cobertura **indireta, com ela mockada** —
nada verificava a query de expansão em si. O teste fixa também a distinção
`null` (Admin Geral, sem restrição) × `Set` vazio (não administra nada), que é o que
inverte o gate se alguém trocar um pelo outro.

### 3.24 — `mostrarErroDeResultado()` (P2)

O ramo de erro dos handlers de form action estava copiado, caractere por caractere, em
**11** lugares (escalas, perfil, solicitações), variando só a mensagem de fallback.
Extraído para `mostrarErroDeResultado(result, fallback)` em `$lib/enhance-handler.ts`.

Só o ramo de ERRO foi extraído, de propósito. O `makeEnhanceHandler` que já existia no
mesmo módulo não serve a estes call sites: ele embute invalidação e um roteiro de
sucesso fixo, enquanto cada handler de escalas faz uma atualização otimista própria
(aplicar a lista devolvida, limpar seleção, fechar modal). Forçá-los na fábrica exigiria
a "interface artificial" que o `CLAUDE.md` manda evitar — e, de quebra, `makeEnhanceHandler`
não distingue falha de rede de recusa do servidor, então a unificação cega teria
apagado a mensagem "Erro de conexão. Tente novamente." nos 11 pontos.

**Teste novo:** `src/lib/__tests__/enhance-handler.test.ts` (5 casos), fixando
justamente essa distinção entre `error` (rede → convite a repetir) e `failure`
(recusa → mensagem do servidor, com fallback).

### Verificação

`npm run lint`, `npm run check`, `npx prettier --check src/` e `npm run knip` limpos;
`npm run test` 746/746 verde (13 testes novos). `fallow dupes` com a config versionada:
**158 → 135 instâncias** de duplicação, com os dois grupos atacados desaparecendo por
completo do relatório.

## 9. Correção aplicada — bugs ativos da seção 1 (+ 2.3)

Todos com teste de regressão escrito ANTES da correção, e confirmado falhando contra o código
antigo — nenhum foi "corrigido no escuro". Nenhum golden de PDF ou e-mail foi regravado.

### 1.1 — retenção LGPD apagava até 24h a mais (P0)

`cutoffISO()` era usado para as oito tabelas, mas cinco delas (`login_attempts`,
`recovery_attempts`, `webhook_nonces`, `audit_log`, `app_log`) guardam data no formato
`datetime('now')` do SQLite (`"2026-07-02 12:00:00"`), não em ISO. Como a comparação de TEXT
em SQLite é lexicográfica e `' '` (0x20) vem antes de `'T'` (0x54), **toda linha do dia do
corte era tratada como anterior a ele, qualquer que fosse a hora**.

Agora há dois cortes explícitos, `cutoffISO` e `cutoffSqlite`, com a lista de quais tabelas
usam qual documentada no próprio ponto. A formatação virou `timestampSqlite()` em
`$lib/db/core.ts` — **fonte única**, que também absorveu as três reimplementações do achado
3.10 (`audit.ts` ×2, `app-logs.ts`). Era justamente a peça faltante: o formato existia
copiado em três lugares e em nenhum deles disponível para quem escreveu o corte.

**Teste:** `lgpd-retencao-expurgo.test.ts` (8 casos, SQLite real, tempo congelado). Cada
tabela tem um caso "no dia do corte, porém depois dele" — o único que distingue o corte certo
do errado. As três tabelas em formato ISO entram como controle, provando que não houve
regressão nelas.

### 1.3 — reassinatura mantinha metadado da assinatura anterior (P0/P1)

O drizzle omite do `.set()` toda chave `undefined`, então a coluna simplesmente não entrava no
UPDATE e o valor anterior sobrevivia. Um relatório assinado com certificado ICP-Brasil e
depois reassinado como `simples` ficava com `tipo_assinatura = 'simples'` **carregando
`cert_issuer`, `cms_sha256`, `tst_token_b64` — e a selfie e o GPS — da assinatura que ele
substituiu**: prova de uma assinatura colada no registro de outra.

O defeito estava nos **três** upserts de assinatura, não só no apontado pela auditoria:
`gise/assinaturas.ts` (campos CAdES, rubrica, hash, r2_key e PII), `gise/documentos.ts` e
`documentos.ts` (PII: selfie, IP, user-agent, GPS). Corrigir só um seria repetir o padrão que
o `CLAUDE.md` cataloga. Todos passaram a normalizar `undefined → null` explicitamente.

**Teste:** 3 casos novos em `upserts-assinatura.test.ts`. O teste que já existia ali não pegava
o bug — ele compara INSERT com UPDATE, e as duas listas vêm do mesmo objeto, então concordavam
justamente na chave que faltava nas duas.

### 1.4 — DOCX/XLSX do plantão mostravam o município no lugar da delegacia (P1)

Decisão do operador (03/ago): o rótulo deve trazer o **nome da unidade** (`lotacao`), alinhando
DOCX e XLSX ao PDF — que já estava correto e portanto **não mudou** (goldens intactos).

Em vez de corrigir os dois pontos, o rótulo virou `cabecalhoDelegacia()` em `export/shared.ts`,
que é o módulo cujo propósito declarado é garantir que os três formatos descrevam a mesma
escala. Os seis pontos (PDF, DOCX e XLSX × plantão e expediente) passam por ele. Nos dois do
PDF a troca é refactor puro — os 7 goldens continuam passando byte a byte, o que prova isso.

**Teste:** `export/__tests__/cabecalho-delegacia.test.ts`. O XLSX é gerado de verdade e relido
com `exceljs`, não inspecionado por leitura de código. A fixture usa uma unidade cujo nome
CONTÉM o município ("1ª Delegacia de Juazeiro do Norte" / "Juazeiro do Norte") — sem isso, um
teste de `toContain` passaria por engano.

### 2.3 — alerta de credencial root disparava com senha errada (P1)

No bloco `ADMIN_GERAL`, `alertarLoginBootstrap` (log + Sentry) era chamado ANTES de
`verificarSenhaBootstrap`; no bloco irmão `SUPER_ADMIN`, depois. Bastava acertar o LOGIN — nome
previsível — para disparar à vontade um alerta de segurança dizendo que a conta root tinha sido
usada. Alerta que grita sem motivo é alerta que o operador aprende a desligar.

O alerta foi movido para depois da senha conferida **e** do desvio para 2FA, espelhando
exatamente o `SUPER_ADMIN`. Isso corrige de quebra um segundo falso positivo: com
`ADMIN_GERAL_EMAIL` configurado o alerta disparava mesmo dizendo "para encerrar este caminho
sem 2FA", quando o caminho já exigia 2FA.

**Teste:** 3 casos em `auth-flow.test.ts` (senha errada não alerta; senha certa alerta uma vez;
com 2FA configurado não alerta).

### Verificação

`npm run lint`, `npm run check`, `npx prettier --check src/` e `npm run knip` limpos;
`npm run test` **764/764 verde** (31 testes novos no total desta sessão). Os 7 goldens de PDF e
os goldens de e-mail passam sem regravação.

### O que segue aberto da seção 1

Nada. Os quatro itens da seção 1 estão corrigidos. A seção 3 (duplicações) mantém os itens não
citados em §8/§9 — dívida de manutenção sem bug conhecido, boa carga para um lote dedicado.

## Próximo domínio sugerido

`src/routes/**` (UI + servidor) e o restante de `src/lib/components|composables|gise|schemas` ainda não foram auditados nesta rodada — são o maior volume de arquivos do projeto e onde vive a maior parte da UI. Seguir a mesma metodologia (comparar comentário↔código↔teste, taxonomia do plano formal) nesses diretórios é o próximo passo natural.
