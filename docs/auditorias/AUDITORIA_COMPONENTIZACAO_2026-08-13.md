# Auditoria — componentização e manutenibilidade (13/ago/2026)

**Status:** ABERTA — diagnóstico apenas, nenhuma remediação executada nesta
rodada.
**Objetivo:** facilitar manutenção e compreensão. Maximizar reuso onde o ROI é
alto e **não** unificar o que explode props ou mistura semânticas de domínio.
**Escopo:** `src/**` — UI (`$lib/components`, `**/_components`, páginas),
composables, camada de servidor (`$lib/server`, `$lib/db`, `+page.server.ts`,
`src/routes/api/**`).
**Fora de escopo:** regras de autorização (cobertas por
`AUDITORIA_FLUXOS_AUTORIZACAO_2026-08-06.md`, arquivada) e conteúdo visual dos
artefatos jurídicos (goldens).

Esta é a rodada seguinte à
[`AUDITORIA_COMPONENTIZACAO_2026-08-06.md`](../HISTORICO.md) (arquivada —
`git show fad06ea0:docs/auditorias/AUDITORIA_COMPONENTIZACAO_2026-08-06.md`).
Mede o que aquela deixou como alvo, confirma o que foi remediado e levanta o que
sobrou ou surgiu depois.

---

## Como ler

| Código | Significado |
| ------ | ----------- |
| C-EXTRAIR | Markup/script candidato a componente ou composable compartilhado |
| C-PROMOVER | Já existe em `_components` de rota; 2+ rotas usam — subir para `$lib` |
| C-FATIAR | Arquivo grande com ≥2 jobs — split local |
| C-ADOTAR | Componente/composable **já existe** e a rota ainda reimplementa |
| C-UNIFICAR | Duas definições da MESMA coisa, já divergentes |
| C-MANTER | Parecido de propósito — **não** extrair às cegas |
| C-SAUDÁVEL | Já correto — não reabrir |

`Sev`: **P1** (drift perigoso / manutenção alta / defeito visível) · **P2**
(ROI médio) · **P3** (polimento).

---

## 1. O que mudou desde 06/ago — as métricas-alvo, medidas

A remediação daquela auditoria **entregou o que prometeu**. Os números abaixo
são do working tree de 13/ago:

| Métrica-alvo de 06/ago | Alvo | Hoje | Veredito |
| ---------------------- | ---- | ---- | -------- |
| `window.confirm` nativo em UI | 0 | **0** | ✅ |
| Geradores de `Array.from({ length: 24\|60 })` | 1 módulo | **1** (`SeletorHoraMinuto.svelte:9-10`) | ✅ |
| `useFiltrosPaginados` em listagens URL-driven | +recebidos | **4** (escalas, policiais, unidades, recebidos) | ✅ |
| Confirms simples com Dialog cru | 0 | **0** | ✅ |
| `conf-ass` switches custom | 0 | **0** (usa `ToggleSwitch`) | ✅ |
| Arquivos Svelte ≥900 ln | ≤1 | **3** | ⚠️ ver abaixo |

**Adoção medida:** `ModalShell` consumido por **37** arquivos (era ~17–24);
`BotaoLimparFiltros` em 6; `KpiCard`/`ChipNivel` compartilhados entre
`auditoria` e `auditoria/logs`; `perfil/_components/` criado;
`ModalExcluirGise` migrado para `ModalShell` preservando o fetch de impacto.

**Os 6 overlays crus que restam são exatamente a lista de exceções declarada**
naquela auditoria — `PainelAcoesServidor`, `ModalNovaEscala`, `ModalCriarGise`,
`ModalDownloadExtras`, `ModalDatasHoras`, `ModalBreveRelatorio`. Zero drift
novo. Isso é o resultado mais importante desta seção: a disciplina segurou.

### 1.1 — O alvo que não foi atingido, e por quê

"Arquivos ≥900 ln: ≤1" continua em 3 — mas a **população trocou**:

| 06/ago | 13/ago |
| ------ | ------ |
| `GiseSupervisao` 1028 | ✅ resolvido (1028 → 131) |
| `produtividade/+page` 941 | ✅ resolvido (`useProdutividade` + 5 `_components`) |
| `+layout.svelte` 921 | ⚠️ **cresceu para 1146** |
| — | ⚠️ `ConfigurarFormulario` 978 (não estava na lista) |
| — | ⚠️ `escalas/+page` 914 (era 876, C-FATIAR P2) |

Os dois alvos ativos foram cumpridos. O que a métrica não capturou: o `layout`
foi declarado C-MANTER e cresceu 225 linhas desde então, e o custo do split de
`GiseSupervisao` foi pago em outra moeda — §3.1.

---

## 2. Snapshot do inventário

| Bucket | Qtd |
| ------ | --: |
| `.svelte` no total | 138 |
| `$lib/components/**` | 32 |
| Rotas `**/_components/**` | 68 |
| `$lib/composables/*.svelte.ts` | 18 |
| `+page.svelte` | 35 |
| Handlers `src/routes/api/**/+server.ts` | 58 |
| Testes Vitest | 126 |
| Specs Playwright | 37 |

### 2.1 — Maiores arquivos × churn (6 meses)

O cruzamento tamanho × frequência de alteração é o que separa "grande e
estável" de "grande e caro".

| Ln | Commits | Arquivo | Classificação |
| --: | ------: | ------- | ------------- |
| 1146 | **20** | `routes/+layout.svelte` | **C-FATIAR P2** (§3.6) |
| 978 | 12 | `res-gise/_components/ConfigurarFormulario.svelte` | C-FATIAR P3 |
| 914 | **16** | `escalas/+page.svelte` | C-EXTRAIR P3 (§3.10) |
| 865 | 13 | `gise/[id]/+page.svelte` | C-MANTER (orquestrador) |
| 852 | 13 | `painel/+page.svelte` | C-ADOTAR P1/P3 (§3.3, §3.9) |
| 823 | 13 | `gise/+page.svelte` | C-MANTER |
| 790 | 14 | `recebidos/+page.svelte` | C-ADOTAR P1/P3 |
| 779 | 9 | `auditoria/+page.svelte` | C-ADOTAR P3 |
| 663 | **15** | `res-gise/_components/useResGise.svelte.ts` | **C-FATIAR P1** (§3.4) |
| 1546 | 6 | `server/export/pdf.ts` | C-FATIAR P2 (§3.8) |
| 1381 | 14 | `escalas/[id]/+page.server.ts` | **C-FATIAR P2** (§3.5) |
| 1369 | 12 | `db/audit.ts` | C-FATIAR P2 (§3.7) |

### 2.2 — Props por componente (top 8)

| Props | Componente |
| ----: | ---------- |
| **38** | `gise/[id]/_components/GiseSupervisao.svelte` |
| 22 | `gise/[id]/_components/supervisao/SupervisaoDocumentos.svelte` |
| 20 | `gise/[id]/_components/supervisao/SupervisaoDesignacao.svelte` |
| 17 | `supervisao/SupervisaoPapelSeint.svelte` |
| 16 | `supervisao/SupervisaoPapelAssessor.svelte` |
| 16 | `$lib/components/ModalShell.svelte` |
| 15 | `$lib/components/PainelAssinaturaToken.svelte` |
| 14 | `supervisao/SupervisaoDocEscala.svelte` |

Os cinco primeiros são a mesma árvore. `ModalShell` e `PainelAssinaturaToken`
são primitivas de contrato amplo — justificado.

---

## 3. Achados

### 3.1 — C-EXTRAIR · **P1** · O prop drilling substituiu o arquivo grande

`GiseSupervisao` saiu de 1028 → 131 linhas. Mas o que restou é um **repassador
puro de 38 props** — o maior contrato do repositório — com 2 `$derived` de
lógica própria e mais nada:

```svelte
<!-- gise/[id]/_components/GiseSupervisao.svelte -->
<SupervisaoDesignacao {gise} {policiais} {isAdminGeral} {podeEditar} … />  <!-- 20 props -->
<SupervisaoDocumentos  {gise} {policiais} {isAdminGeral} {isSeccional} … /> <!-- 22 props -->
```

- `gise/[id]/+page.svelte:556-636` — 80 linhas só de fiação, com callbacks
  inline no meio do markup
- `supervisao/types.ts` (105 ln) existe só para nomear esse contrato

**O custo:** acrescentar um campo ao quadro exige tocar 4 arquivos — página,
orquestrador, `types.ts` e a folha. O arquivo ficou legível; a mudança, não.

**O que falta na caixa de ferramentas:** `setContext`/`getContext` tem **zero
uso** nos 138 componentes do projeto.

**Precedente interno para a correção** — já existe, no mesmo diretório:
`gise/[id]/_components/gise-seccional-estado.svelte.ts`, uma classe `$state`
única com cabeçalho explicando por que o estado não vive em cada folha.

**Contraste útil:** `res-gise` resolveu a mesma questão passando **o composable
inteiro como um prop só** (`<ConfigurarFormulario {resGise} … />`). É menos
elegante que contexto, mas já é 1 prop em vez de 38.

**Ação sugerida:** `QuadroSupervisaoEstado` (classe `$state`) + `setContext` no
orquestrador; folhas leem por `getContext`. `GiseSupervisao` deixa de existir ou
vira só o cabeçalho da seção.

---

### 3.2 — C-UNIFICAR · **P1** · Duas definições divergentes de `isMobile`

| Fonte | Predicado |
| ----- | --------- |
| `$lib/composables/useMobile.svelte.ts:12-17` | `UA_MOBILE \|\| ((max-width:768px) && maxTouchPoints > 0)` |
| `$lib/composables/useGiseEstado.svelte.ts:82-83` | `!(min-width:768px)` — sem UA, sem touch |

Divergem em dois pontos:

1. **Exatamente em 768px.** `max-width:768px` é `true` em 768; `min-width:768px`
   também é `true` em 768, então `!` dá `false`. Na mesma largura uma diz mobile
   e a outra diz desktop.
2. **Desktop com touch.** A primeira exige `maxTouchPoints > 0`; a segunda
   ignora. Notebook touch de 700px é mobile para as duas; tablet de 800px é
   desktop para as duas; e um desktop touch estreito só é mobile para uma.

As duas alimentam props chamadas `isMobile`: `escalas/+page.svelte:402` e
`res-gise/+page.svelte:42` usam a primeira; `gise/[id]/+page.svelte:85` usa a
segunda. E em gise o valor é **drillado por 4 níveis**:

```
gise/[id]/+page.svelte:513
  └─ GiseSupervisao:118
       └─ SupervisaoDocumentos:101,124
            └─ SupervisaoDocEscala:161 / SupervisaoDocExtra:198
                 └─ SupervisaoDocumentoCard:145
```

É a forma exata descrita no `CLAUDE.md` → "Duplicação: extrair antes de
comentar": mesma pergunta, duas respostas, e a divergência é silenciosa.

**Ação sugerida:** `useGiseEstado` passa a delegar para `useMobile()`; folhas que
só querem o breakpoint chamam `useMobile()` direto em vez de receber prop.
Decidir **de propósito** se o critério certo inclui `maxTouchPoints` — e
escrever a decisão no cabeçalho de `useMobile`.

---

### 3.3 — C-ADOTAR · **P1** · Badge de tipo de escala com o mapa de cor invertido

`escalas/_components/BadgeTipoEscala.svelte` existe, documentado, com prop de
tamanho para desktop e mobile. Três páginas reimplementam o mesmo conceito
inline — **com as cores trocadas**:

| Local | Plantão | Expediente | FDS | Estilo |
| ----- | ------- | ---------- | --- | ------ |
| `BadgeTipoEscala.svelte:17-23` | primary | secondary | tertiary | `preset-outlined-*` |
| `painel/+page.svelte:646, 760` | **tertiary** | **primary** | **warning** | `preset-filled-*/20` |
| `recebidos/+page.svelte:493, 656` | tertiary | primary | warning | `preset-filled-*/20` |
| `unidades/+page.svelte:219-226` | tertiary | primary | — | `preset-filled-*/20` |

"Plantão" é **primary** no arquivo de escalas e **tertiary** no painel, na caixa
de entrada e na tela de unidades. São 5 cópias inline em 3 arquivos, com dois
tamanhos tipográficos (`text-xs` e `text-3xs`) e dois paddings.

O componente já cobre os dois tamanhos. Falta só uma variante de estilo
(`outlined` vs `filled`) — ou a decisão de que uma delas é a certa.

**Ação sugerida:** promover `BadgeTipoEscala` para `$lib/components/`, adicionar
prop `variante`, adotar nas 3 páginas. **Escolher qual mapa de cor é o
canônico** — esta é a decisão de produto embutida no achado.

---

### 3.4 — C-FATIAR · **P1** · `useResGise`: um composable, duas plateias

`res-gise/_components/useResGise.svelte.ts` — 663 ln, **15 commits em 6 meses**,
o arquivo de maior churn depois do layout. Devolve uma API de **41 membros** que
junta dois usuários que nunca se cruzam:

| Editor do modelo (Admin Geral) | Presença (policial) |
| ------------------------------ | ------------------- |
| `configTipo`, `perguntasConfig`, `configJson`, `alteracoesNaoSalvas`, `operacoes`, `operacaoSelecionada`, `tiposDisponiveis` | `escalaSelecionada`, `capturandoRubrica`, `baixandoProdutividade`, `baixandoExtra`, `baixandoTermo` |
| `adicionarPergunta`, `adicionarSubPergunta`, `moverPergunta`, `removerPergunta`, `trocarOperacao`, `alternarFormaGrafico`, `alternarIndicador`, `definirMetaTipoIndicador`, `handleSalvarModelo` | `selecionarEscala`, `salvarEntrada`, `salvarSaida`, `sincronizarPresencaAtual`, `baixarRelatorio`, `baixarRelatorioExtra`, `baixarTermoPresenca`, `isHorarioLiberado`, `isSaidaLiberada` |

`ConfigurarFormulario.svelte:49` e `FormularioServico.svelte:36` recebem **o
mesmo objeto de 41 membros** (`resGise: ReturnType<typeof useResGise>`), cada um
usando só a sua metade. O `ConfigurarFormulario` nem aparece para o policial —
`res-gise/+page.svelte:167` o renderiza sob `{#if isAdminGeral}`.

O próprio cabeçalho de `res-gise/+page.svelte:6` já diz, em prosa, o que o
código não seguiu:

> Duas audiências no mesmo arquivo, e é essa a razão do tamanho.

O diagnóstico está escrito. Falta separá-las.

**Ação sugerida:** `useEditorModelo.svelte.ts` + `usePresencaGise.svelte.ts`. A
página instancia só o que a plateia daquele render precisa — e o editor deixa de
ser carregado no bundle do policial.

---

### 3.5 — C-FATIAR · **P2** · `escalas/[id]/+page.server.ts`, 14 actions num bloco

1381 linhas, das quais **1122 são um único `export const actions`**
(`+page.server.ts:259-1381`) com 14 entradas: `adicionar`, `adicionarPlantao`,
`adicionarTodos`, `gerarProximoMes`, `editar`, `remover`, `repetir`,
`editarPlantaoAgrupado`, `editarDiasEscala`, `finalizar`, `reenviarEmail`,
`desfinalizar`, `removerTodos`, `removerSelecionados`.

O padrão que resolve isso **já existe no repositório**: `gise/[id]/_actions/`
com 7 arquivos deixou aquele `+page.server.ts` em 278 ln. Em escalas só
`desfecho.ts` (85 ln) foi extraído.

**Esta é P2, não P1** — e a distinção importa. As 14 actions chamam
`carregarEscalaComPermissao` (17 ocorrências no arquivo); o preâmbulo já está
extraído e a autorização está correta. Não é o caso do
`gise/[id]/_actions/shared.ts:19-30`, cujo cabeçalho registra que a extração
descobriu um guard pela metade. Aqui o custo é legibilidade e **teste**.

O sintoma está escrito no próprio repositório —
`escalas/[id]/_actions/__tests__/actions-auditadas.test.ts:9-13`:

> A leitura é textual […]: chamar cada action exigiria RequestEvent, FormData,
> sessão e D1 para cada uma das catorze.

O teste lê o `+page.server.ts` como texto porque não consegue chamar as actions.
Extraí-las para `_actions/` é o que converte guards textuais em teste de
verdade — foi o que rendeu `shared.test.ts` e `escopo-ids-filhos.test.ts` do
lado da GISE.

**Agrupamento sugerido** (espelhando gise): `actions-membros.ts`
(adicionar/adicionarTodos/remover/removerTodos/removerSelecionados),
`actions-plantao.ts` (adicionarPlantao/editarPlantaoAgrupado),
`actions-datas.ts` (gerarProximoMes/repetir/editarDiasEscala),
`actions-ciclo.ts` (finalizar/desfinalizar/reenviarEmail), `editar` junto de
membros ou em `shared.ts`.

---

### 3.6 — C-FATIAR · **P2** · `+layout.svelte`, o hotspot número 1

1146 ln e **20 commits em 6 meses** — o topo das duas listas. Foi declarado
C-MANTER em 06/ago com 921 ln e cresceu 225 desde então; o C-MANTER precisa ser
reavaliado ou reafirmado com um motivo novo.

São ~477 ln de script com pelo menos 5 jobs:

| Job | Onde |
| --- | ---- |
| Modelo do menu — ~15 flags `$derived` + o array de itens | L74-400 |
| Máquina da gaveta: abrir/fechar, níveis, foco, `inert`, Esc | L145-435 |
| View transitions + barra de progresso | L437-465 |
| Banner de deploy novo (`updated.current`) | L470-476 |
| Toast, overlay global, logout, aviso de rubrica | markup |

**O maior retorno não é fatiar markup — é extrair o modelo do menu.** As
condições de visibilidade (`showEscalasPoliciais`, `showGise`, `showIndicadores`,
`showDadosBase`, `temPresencaGiseAtiva`, `showGrupo1`/`showGrupo2`…) são lógica
pura, hoje **intestável** por viver dentro de um `.svelte`. O cabeçalho do
próprio arquivo (L9-15) explica que a visibilidade cruza dois eixos que não se
implicam — QUEM é a pessoa e QUAL módulo o admin escolheu — exatamente o tipo de
regra que merece teste em vez de comentário.

**Ação sugerida:** `routes/_components/menu-itens.svelte.ts` exportando uma
função pura `itensDoMenu(usuario, flags)` + `__tests__/`. Depois, se valer,
`_components/Sidebar.svelte`. O resto do layout é chrome legítimo.

---

### 3.7 — C-FATIAR · **P2** · Catálogo de dados dentro do módulo de consulta

O mesmo formato nos dois maiores arquivos de `lib/db/`:

| Arquivo | Total | Trecho que é DADO, não lógica |
| ------- | ----: | ----------------------------- |
| `db/audit.ts` | 1369 ln | `CATALOGO_ACOES` L60-411 (~350 ln) |
| `db/gise/respostas.ts` | 951 ln | `DEFAULT_QUESTIONS`, `TEXTOS_FORM_OPERACIONAL`, `DEFAULT_QUESTIONS_FORM_OPERACIONAL`, `DEFAULT_SEINT_QUESTIONS` — L56-388 (~330 ln) |

Nos dois casos o catálogo é lido **também pela UI**, e o resto do arquivo é
consulta/escrita no D1. Quem abre `respostas.ts` para mexer numa query passa por
330 linhas de perguntas de formulário antes de chegar nela.

O cabeçalho de `respostas.ts:231-236` registra que uma cópia de 122 linhas desse
mesmo default já viveu dentro da página (achado 11.3 do antigo `ARQUIVOS.md`) —
o risco desse tipo de dado espalhar já se materializou uma vez.

`audit.ts` ainda tem 3 jobs distintos: catálogo · escrita + cadeia de hash
(`canonicalAudit`, `calcularHashRegistro`, `anonimizarIp`, `auditar`,
pendências) · consulta (`listarAuditLog`, `resumoAuditoria`,
`verificarIntegridadeAudit`, `eventosCriticosRecentes`).

**Ação sugerida:** `db/audit/{catalogo,escrita,consulta}.ts` + `index.ts`;
`db/gise/respostas-modelo-padrao.ts` separado das queries. O barrel de
`lib/db.ts` já é a exceção documentada do projeto — os call sites não mudam.

**Bônus de organização:** `lib/db/` nunca recebeu o tratamento de subpastas que
`lib/server/` teve. `lgpd-incidentes` / `lgpd-retencao` / `lgpd-solicitacoes` e
`policiais` / `policial-exclusao` / `policial-historico` /
`cadastro-solicitacoes` são dois domínios espalhados na raiz — o mesmo sintoma
que o `CLAUDE.md` descreve para `lib/server/` ("arquivo novo cujo nome só faz
sentido com prefixo de domínio pertence a uma subpasta").

---

### 3.8 — C-FATIAR · **P2** · `export/pdf.ts` — 6 geradores, e a rede está armada

1546 ln com seis geradores independentes e blocos compartilhados:

| Ln | Export |
| --: | ------ |
| 433 | `gerarPdfExpediente` |
| 592 | `gerarPdfPlantao` |
| 705 | `gerarPdfGise` |
| 986 | `gerarRelatorioProdutividadeGisePdf` |
| 1354 | `gerarRelatorioExtraordinarioPdf` |
| 1429 | `gerarRelatorioExtraordinarioSupervisaoPdf` |
| 1067-1354 | blocos compartilhados dos relatórios extraordinários |

O split é **seguro justamente porque os goldens existem**:
`export/__tests__/pdf-goldens.test.ts` + `fixtures/pdf-goldens.json`,
`server/__tests__/email-templates.test.ts` e
`assinatura/__tests__/carimbos-visuais.test.ts`. É o procedimento do
`CLAUDE.md` → "Artefato com valor jurídico: golden antes de refatorar" —
rodar verde, refatorar, confirmar que não mudou um byte. **Sem
`UPDATE_PDF_GOLDENS`.**

---

### 3.9 — C-ADOTAR · **P3** · `EstadoVazio` existe e 4 páginas ignoram

`$lib/components/EstadoVazio.svelte` está adotado em 5 arquivos (escalas,
policiais). Quatro páginas montam o próprio:

| Local | Padding | Tratamento |
| ----- | ------- | ---------- |
| `painel/+page.svelte:588` | `py-20` | ícone + título `text-lg font-semibold` + descrição `text-sm` |
| `recebidos/+page.svelte:424` | `py-20` | idem |
| `unidades/+page.svelte:352` | — | SVG inline + título + descrição |
| `auditoria/+page.svelte:748` | `p-10` | caixa com borda, `text-sm`, sem ícone |

Três paddings, três tratamentos tipográficos. O componente hoje aceita
`mensagem` / `children` / `tom`; falta `icone` e `descricao` para cobrir os
quatro — todos convergem para a mesma forma (ícone, título, subtítulo).

---

### 3.10 — C-EXTRAIR · **P3** · Cards de navegação de `escalas/+page.svelte`

`escalas/+page.svelte:477, 494, 514, 532, 550, 570` — seis blocos repetem

```
card-elevated rounded-2xl p-5 sm:p-6 flex flex-col items-start gap-1.5 text-left
  cursor-pointer transition-colors hover:border-primary-500/40 group
```

com título + contador opcional + descrição, variando só em ícone, rótulo e
destino. ~90 ln → `escalas/_components/CardNavegacao.svelte`. Extração local,
não vai para `$lib` (as ocorrências em `dados-base/` usam a mesma classe como
`<section>` — semântica diferente, C-MANTER).

---

### 3.11 — P3 · Lacunas de teste por domínio

| Pasta | fontes / testes |
| ----- | --------------: |
| `lib/db/gise` | 18 / 8 |
| `lib/schemas` | 12 / 4 |
| `lib/crypto` | 9 / 3 |
| `lib/server/export` | 6 / 2 |
| `lib/utils` | 5 / 1 |
| `lib/db` (raiz) | 16 / 16 ✅ |
| `lib/server/assinatura` | 24 / 24 ✅ |

`lib/db/gise` é a maior lacuna em superfície crítica. `lib/schemas` chama
atenção por ser barato: schema Zod é função pura.

Só 4 pastas de rota têm `__tests__` (`auditoria/_components`,
`escalas/[id]/_actions`, `escalas/[id]/_components`, `gise/[id]/_actions`) — e
não por acaso são as que passaram por extração. §3.5 e §3.6 aumentam essa conta
como efeito colateral.

---

## 4. C-MANTER — explicitamente não mexer

| Peça | Motivo |
| ---- | ------ |
| `assinatura/pdf-signing-prepare.ts` (1302), `pdf-verification.ts` (1278) | Pipelines criptográficos coesos, com seções já demarcadas. Grandes por natureza, não por acúmulo |
| `server/schema.ts` (1403, 39 tabelas) | Tamanho é função do domínio; declarado infra transversal no `CLAUDE.md` |
| `gise/[id]/+page.svelte` (865), `gise/+page.svelte` (823) | Orquestradores já fatiados — o tamanho é cola, não lógica |
| Os 6 overlays crus restantes | Lista de exceções declarada em 06/ago; interação/altura/empilhamento não cabem no `ModalShell` |
| Grades de calendário (4) | Semânticas diferentes — `CLAUDE.md` e auditoria de duplicação §4.2 |
| `Paginador` × `PaginationControls` | Contratos diferentes; documentado no cabeçalho de `Paginador` |
| `PainelAssinatura*` (Digital/FDS/Token/Escala) | Variantes legais e de dispositivo |
| `GiseActionButton` × `res-gise/BotoesAcao` | Drift visual já é deliberado e documentado |
| `DataTable` genérico / `FilterBar` universal | Props explodem; preferir `useFiltrosPaginados` + UI local |
| Quatro fluxos em `login/` | Fatiado por fluxo de propósito — não fundir |
| `dados-base/*` usando `card-elevated rounded-2xl` | É `<section>`, não card de navegação (§3.10) |

---

## 5. O que está saudável — a base de disciplina

Vale registrar porque é o que sustenta tudo acima e **não deve ser gasto**:

**Conformidade com o `CLAUDE.md` é total.** Varredura em `src/**`:

| Antipadrão | Ocorrências |
| ---------- | ----------: |
| `export let` | 0 |
| `on:click` / `on:submit` | 0 |
| `<slot>` | 0 |
| `svelte/store` em UI | 0 |
| `fetch()` cru no cliente | 0 |
| Import do barrel inexistente `$lib/utils` | 0 |
| Arquivo auxiliar de rota fora de `_components/`/`_actions/` | 0 |
| `return json({ error` em `routes/api` | 0 |
| Teste fora de `__tests__/` | 0 |

A raiz de `src/lib/server/` tem **exatamente** os 11 arquivos declarados como
infra transversal — nem um a mais.

Os 12 handlers de mutação sem schema Zod são legitimamente sem corpo (logout,
`alternar-modulo`, `alternar-acesso`, DELETE por parâmetro de URL, os 4 webhooks
autenticados por segredo). Não é lacuna.

**CI:** `lint:ci --max-warnings 0`, `format:check` para `src/` e `e2e/`
separadamente, `knip`, `svelte-check --threshold error`, 126 testes Vitest +
37 specs Playwright, e 5 guards próprios (convenção de testes, padrão de erro de
API, permissão de documento assinado, autorização de operação material,
documentação de arquivo novo em `lib/db`).

**`npm run docs:inventario`:** 371 arquivos ≥40 ln · 54 sem cabeçalho · **1
opaco** · 5 exports sem JSDoc. O único opaco é
`gise/[id]/_components/supervisao/SupervisaoDocExtra.svelte` (27 ramos, 2% de
comentário) — nascido do split de §3.1 e o primeiro candidato a cabeçalho.

---

## 6. Sequência recomendada

### Lote A — os dois defeitos (1 PR, risco baixo)

1. **Unificar `isMobile`** (§3.2) — `useGiseEstado` delega para `useMobile()`;
   decidir e documentar o critério. *Esforço S.*
2. **`BadgeTipoEscala` nas 3 páginas** (§3.3) — promover para `$lib`, prop
   `variante`, escolher o mapa canônico. *Esforço S–M.*

Os dois são visíveis para o usuário final e independentes de qualquer
refatoração estrutural.

### Lote B — o que a manutenção paga toda semana (2 PRs)

3. **Split de `useResGise`** (§3.4) — editor × presença. *Esforço M.*
4. **`menu-itens.svelte.ts` + testes** (§3.6) — extrai a lógica pura do maior
   hotspot. *Esforço M.*

### Lote C — estrutura (1 PR cada, sequencial)

5. **`escalas/[id]/_actions/`** (§3.5) — espelha gise; converte os guards
   textuais em teste. *Esforço M–G.*
6. **Contexto no quadro de supervisão** (§3.1) — 38 props → estado
   compartilhado. *Esforço M–G, o de maior risco de regressão.*
7. **`db/audit/` e `respostas-modelo-padrao.ts`** (§3.7). *Esforço M.*
8. **Split de `export/pdf.ts`** (§3.8) — com goldens verdes antes e depois.
   *Esforço M.*

### Lote D — polimento (pode ir junto de qualquer PR acima)

9. `EstadoVazio` com `icone`/`descricao` nas 4 páginas (§3.9)
10. `CardNavegacao` em escalas (§3.10)
11. Cabeçalho em `SupervisaoDocExtra.svelte` (§5)
12. Subpastas `lgpd/` e `policiais/` em `lib/db/` (§3.7)

### Não fazer nesta onda

Tudo em §4. Em especial: não criar `DataTable`/`FilterBar` genéricos, não fundir
os painéis de assinatura, não tocar em `pdf-signing-prepare` / `pdf-verification`
e não regravar golden nenhum.

---

## 7. Métricas-alvo para a próxima medição

| Métrica | Hoje (13/ago) | Alvo pós lotes A–C |
| ------- | ------------: | -----------------: |
| Maior contagem de props num componente | 38 | ≤15 |
| Definições de `isMobile` | 2 | 1 |
| Cópias inline do badge de tipo de escala | 5 (3 arquivos) | 0 |
| Membros na API de `useResGise` | 41 | 2 composables ≤25 |
| `escalas/[id]/+page.server.ts` | 1381 ln | ≤350 ln |
| Arquivos Svelte ≥900 ln | 3 | ≤2 |
| Pastas de rota com `__tests__/` | 4 | ≥6 |
| Empty states montados à mão | 4 | 0 |
| Arquivos opacos (`docs:inventario`) | 1 | 0 |

Comandos para revalidar:

```bash
find src -name '*.svelte' -exec wc -l {} + | sort -rn | head -20
npm run docs:inventario
npx svelte-kit sync && npm run knip
git log --since="6 months ago" --name-only --pretty=format: -- 'src/**' \
  | grep -E '\.(svelte|ts)$' | sort | uniq -c | sort -rn | head -20
```

---

## 8. Veredito

**A disciplina do projeto está funcionando.** Zero antipadrões do `CLAUDE.md`,
convenção de pastas respeitada à risca, CI com 5 guards próprios, e a auditoria
anterior entregou 5 das 6 métricas que prometeu. Não há P0 nesta rodada.

O que sobrou tem uma forma só, e ela é instrutiva: **o ganho de manutenção
migrou de "arquivo grande" para "contrato grande"**. `GiseSupervisao` encolheu
88% e ficou mais caro de mudar, porque as 38 props que antes eram variáveis
locais viraram uma interface entre 4 arquivos. `useResGise` é o espelho disso do
lado do estado — 41 membros servindo duas plateias que não se falam.

Fatiar arquivo sem mover o estado junto troca uma dívida por outra. As duas
ferramentas que faltam para fechar isso já existem no repositório — a classe
`$state` de `gise-seccional-estado.svelte.ts` e o `_actions/` da GISE — e
nenhuma das duas foi aplicada onde mais dói. A API de contexto do Svelte, que é
a resposta canônica para o caso de §3.1, tem zero uso em 138 componentes.

Os dois achados que valem começar por hoje não são estruturais: são as duas
definições de `isMobile` e o badge com a cor invertida em três telas. Os dois são
pequenos, os dois são visíveis, e os dois são exatamente o que a tabela do
`CLAUDE.md` prevê que aconteça quando se comenta em vez de extrair.

---

## 9. Relação com outras auditorias

| Documento | Sobreposição |
| --------- | ------------ |
| `AUDITORIA_COMPONENTIZACAO_2026-08-06.md` (arquivada) | Esta é a rodada seguinte; §1 mede as métricas-alvo daquela |
| `AUDITORIA_FLUXOS_AUTORIZACAO_2026-08-06.md` (arquivada) | Não misturar: nada aqui altera guard de servidor. §3.5 registra explicitamente que a autorização de escalas está correta |
| `AUDITORIA_VISUAL_2026-07-29.md` (aberta) | §3.3 e §3.9 são consistência visual — encaixam no escopo dela |
| `README.md` §10 / `CLAUDE.md` | Fonte de verdade dos tokens e da regra "extrair antes de comentar" |

Ao encerrar esta auditoria (achados resolvidos ou formalmente aceitos), remover
o arquivo do working tree e catalogar em [`docs/HISTORICO.md`](../HISTORICO.md).
