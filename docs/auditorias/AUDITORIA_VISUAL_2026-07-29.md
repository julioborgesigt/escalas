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
