# Auditoria visual do front-end — 29/jul/2026

Escopo: camada visual (`src/app.html`, `src/app.css`, `src/theme.css`, 106
componentes `.svelte`) sob a stack real — **Svelte 5 (runes) + SvelteKit 2 +
Tailwind CSS v4 + Skeleton UI v4 + lucide-svelte**.

Método: leitura estática + medição. Toda afirmação numérica abaixo foi obtida
de uma das quatro fontes: (a) contagem sobre o working tree, (b) conversão
oklch→sRGB e cálculo de contraste WCAG 2.1 a partir de `src/theme.css`,
(c) inspeção do CSS **compilado** (`npm run build`), (d) medição em Chromium
via Playwright. O conversor de cor foi validado contra os valores de
referência do CSS Color 4 (`oklch(62.796% 0.25768 29.234)` → `#ff0000`,
exato nos três primários).

Identificadores: **VIS-1…VIS-11** (os prefixos `V-*`/`UX-*` pertencem à
auditoria de 11/jul/2026).

---

## Resumo

| #      | Achado                                                                             | Alcance  | Severidade |
| ------ | ---------------------------------------------------------------------------------- | -------- | ---------- |
| VIS-1  | `text-surface-500` falha AA no modo claro — e a regra do README o define como piso | 461 usos | **Alta**   |
| VIS-2  | Texto selecionado fica ilegível no modo claro                                      | global   | **Alta**   |
| VIS-3  | `overflow-hidden` anula o scroll horizontal de `table-wrap`                        | 3 sites  | **Alta**   |
| VIS-4  | `preset-filled-tertiary-500` e `-success-500` abaixo de 4,5:1                      | 48 usos  | Média      |
| VIS-5  | Shell de modal duplicado 41× e já em 9 variantes                                   | 41 sites | Média      |
| VIS-6  | `lucide-svelte` está deprecado upstream — e o README o prescreve                   | dep.     | Média      |
| VIS-7  | 188 SVGs inline; o mesmo lápis desenhado à mão 22×                                 | 54 arqs. | Baixa      |
| VIS-8  | `<img>` sem `width`/`height` (CLS)                                                 | 9 imgs   | Baixa      |
| VIS-9  | `z-index` fora da escala documentada                                               | 6 sites  | Baixa      |
| VIS-10 | 3 tabelas fora do par `table` + `table-wrap`                                       | 3 sites  | Baixa      |
| VIS-11 | `LoadingOverlay` aplica `will-change` a todos os `<div>`                           | 1 arq.   | Baixa      |

O que **não** é problema está em [§ Verificado e correto](#verificado-e-correto)
— vale ler, porque parte disso eu cheguei a marcar como suspeita e a medição
inocentou.

---

## VIS-1 — `text-surface-500` falha AA no modo claro (461 usos)

**A regra do README codifica um valor reprovado como piso.** README §10,
_Padrões visuais → Contraste_:

> texto informativo usa no mínimo `text-surface-500 dark:text-surface-400`

Medido a partir de `src/theme.css` (`--color-surface-500: oklch(59% 0.03 255deg)`
→ `#6b7280`):

| Texto              | sobre `surface-50` (página) | sobre `bg-white` (`card-elevated`) | sobre `surface-900` (escuro) |
| ------------------ | --------------------------- | ---------------------------------- | ---------------------------- |
| `text-surface-500` | **3,88:1** ❌               | **4,10:1** ❌                      | 4,66:1 ✅                    |
| `text-surface-600` | 6,43:1 ✅                   | 6,81:1 ✅                          | 2,81:1 ❌                    |
| `text-surface-400` | 2,43:1 ❌                   | 2,57:1 ❌                          | 7,44:1 ✅                    |

WCAG 2.1 AA exige **4,5:1** para texto normal. O par documentado acerta o modo
escuro e erra o claro.

Alcance:

- **461** ocorrências de `text-surface-500` aplicam no modo claro (o `dark:`
  só sobrepõe no escuro, então as 209 que têm `dark:text-surface-400` também
  contam);
- **258** delas combinam o tom com `text-xs`/`text-2xs`/`text-3xs` — texto
  miúdo não tem a isenção de "texto grande" (que só vale a partir de 18,66px
  em negrito ou 24px normal).

Isso não é deriva: o código segue a regra. A regra é que está errada.

O par correto **já existe no repositório** — `text-surface-600 dark:text-surface-400`,
76 usos, entre eles `src/routes/+error.svelte:25`. Ele passa nos dois modos
(6,43 claro / 7,44 escuro).

**Correção:** trocar a regra do README para `text-surface-600 dark:text-surface-400`
e migrar as 461 ocorrências. É substituição mecânica de duas classes, mas
mexe em quase todo arquivo `.svelte` — vale um commit isolado.

## VIS-2 — texto selecionado ilegível no modo claro

`src/app.html:15`:

```html
class="… selection:bg-primary-500/30 selection:text-primary-100"
```

`selection:text-primary-100` não tem contraparte clara, então o texto
selecionado é ciano quase branco (`#c7f7ff`) sobre um realce igualmente claro:

| Fundo                       | Cor do realce | Contraste do texto selecionado |
| --------------------------- | ------------- | ------------------------------ |
| `surface-50` (página clara) | `#ace2ee`     | **1,22:1** ❌                  |
| `bg-white` (card claro)     | `#b3e7f0`     | **1,16:1** ❌                  |
| `surface-950` (escuro)      | `#023a48`     | 10,70:1 ✅                     |

Confirmado em Chromium: selecionando um parágrafo no modo claro, o texto
some. O modo claro não é hipotético — é o default para quem tem o SO em
claro (`static/init.js:15`) e tem alternador na sidebar
(`src/routes/+layout.svelte:110`).

**Correção** (`src/app.html:15`):

```diff
-selection:text-primary-100
+selection:text-surface-950 dark:selection:text-primary-100
```

`surface-950` sobre o realce claro dá 14,29:1 (página) / 14,92:1 (card).
Alternativa: remover o override e deixar o texto herdar a própria cor — o
realce a 30% já basta como indicação.

## VIS-3 — `overflow-hidden` anula o `table-wrap` (3 sites)

- `src/routes/painel/+page.svelte:584`
- `src/routes/recebidos/+page.svelte:437`
- `src/routes/auditoria/+page.svelte:713` (mesma forma, `rounded-lg overflow-hidden`)

```html
<div class="hidden md:block table-wrap overflow-hidden rounded-xl"></div>
```

`table-wrap` é um `@utility` do Skeleton (`utilities/tables.css:3`) que vale
`width:100%; overflow:auto`. `overflow-hidden` é utilitário do Tailwind na
**mesma camada e mesma especificidade** — quem vence é o que sai depois na
folha. No CSS compilado:

```
.table-wrap      → offset 54838   {width:100%;overflow:auto}
.overflow-hidden → offset 64806   {overflow:hidden}
```

`overflow-hidden` vence. Medido em Chromium com o markup real da tabela de
`/recebidos` num container de 700px:

```
#a (como está): overflow-x=hidden  scrollWidth=866  clientWidth=696  transbordo=170px
#b (sem ele):   overflow-x=auto    scrollWidth=866  clientWidth=696  transbordo=170px
```

Um elemento `overflow:hidden` continua rolável por script e pelo foco de
teclado, mas **não pelo usuário de mouse**: não há barra, nem roda, nem
arraste. São ~170px — a coluna "Ações" inteira — inalcançáveis.

Não é um cenário de borda. A sidebar é `clamp(168px, 18vw, 240px)` a partir
de 900px (`+layout.svelte:737`); num viewport de 900px sobram ~700px de
conteúdo para uma tabela de 5–6 colunas com botões.

**Correção:** remover `overflow-hidden`. O `rounded-xl` continua recortando
sozinho — qualquer `overflow` diferente de `visible` já recorta ao
border-radius, inclusive `auto`.

## VIS-4 — dois presets `filled` abaixo de 4,5:1

`preset-filled-X-500` do Skeleton pinta `background: --color-X-500` e
`color: --color-X-contrast-500` (`utilities/presets.css:8`). Com os valores
de `src/theme.css`:

| Preset                        | Usos | Fundo     | Texto  | Contraste   |
| ----------------------------- | ---- | --------- | ------ | ----------- |
| `preset-filled-primary-500`   | 100  | `#00aece` | escuro | 7,44 ✅     |
| `preset-filled-warning-500`   | 33   | `#d48a00` | escuro | 7,00 ✅     |
| `preset-filled-error-500`     | 24   | `#d63053` | branco | 4,76 ✅     |
| `preset-filled-tertiary-500`  | 24   | `#20a04e` | branco | **3,40** ❌ |
| `preset-filled-success-500`   | 24   | `#4a9c36` | branco | **3,43** ❌ |
| `preset-filled-secondary-500` | 1    | `#3c72cb` | branco | 4,73 ✅     |

Rótulo de botão é `text-sm` (14px) — texto normal, alvo 4,5:1.

**Correção** — trocar o contraste para escuro nos dois canais, em
`src/theme.css`, é a mudança de menor alcance (dois `var()`, nenhum
componente tocado):

```diff
-	--color-tertiary-contrast-400: var(--color-tertiary-contrast-light);
-	--color-tertiary-contrast-500: var(--color-tertiary-contrast-light);
+	--color-tertiary-contrast-400: var(--color-tertiary-contrast-dark);
+	--color-tertiary-contrast-500: var(--color-tertiary-contrast-dark);
```

Resultado: preto sobre `tertiary-500` = **6,18:1**; sobre `success-500` =
**6,12:1**. (Escurecer o fundo para `-600` também resolve — 4,75 e 4,79 —
mas muda a identidade da cor em 48 lugares.)

`preset-outlined-*` não entra nesta conta: só define `border-color`, o texto
herda.

## VIS-5 — shell de modal duplicado 41×, já em 9 variantes

O canon está documentado, mas num **comentário** (`src/app.css:78-83`) e no
README. Como o `CLAUDE.md` prevê ("comentário protege quem lê _aquele_
arquivo"), já derivou.

Backdrops (`Dialog.Content`):

| Ocorrências | Classe                                                                             |
| ----------- | ---------------------------------------------------------------------------------- |
| 27          | `fixed inset-0 z-50 … p-4 bg-surface-950/80 backdrop-blur-sm overflow-y-auto`      |
| 4           | idem, mas `p-3 sm:p-4`                                                             |
| 3           | `z-[60] … p-3 sm:p-4 … backdrop-blur-md` (modal sobre modal — correto)             |
| 2           | idem, mas `p-2 sm:p-4`                                                             |
| 5           | mais 5 variantes de um uso cada (`z-[70]`, `z-[100]`, com e sem `overflow-y-auto`) |

Painéis: a string `card p-4 sm:p-6 max-w-{sm,md,lg} w-full max-h-[calc(100dvh-2rem)] overflow-y-auto card-elevated shadow-2xl rounded-2xl`
aparece **18×** literalmente idêntica (10× `max-w-sm`, 6× `md`, 2× `lg`).

O rodapé canônico (`flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3`)
está em 24 dos ~41 modais.

A divergência hoje é só de padding — cosmética. O risco é o padrão de sempre:
alguém corrige um (encurta o `max-h` para caber teclado de iOS, troca o
`z-index`) e os outros 40 ficam para trás.

**Correção:** um `<ModalShell>` em `src/lib/components/` com props
`open`/`onOpenChange`/`largura`/`empilhado` e snippets para corpo e rodapé.
O `Dialog` do Skeleton continua por dentro — não se perde foco/ESC/ARIA.

## VIS-6 — `lucide-svelte` está deprecado upstream

`npm ci` avisa:

```
npm warn deprecated lucide-svelte@1.0.1: Package deprecated. Please use @lucide/svelte instead.
```

O README §10 prescreve exatamente esse pacote para código novo. A regra
aponta para um pacote que não recebe mais atualização — inclusive as de
compatibilidade com o Svelte 5.

**Correção:** migrar para `@lucide/svelte` (mesmo autor, mesma API de
importação nomeada; troca de specifier em 26 arquivos) e atualizar o README
junto, no mesmo PR.

## VIS-7 — 188 SVGs inline; o mesmo ícone desenhado até 22×

Dívida já reconhecida no README ("o SVG inline legado migra oportunisticamente
ao tocar no arquivo"). O que é novo é o tamanho:

- **188** `<svg>` inline em **54** arquivos, contra 35 ícones do lucide em 26;
- são paths do Heroicons, um vocabulário visual diferente do Lucide — grade e
  peso óptico distintos convivendo na mesma tela;
- os mais repetidos: lápis **22×**, download **8×**, lápis-em-quadrado **7×**,
  escudo-check **6×**, relógio **6×**, check-círculo **5×**, alerta-círculo **5×**.

22 cópias do mesmo path é o cenário do `CLAUDE.md`: ninguém vai ajustar as 22
ao mudar o stroke.

**Correção:** manter a política oportunista, mas priorizar os 7 ícones acima
— cobrem ~60 das 188 ocorrências. Fazer junto com VIS-6, num único passe.

## VIS-8 — `<img>` sem `width`/`height` (CLS)

As 9 `<img>` do projeto têm `alt` (verificado uma a uma) mas **nenhuma** tem
`width`/`height` nem `aspect-ratio` — só classes de altura (`h-16 w-auto`,
`w-14 sm:w-20`). Sem proporção intrínseca declarada, o navegador reserva 0px
até a imagem chegar e o conteúdo salta.

Pesa mais em `/validar/[hash]`, `/validar`, `/termo/*` e `/aceitar-termo`:
são páginas públicas, sem sessão, e o brasão (`/api/validar/logo`) está no
topo — o salto empurra tudo.

**Correção:** `width`/`height` reais no `<img>` (as classes continuam mandando
no tamanho renderizado; os atributos só dão a proporção).

## VIS-9 — `z-index` fora da escala documentada

O README define a escala (`z-10 · z-40 · z-50 · z-[60]/z-[70] · z-[100] ·
9999 · 10000`) e diz "não inventar valores fora da escala". Fora dela:

- `z-30` — `FloatingRefresh.svelte:18`, `SignaturePad.svelte:362`,
  `SecaoHistorico.svelte:389,547,603`
- `z-20` — `SignaturePad.svelte:439`

Nenhum colide hoje (todos são locais, abaixo do `z-40` da topbar). É higiene:
encaixar em `z-10` ou documentar `z-20`/`z-30` como degraus válidos.

## VIS-10 — 3 tabelas fora do par `table` + `table-wrap`

O README manda `<div class="table-wrap"><table class="table">`. Fogem disso:

- `auditoria/+page.svelte:408` e `auditoria/logs/+page.svelte:223` — usam
  `<table class="w-full text-sm">` dentro de um wrapper `overflow-x-auto`
  montado à mão;
- `auditoria/+page.svelte:713` — `<table class="w-full text-xs">` dentro de
  `overflow-hidden` (é o terceiro site de **VIS-3**).

Funcionam (o scroll está lá, exceto no terceiro), mas sem `class="table"`
não recebem o estilo de `thead`/bordas/padding do tema — as telas de
auditoria têm tabelas visivelmente diferentes de `/painel` e `/recebidos`.

`solicitacoes/+page.svelte:66` e `perfil/+page.svelte:354` usam
`class="table"` com `overflow-x-auto` manual: só o wrapper está fora do
padrão.

## VIS-11 — `will-change` em todos os `<div>` do `LoadingOverlay`

`src/lib/components/LoadingOverlay.svelte:68-72`:

```css
div {
	will-change: backdrop-filter;
}
```

É o único bloco `<style>` do projeto com seletor de elemento nu (os outros 10
usam classes). O Svelte escopa por classe, então isso vira
`div.svelte-xxx { … }` e atinge os **4** `<div>` do componente — não só o que
tem `backdrop-blur-sm`. Os outros 3 ganham camada de composição própria sem
ter filtro nenhum.

O overlay é o que aparece durante operações de API, e é `{#if active}`, então
o custo existe só enquanto visível. Ainda assim: o elemento que precisa já
tem `backdrop-filter`, o que basta para o Chrome promovê-lo.

**Correção:** apagar o bloco `<style>`, ou restringi-lo a uma classe no div
do backdrop.

---

## Verificado e correto

Medido, não presumido — inclui coisas que levantei como suspeita e a medição
descartou:

- **Svelte 5 integral.** Zero `export let`, zero `$:`, zero `on:evento`, zero
  `createEventDispatcher`, zero `<slot>`, zero `writable()`. 106 componentes
  em runes + snippets.
- **`svelte-check`: 0 erros, 0 avisos** em 6.491 arquivos. `eslint --max-warnings 0`
  passa limpo. `npm run build` verde.
- **Zero cores cruas do Tailwind.** Nenhum `text-red-500`/`bg-indigo-600` em
  106 arquivos — 100% pelos 7 canais do tema. Nenhum shade inexistente
  (a armadilha citada no `CLAUDE.md` não reincidiu).
- **Modais: só 2 overlays caseiros**, e os dois legítimos — `LoadingOverlay`
  (não é diálogo; tem `aria-busy` + `aria-live`) e o backdrop da sidebar
  (é um `<button>` com `aria-label="Fechar menu"`). Todos os ~39 diálogos
  reais usam o `Dialog` do Skeleton, então foco/ESC/ARIA vêm de graça. Minha
  primeira varredura ("34 modais sem `role=dialog`") era falso positivo.
- **Nenhum `<Dialog>` aninhado sob ancestral com `backdrop-filter`/`transform`**
  — não há o bug clássico de `position:fixed` capturado por containing block.
- **`focus:outline-none` sempre com substituto visível.** Verifiquei os 12:
  10 têm `focus:ring-*` no próprio elemento, `SearchableSelect.svelte:149` tem
  `focus-within:ring-1` no `Combobox.Control`, e `conf-ass:287` é `disabled`
  (não focável). A regra do README está sendo cumprida.
- **Nenhum conflito de utilitários Tailwind** no mesmo `class=` (display,
  overflow, position, font-size, weight, align, flex-direction, items,
  justify, rounded) — 0 em 106 arquivos. O único conflito real é o VIS-3,
  que envolve um `@utility` do Skeleton e por isso escapa desse teste.
- **A sintaxe legada `!classe` funciona no Tailwind v4.** Cheguei a marcar as
  66 ocorrências (`!py-4`, `!px-4`, `!text-center`, `!bg-transparent`) como
  possíveis no-ops, já que a v4 moveu o modificador para o sufixo. O CSS
  compilado tem `.\!py-4{padding-block:…!important}` — compila. É estilo
  legado, não defeito.
- **Todas as `<img>` têm `alt`** descritivo em português.
- **Tipografia bem resolvida:** Inter/Outfit self-hosted via `@fontsource`,
  subset latin, `font-display: swap`, com `<link rel="preload" crossorigin>`
  para os dois pesos de dobra (`+layout.svelte:236-237`).
- **`prefers-reduced-motion` global** (`app.css:63-77`), cobrindo transições
  do Svelte, animações do Tailwind e smooth-scroll.
- **`100dvh` nos modais** — os 18 painéis usam `max-h-[calc(100dvh-2rem)]`,
  não `vh`. (As 7 páginas com `min-h-screen` usam `min-h-`, que cresce; não é
  o bug do `h-screen` em mobile.)
- **Chunking manual coerente** com os comentários do `vite.config.ts`: `app.css`
  = 208 kB / **25 kB gzip**, e Skeleton/zag ficam fora do `vendor` de propósito.

---

## Ordem sugerida

1. **VIS-2** e **VIS-3** — 4 linhas no total, bugs visíveis, sem discussão de
   design. Podem ir hoje.
2. **VIS-4** — 2 linhas em `theme.css`, mas muda a cor de rótulo de 48 botões:
   é decisão de design, não de código.
3. **VIS-1** — corrigir a regra do README primeiro, migrar depois. Commit
   isolado (toca quase todo `.svelte`).
4. **VIS-6 + VIS-7** juntos — um passe de ícones: migrar para `@lucide/svelte`
   e trocar os 7 SVGs mais repetidos.
5. **VIS-5** — o `<ModalShell>`; maior refatoração da lista, e a que mais
   reduz superfície futura.
6. **VIS-8/9/10/11** — higiene, oportunisticamente.

Nada aqui bloqueia deploy.

---

## Revarredura de acompanhamento — 02/ago/2026

Esta seção é uma atualização do snapshot de 29/jul, não uma reescrita dos
achados originais. A revisão foi estática: leitura do fonte, consultas
reproduzíveis com `rg` e `svelte-check`. Não foram feitas novas medições em
Chromium; portanto, números de contraste, CSS compilado e viewport das seções
acima continuam sendo os da auditoria original.

### Método e baseline atual

- `npm run check`: **0 erros e 0 avisos**;
- todos os 33 arquivos `src/routes/**/+page.svelte` foram confrontados com
  a presença de `<title>` próprio;
- foram recontadas ocorrências nos `.svelte` do `src/`, sem incluir
  dependências ou artefatos gerados;
- a documentação oficial do SvelteKit para acessibilidade foi consultada:
  navegações de cliente são anunciadas a partir de `<title>`, portanto cada
  página precisa de título único e descritivo.

### Correções confirmadas

#### VIS-2 — corrigido

`src/app.html:19` agora usa:

```html
selection:text-surface-950 dark:selection:text-primary-100
```

O comentário imediatamente acima conserva a razão e os valores medidos no
achado original. A correção é exatamente a recomendação de VIS-2.

#### VIS-3 — corrigido

Os três locais citados não combinam mais `table-wrap` com
`overflow-hidden`:

- `src/routes/painel/+page.svelte:587`;
- `src/routes/recebidos/+page.svelte:440`;
- `src/routes/auditoria/+page.svelte:713-715` (agora `overflow-x-auto`).

Os dois primeiros preservam um comentário que explica a precedência de
`overflow:auto` do Skeleton; o terceiro explica por que a tabela de valores
longos precisa de scroll. Remover VIS-3 da fila de implementação.

### VIS-12 — 5 páginas herdam o título genérico do layout

**Severidade: Média (acessibilidade e orientação).**

O layout raiz sempre fornece `<title>Escalas de Plantão Policial</title>`.
Isso é um fallback adequado, mas cinco das 33 páginas não o sobrescrevem:

- `src/routes/+page.svelte`;
- `src/routes/escalas/[id]/+page.svelte`;
- `src/routes/policiais/upload/+page.svelte`;
- `src/routes/policiais/[id]/+page.svelte`;
- `src/routes/produtividade/+page.svelte`.

Em navegação cliente, o SvelteKit usa o conteúdo de `<title>` para anunciar a
mudança de página aos leitores de tela. Nesses cinco destinos a rota muda,
mas o anúncio permanece “Escalas de Plantão Policial”, que não diferencia
início, escala individual, importação, edição de policial e produtividade.
Isso também deixa a aba do navegador e o histórico menos informativos.

**Correção mínima:** cada página deve declarar `<svelte:head><title>…</title>
</svelte:head>`. Onde o dado já existe no `load`, preferir título específico
e seguro, por exemplo “Escala — Escalas PC-CE” ou “Editar policial — Escalas
PC-CE”; não incluir CPF, matrícula ou outro dado pessoal no título. O layout
continua como fallback para erros e rotas futuras.

Referência: [SvelteKit — Accessibility: route
announcements](https://svelte.dev/docs/kit/accessibility#Route-announcements).

### VIS-13 — sidebar móvel deixa elementos invisíveis no fluxo de foco

**Severidade: Alta (navegação por teclado).**

Em telas menores que 900px, `src/routes/+layout.svelte:369-381` fecha a
sidebar apenas com `translate-x-full`. Os links continuam no DOM e focáveis;
`sidebarOpen` começa em `false` (`:97`), mas o `<aside>` não recebe `inert`,
`aria-hidden` ou remoção condicional. O conteúdo da página também continua
focável quando o backdrop é exibido (`:358-366`).

O impacto é global nas rotas autenticadas em mobile: com o menu fechado, Tab
alcança links que não estão visíveis; com o menu aberto, Tab pode escapar para
o conteúdo encoberto. O scroll lock atual não corrige a ordem de foco.

**Correção mínima:** no mobile, tornar a sidebar inerte quando fechada. Ao
abrir, mover o foco para o menu, impedir a interação do conteúdo principal
enquanto o backdrop estiver ativo e restaurar o foco ao botão “Menu” ao
fechar. A solução precisa preservar o comportamento desktop, onde a sidebar é
sempre visível.

### VIS-14 — não há atalho para pular a navegação lateral

**Severidade: Média (navegação por teclado).**

O menu global começa em `src/routes/+layout.svelte:411`, enquanto o conteúdo
principal só começa em `:708`. Não há link `href="#..."` no código. Assim,
quem navega por teclado precisa percorrer a sidebar inteira a cada página.

**Correção mínima:** inserir antes da navegação um link “Pular para o
conteúdo”, inicialmente `sr-only` e visível quando recebe foco, apontando para
`id="conteudo-principal"` no `<main>`. A âncora precisa estar presente tanto
no layout com sidebar quanto nas telas de portão que usam o outro `<main>`.

### VIS-15 — `SearchableSelect` não expõe nome acessível ao campo focável

**Severidade: Média (formulários e leitores de tela).**

`src/lib/components/SearchableSelect.svelte:29-55` aceita `id`, mas aplica
esse valor apenas ao `<input type="hidden">` em `:132`. O controle focável
real (`Combobox.Input`, `:148-150`) não recebe `id`, `aria-label` nem
`aria-labelledby`. Logo, um `<label for>` de um consumidor não nomeia a
combobox que o usuário realmente opera.

Há 25 usos do componente. A revisão dos consumidores encontrou pelo menos 20
com rótulo visual em `span`/`div`, sem associação semântica — entre eles os
filtros de `/painel`, `/escalas` e `/recebidos`, além de formulários GISE.
Leitores de tela podem anunciar uma caixa de busca sem informar se ela filtra
unidade, mês, policial ou outro campo.

**Correção mínima:** expor `label` ou `ariaLabel` como prop, aplicá-la a
`Combobox.Input`, e encaminhar o `id` ao elemento focável. Nos usos com rótulo
visual, preferir `<label for>` ou `aria-labelledby`; somente controles cujo
contexto já seja inequívoco devem usar `aria-label`.

### VIS-16 — seis checkboxes de seleção não têm rótulo acessível

**Severidade: Média (listas e tabelas operáveis por leitor de tela).**

Foram confirmados controles sem `<label>` ou `aria-label` em:

- `src/routes/recebidos/+page.svelte:504-509`;
- `src/routes/escalas/[id]/_components/TabelaPlantao.svelte:206-217`;
- `src/routes/escalas/[id]/_components/TabelaServidores.svelte:253-259`,
  `339-350` e `533-539`;
- `src/routes/escalas/[id]/_components/ListaFds.svelte:477-483`.

Visualmente, a linha próxima contém o nome ou a lotação. Esse contexto não é
nome programático do checkbox, portanto não informa com segurança qual pessoa
ou escala será marcada.

**Correção mínima:** adicionar nomes específicos, como “Selecionar
{p.nome}”, “Selecionar todos os servidores” e “Marcar escala de
{escala.lotacao} como vista”. Não usar rótulos genéricos como “Selecionar” em
listas repetidas.

### VIS-17 — recorte de rubrica por imagem só funciona com ponteiro

**Severidade: Média (acessibilidade do fluxo de assinatura).**

`src/lib/components/ModalCadastrarRubrica.svelte:377-392` implementa mover e
redimensionar a área de recorte exclusivamente com seis handlers de ponteiro:
`onpointerdown`, `onpointermove` e `onpointerup`. As regiões foram marcadas
como `role="presentation"` e não são focáveis. Não há alternativa de teclado
para atualizar `cropX`, `cropY`, `cropW` e `cropH`.

Uma pessoa que usa apenas teclado ou tecnologia assistiva consegue enviar a
imagem, mas não consegue enquadrar a rubrica antes de confirmar.

**Correção mínima:** manter o arraste para ponteiro e adicionar controles
focáveis (ranges ou inputs numéricos) para posição horizontal/vertical e
largura/altura do recorte. Cada controle deve ter label e faixa limitada, com
o preview permanecendo sincronizado.

### Correções implementadas em 02/ago

O primeiro pacote global foi implementado e passou em `npm run check`
(0 erros/avisos) e `npm run test` (680/680).

- **VIS-12:** as cinco rotas agora declaram títulos próprios, estáveis e sem
  dado pessoal: Início, Escala, Importar policiais, Editar policial e
  Produtividade.
- **VIS-13:** a sidebar móvel fechada recebe `inert`; ao abrir, o foco vai
  para a navegação; o conteúdo principal, o atalho de salto e a barra móvel
  ficam inertes enquanto ela funciona como modal; Escape, botão de fechar,
  backdrop e navegação restauram o foco ao botão Menu. O scroll lock agora só
  atua no estado modal móvel.
- **VIS-14:** o link “Pular para o conteúdo” aponta para
  `#conteudo-principal`, que existe tanto no layout autenticado quanto no
  caminho sem sidebar.
- **VIS-15:** `SearchableSelect` agora encaminha `id` ao `Combobox.Input`
  focável, em vez do campo oculto. Os 19 usos que não ficam dentro de um
  `<label>` recebem `ariaLabel` específico; os seis restantes preservam o
  nome nativo fornecido pelo `<label>` envolvente.
- **VIS-16:** os seis checkboxes de seleção passaram a anunciar a pessoa,
  a escala ou a seleção total a que se referem. O equivalente móvel de
  “escala vista” também recebeu o mesmo nome específico.
- **VIS-17:** o recorte de imagem mantém ponteiro e ganhou quatro ranges
  focáveis para posição horizontal/vertical e largura/altura. Os limites
  dinâmicos preservam a caixa dentro da imagem e a atualização usa function
  bindings para regenerar o preview com o valor recém-informado pelo teclado.
- **VIS-4:** os canais de contraste escuro dos níveis `tertiary` e `success`
  400/500 passaram a ser usados pelos presets preenchidos. Isso preserva os
  verdes existentes e eleva o texto sobre `-500` para 6,18:1 e 6,12:1.
- **VIS-1:** o README agora determina o par AA
  `text-surface-600 dark:text-surface-400` e proíbe `text-surface-500` em
  superfícies claras. A migração contextual cobre textos, labels, tabelas,
  abas, chips, estados vazios e mensagens de status. A busca atual encontra
  523 usos do par alvo. As 42 referências restantes a `text-surface-500`
  ficam limitadas a pares invertidos para fundo escuro, placeholders, estados
  desabilitados ou ícones — elementos gráficos cujo contraste mínimo é 3:1,
  já atingido pelo tom.
- **VIS-6:** `lucide-svelte` foi removido em favor de
  `@lucide/svelte` (1.28.0). Os 28 imports nomeados foram migrados sem mudar
  suas APIs; `rg` não encontra mais o pacote deprecado no fonte. O README foi
  atualizado no mesmo lote.
- **VIS-7 (escopo prioritário):** os 54 SVGs estáticos das sete famílias mais
  repetidas foram convertidos para Lucide em 29 componentes, preservando
  classes, tamanhos e eventos. Ícones decorativos agora também declaram
  `aria-hidden="true"`. Permanecem SVGs fora deste escopo — logos, gráficos,
  QR, ícones com cor dinâmica e renderizadores que recebem `path` como string
  — para migração oportunista ou uma refatoração própria de API.
- **VIS-5 (primeiros lotes):** `ModalShell.svelte` passou a concentrar o
  `Dialog` acessível, backdrop, larguras, famílias de painel, rodapé, camadas,
  `Portal` e bloqueio de dismiss durante `pending`. Foram migradas 24 das 43
  instâncias originais, incluindo confirmações de escala, unidades, e-mail,
  quatro diálogos inline de `/escalas`, rubrica, assinatura e os dois portais
  sob o slider de presença. Um E2E específico confirmou foco inicial,
  restauração de foco, Escape, backdrop e bloqueio durante request pendente; o
  teste revelou e corrigiu a interceptação de clique pelo `Positioner`.

Ainda falta a validação manual em viewport menor que 900px, com teclado e
leitor de tela, antes de classificar VIS-13 como totalmente encerrado.

### Achados ainda abertos, recontados

As contagens abaixo são um novo snapshot; não devem substituir silenciosamente
as medições originais, que foram feitas em 29/jul.

| Achado | Estado em 02/ago | Evidência atual |
| --- | --- | --- |
| VIS-1 | implementado; validação visual pendente | 523 usos do par AA para texto normal; as 42 referências residuais a `text-surface-500` são invertidas, placeholders, disabled ou ícones com contraste gráfico suficiente |
| VIS-4 | implementado; validação visual pendente | os quatro canais 400/500 agora usam contraste escuro; build e testes verdes; inspecionar amostra dos 48 usos em claro/escuro |
| VIS-5 | implementado no escopo canônico (12/ago) | confirmações e formulários restantes migrados (`ModalExcluirGise`, `ModalCadastrarPolicial`, confirm de restaurar em `ConfigurarFormulario`); restam só as exceções estruturais documentadas (as 9 originais + wizard `ModalCriarGise`) |
| VIS-6 | implementado | `@lucide/svelte` 1.28.0 é a única dependência Lucide; 28 imports foram migrados e não há specifier antigo no fonte |
| VIS-7 | implementado no escopo prioritário | as sete famílias repetidas não têm mais SVG estático inline; restam 125 `<svg>` de logos, gráficos, QR, ícones dinâmicos e demais legado fora do lote |
| VIS-8 | implementado | brasão público com `width`/`height` 200×200; rubricas com proporção 2,5:1 (ou dimensões do recorte); preview do cadastro declara `width`/`height` + `aspect-ratio` |
| VIS-9 | implementado | README admite `z-20`/`z-30` para overlays locais e FABs; popovers portados de `SecaoHistorico` sobem a `z-50` (camada de portal); `FloatingRefresh` e overlays internos do `SignaturePad` permanecem nos degraus locais documentados |
| VIS-10 | implementado | `auditoria` (+ nested de alterações), `auditoria/logs`, `solicitacoes` e `perfil` usam `table-wrap` + `class="table"` |
| VIS-11 | implementado | bloco `<style>` com `will-change` em todo `div` removido de `LoadingOverlay.svelte`; o `backdrop-blur-sm` do overlay basta para promover a camada |

As exceções estruturais de VIS-5 permanecem explícitas e registram a
decisão no próprio componente: logout global (`+layout`), `DialogInfo`, wizard
`ModalNovaEscala`, calendário `ModalDatasHoras`, `ModalDownloadExtras`,
`ModalBreveRelatorio`, os três diálogos da máquina de ações de RH em
`PainelAcoesServidor`, e o wizard de calendário `ModalCriarGise` (mesmo motivo
de `ModalNovaEscala`). Os candidatos canônicos de confirmação/formulário
(recebidos, painel, policiais, CRUD GISE, restaurar modelo em `/res-gise`)
foram migrados até 12/ago; não exigiram ampliar a API do primitive.

### Ordem revisada

1. **VIS-5** — **FEITO 12/ago.** Candidatos canônicos restantes migrados
   (`ModalExcluirGise`, `ModalCadastrarPolicial`, confirm de restaurar em
   `ConfigurarFormulario`); `ModalCriarGise` documentado como exceção de
   wizard. As demais exceções estruturais seguem explícitas.

VIS-1 a VIS-6, VIS-8 a VIS-12 e VIS-14 a VIS-17 não pertencem mais à
fila de implementação. VIS-7 segue como higiene oportunística para o legado
fora do escopo prioritário. VIS-1 e VIS-4 aguardam amostragem visual em
claro/escuro; VIS-13, a validação manual de foco em viewport móvel.

---

## Plano de uniformização de layout e interação

**Objetivo:** reduzir variações visuais e comportamentais sem forçar
componentes artificialmente genéricos. Para uma mesma intenção do usuário, o
sistema deve apresentar o mesmo componente, rótulo, ordem, estado de foco e
feedback; diferenças só são aceitáveis quando representam uma diferença
semântica, de risco ou de contexto comprovada.

Este plano complementa os achados VIS. Ele não autoriza substituir classes ou
componentes em massa sem primeiro definir o padrão e preservar os fluxos
críticos de autenticação, assinatura e documentos.

### Princípios de decisão

1. **Semântica antes de aparência.** “Excluir” é destrutivo e não deve parecer
   nem se comportar como “Salvar”, ainda que ambos sejam botões.
2. **Mesma intenção, mesmo contrato.** “Cancelar”, “Voltar”, “Baixar PDF” e
   “Editar” devem ter rótulo, ícone, ordem, confirmação e estado desabilitado
   previsíveis em todas as telas.
3. **Componente compartilhado só para regra compartilhada.** Se duas telas
   diferem em autorização, ciclo de vida, conteúdo jurídico ou fluxo de
   formulário, manter componentes separados e documentar a diferença.
4. **Tokens antes de migração.** Nenhuma tela deve ser migrada para uma
   convenção que ainda não tem escala tipográfica, variantes e exemplos
   definidos.
5. **Acessibilidade faz parte do padrão.** Foco visível, nome acessível,
   teclado, contraste, ordem de tabulação e estado `disabled` são requisitos
   de cada primitive, não uma revisão posterior.
6. **Uma fonte de verdade.** Não duplicar o mesmo shell de modal, estilo de
   botão ou regra de layout em dezenas de componentes. VIS-5 é a referência
   de risco já comprovada.

### Catálogo canônico a definir antes das migrações

O catálogo deve ficar em documentação viva e ter dono técnico. Cada item
precisa definir API, variantes permitidas, estados, comportamento de teclado,
exemplos e contraexemplos.

| Família | Contrato mínimo | Variantes permitidas |
| --- | --- | --- |
| Botão de ação | `type`, texto/nome acessível, ícone decorativo, foco, loading e bloqueio contra duplo clique | principal, secundário, discreto, destrutivo |
| Botão de ícone | `aria-label` obrigatório, área de toque consistente, tooltip quando útil | editar, excluir, baixar, fechar, atualizar |
| Link de navegação | usa `<a>`, não simula botão; rota, estado ativo e preloading consistentes | menu, voltar, ação inline |
| Modal/diálogo | foco, Escape, backdrop, z-index, largura, altura móvel, rodapé e ações em ordem fixa | pequeno, médio, largo, empilhado |
| Campo de formulário | label associado, ajuda/erro, estado obrigatório, desabilitado e tamanho | texto, select, busca, data, toggle, upload |
| Tabela/lista | wrapper responsivo, cabeçalho, densidade, estado vazio, ações e seleção acessíveis | desktop+cards mobile quando necessário |
| Card e estado vazio | raio, padding, título, ação primária e ilustração/ícone coerentes | informativo, sucesso, alerta, erro |
| Feedback | toast, alerta inline, loading e confirmação destrutiva com semântica consistente | sucesso, informação, aviso, erro |

Os componentes compartilhados pertencem a `src/lib/components/`; peças de uma
única rota permanecem no respectivo `_components/`. Em Svelte, as APIs novas
devem usar runes e snippets, conforme as diretrizes do projeto.

### Matriz de ações equivalentes

Antes de alterar UI, criar e manter uma matriz com todos os usos das ações
abaixo. Ela identifica nome, ícone, variante, ordem, confirmação, destino e
arquivo de cada ocorrência.

| Intenção | Padrão proposto | Não aceitar |
| --- | --- | --- |
| Salvar / Confirmar | ação principal, à direita no desktop; loading impede reenvio | “Salvar”, “OK” e ícone sem texto para a mesma operação |
| Cancelar / Fechar | ação secundária; não submete formulário | botão primário visualmente indistinto de salvar |
| Excluir / Revogar / Desfinalizar | variante destrutiva e confirmação contextual | ação destrutiva silenciosa ou rotulada apenas “Sim” |
| Editar | ícone/lótulo com nome acessível e mesma posição na linha/card | lápis, texto ou menu sem critério por tela |
| Baixar / Exportar | ícone e rótulo do formato; usar estado de carregamento | âncora improvisada e nomes genéricos “Download” |
| Voltar | link/navegação, preservando histórico quando aplicável | botão de submit que simula navegação |
| Filtrar / Limpar filtros | controles identificados, resumo de filtros ativos e limpeza previsível | selects sem label ou filtros que mudam a página sem feedback |

Uma exceção precisa registrar na matriz: arquivo, motivo, responsável e data
de revisão. “Já estava assim” não é justificativa.

### Escala tipográfica e de espaçamento

Definir uma escala curta e utilizá-la em vez de combinações livres de
`text-*`, `p-*`, `gap-*`, `rounded-*` e `shadow-*`.

| Papel | Uso | Regra de consistência |
| --- | --- | --- |
| Título de página (`h1`) | objetivo principal da rota | um por tela, mesmo peso e faixa responsiva |
| Título de seção (`h2`) | agrupamentos da página | abaixo de `h1`, nunca usado apenas para obter tamanho |
| Título de card (`h3`) | conteúdo autônomo dentro da seção | não competir visualmente com `h2` |
| Corpo | instruções, conteúdo e descrição | contraste AA e largura legível |
| Auxiliar | metadados, ajuda, data, contagem | não usar tom abaixo do contraste mínimo de VIS-1 |
| Ação/controle | botão, label e célula acionável | mesma altura e tamanho de texto por densidade |

Também definir tokens para:

- espaçamento vertical entre página, seção, card e controles;
- padding de card e modal em mobile e desktop;
- raio e sombra por superfície;
- largura máxima de conteúdo e breakpoints;
- densidade de tabelas e listas;
- camadas de `z-index`, em complemento a VIS-9.

O padrão deve usar os canais de tema existentes, não cores cruas. VIS-1 e
VIS-4 precisam ser resolvidos antes de transformar uma classe de contraste
insuficiente em token “oficial”.

### Execução em fases

#### U0 — Baseline e inventário

1. Capturar screenshots desktop e mobile das rotas críticas: login, painel,
   escalas, detalhe de escala, GISE, formulário/relatório GISE, perfil,
   validação pública e assinatura.
2. Inventariar as ocorrências das famílias do catálogo e preencher a matriz de
   ações equivalentes.
3. Contar variantes de classes e componentes por família; registrar o
   baseline, não uma meta de “menos classes”.
4. Associar cada entrada aos VIS existentes, especialmente VIS-5 a VIS-17.

#### U1 — Especificação do sistema visual

1. Escolher nomes, variantes e contratos do catálogo.
2. Documentar a escala tipográfica, espaçamento, superfícies, breakpoints e
   ordem de ações.
3. Atualizar o README como documento vivo com a regra de uso, não apenas
   comentários em CSS.
4. Revisar a especificação com produto/design e acessibilidade antes de criar
   abstrações.

#### U2 — Primitives compartilhadas

1. Implementar ou consolidar primitives uma por vez, com testes de
   comportamento e exemplos dos estados críticos.
2. Começar pelo `ModalShell` de VIS-5, pois ele reduz a maior duplicação
   visual já medida.
3. Criar componentes de ação somente depois que a matriz determinar as
   variantes necessárias; não introduzir um “Button” com dezenas de props
   para casos que não compartilham comportamento.
4. Incorporar desde o início as correções de VIS-13 a VIS-17 nos componentes
   afetados.

#### U3 — Migração por domínio

Migrar em PRs pequenos e independentes, nesta ordem:

1. shell global, navegação, títulos e acessibilidade de foco;
2. formulários e filtros compartilhados;
3. modais e confirmações;
4. tabelas/listas e ações de linha;
5. assinatura e documentos, com atenção reforçada a regressão;
6. páginas administrativas e dashboards.

Cada PR deve migrar uma família ou domínio inteiro. Não deixar metade dos
botões “Salvar” no padrão antigo e metade no novo sem um plano de conclusão.

#### U4 — Regressão e prevenção

1. Comparar screenshots com o baseline nas larguras mobile e desktop.
2. Executar `npm run check`, lint e os testes afetados.
3. Para mudanças em assinatura, PDF ou e-mail, executar os respectivos
   goldens antes e depois, sem regravá-los por conveniência.
4. Adicionar checks de PR para impedir novas variantes fora do catálogo quando
   uma regra estável e de baixo falso positivo for possível.
5. Revisar o inventário após cada lote e remover apenas as exceções que foram
   efetivamente migradas.

### Critérios de aceite

Uma fase só está concluída quando:

- [ ] toda ação equivalente do domínio está na matriz e segue o padrão ou tem
  exceção justificada;
- [ ] título de página, títulos de seção, corpo e auxiliar usam a escala
  definida;
- [ ] botões e inputs têm foco, teclado e nome acessível adequados;
- [ ] nenhuma nova cor, tamanho, sombra, raio ou `z-index` fora dos tokens foi
  introduzido;
- [ ] mobile e desktop foram comparados visualmente em cada rota alterada;
- [ ] testes, `npm run check` e lint foram registrados;
- [ ] documentação viva mudou no mesmo PR quando o padrão público mudou.

### Registro por lote

Cada PR de uniformização deve registrar:

```md
## UNI-<domínio>-<NNN>

**Família:** botão | modal | formulário | tabela | tipografia | navegação
**Rotas afetadas:** ...
**Padrão adotado:** link para o catálogo/matriz
**Exceções mantidas:** arquivo + justificativa
**VIS tratados:** ...
**Screenshots comparados:** desktop/mobile, antes/depois
**Verificação:** comandos e resultado
```

O sucesso não é ter componentes “iguais” em toda parte. É tornar a intenção
do sistema previsível para usuários e mantenedores, preservando diferenças
que representam regras reais do negócio.
