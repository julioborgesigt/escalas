# Auditoria Visual & UX — 2026-07-11

> **Data:** 2026-07-11
> **Escopo:** todos os elementos visuais do app — design tokens, tipografia, cores, superfícies/cards, modais, botões, ícones, spinners, tabelas responsivas, estados de foco, contraste, breakpoints e z-index. 96 arquivos `.svelte` analisados (rotas + `$lib/components`).
> **Método:** leitura do design system (`theme.css`, `app.css`, `+layout.svelte`), varredura por grep com contagens reais em todo o `src/`, e verificação manual dos achados citados. Números são **medidos no repositório**, não estimados.
> **Relação com auditorias anteriores:** este documento re-mede os achados V-1…V-11 da `AUDITORIA_VISUAL.md` (2026-06-10) e adiciona achados novos (prefixo **UX-**). Como toda auditoria em `docs/auditorias/`, é um registro histórico — não reflete o estado após correções futuras.

---

## 1. Veredito geral

A fundação continua **forte**: tema único em oklch com tokens de contraste por tom, dark mode com cobertura quase total, `prefers-reduced-motion` global, modais 100% sobre o `Dialog` do Skeleton (foco/ARIA de graça), tabelas com padrão duplo disciplinado (tabela desktop + cards mobile) e utilitários de glass card centralizados no `app.css` (V-6 ✔ resolvido).

O problema é que **a dívida de micro-decisões voltou a crescer com o código novo**. A micro-tipografia, que a auditoria de junho tinha reduzido para 10 tamanhos/199 usos, está hoje em **12 tamanhos / 408 usos** — incluindo uma família nova inteira em pixels (`text-[8px]`…`text-[11px]`, 68 usos) que não existia. Superfícies elevadas usam **9 combinações** claro/escuro diferentes. E os dois achados de acessibilidade mais sérios são novos: **foco de teclado invisível nos switches de `/conf-ass`** e **texto pequeno em `text-surface-400` (~3:1 de contraste) no tema claro** em 141 pontos.

Nada quebra a experiência hoje; mas sem uma régua escrita (tokens de texto pequeno no `@theme`, um componente `ModalShell`, uma escala de z-index) cada feature nova reabre as mesmas frentes.

---

## 2. O que está sólido (não mexer — replicar)

| Padrão | Evidência medida | Observação |
| --- | --- | --- |
| **Mecânica de modal** | 31/31 arquivos de modal usam `Dialog` do Skeleton (`Dialog.Title`, `Dialog.Description`, `CloseTrigger`) | Foco, ESC e ARIA resolvidos pela lib — nenhum modal "na mão" |
| **Tabelas responsivas** | 6/7 arquivos com `<table>` seguem `hidden md:block table-wrap` + cards `md:hidden` no mobile | Único fora do padrão: `policiais/upload` (UX-6) |
| **Glass cards** | `@utility card-glass` / `card-glass-auth` centralizados em `app.css` | V-6 da auditoria anterior — **resolvido** |
| **Cores fora da paleta** | Restam **11 ocorrências** de `indigo`/`teal`, todas em `src/routes/bem-vindo/+page.svelte` | V-3 quase resolvido — era espalhado, hoje é 1 arquivo |
| **Reduced motion** | Bloco global em `app.css` + guard em view transitions do layout | ✓ |
| **Semântica de botão** | `preset-filled-primary-500` (114×) para CTA, `preset-filled-error-500` (26×) destrutivo, `preset-outlined-surface-500` (88×) cancelar | Convenção respeitada no código novo também |
| **Fontes** | Self-hosted, subset latin, preload dos 2 pesos críticos com `crossorigin` | Excelente |
| **Spinner acessível** | `Spinner.svelte` com `aria-label="Carregando"` via `Progress` | Só precisa ser adotado em todo lugar (UX-5) |

---

## 3. Achados — do mais ao menos impactante

### UX-1 · A11y: foco de teclado invisível nos switches de `/conf-ass`

Os 4 toggles de `src/routes/conf-ass/+page.svelte` (linhas ~198, 225, 269, 297) declaram `focus:outline-none` **sem nenhum substituto visual** (`focus-visible:ring` etc.):

```
class="relative inline-flex h-6 w-11 ... focus:outline-none {ativo ? 'bg-primary-500' : ...}"
```

Um usuário navegando por Tab não tem como saber qual switch está focado. A semântica ARIA está correta (`role="switch"`, `aria-checked`, `aria-label`) — só falta o anel de foco. Contraste com os padrões corretos já presentes no repo:

- `SearchableSelect.svelte:168` — `focus-within:ring-1 ring-primary-400/30` no container (o `outline-none` do input interno é legítimo);
- `SecaoHistorico.svelte` e `/validar` — `focus:ring-2 ring-primary-500/25` substituindo o outline.

**Correção:** trocar `focus:outline-none` por `focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2` nos 4 switches. Aproveitar para extrair um componente `Switch` — os 4 são copy-paste idênticos.

### UX-2 · A11y/contraste: `text-surface-400` para texto informativo no tema claro (141 usos sem par `dark:`)

`--color-surface-400` é `oklch(71% …)` — sobre fundo branco rende **≈2,9:1**, abaixo dos 4,5:1 (WCAG AA texto normal) e até dos 3:1 de texto grande. Há **141 usos de `text-surface-400` sem par `dark:`**, ou seja, o mesmo cinza claro é servido nos dois temas. No tema escuro está ótimo; no claro, combinado com os tamanhos minúsculos do UX-3 (ex.: `text-[0.6rem] uppercase text-surface-400`), é o pior caso de legibilidade do app.

Nem todos os 141 são texto de leitura (parte são ícones decorativos e placeholders, onde é aceitável). **Regra sugerida:** texto que carrega informação usa no mínimo `text-surface-500 dark:text-surface-400` (surface-500 = 59% ≈ 4,6:1 no claro); `surface-400` fica reservado a ícones decorativos e placeholder.

### UX-3 · Regressão: micro-tipografia voltou a proliferar — 12 tamanhos, 408 usos (junho: 10/199)

Distribuição medida hoje:

| Classe | px | Usos | | Classe | px | Usos |
| --- | --- | ---: | --- | --- | --- | ---: |
| `text-[0.65rem]` | 10,4 | 132 | | `text-[0.58rem]` | 9,3 | 16 |
| `text-[0.6rem]` | 9,6 | 80 | | `text-[11px]` | 11 | 15 |
| `text-[0.7rem]` | 11,2 | 60 | | `text-[9px]` | 9 | 9 |
| `text-[10px]` | 10 | 43 | | `text-[0.62rem]` | 9,9 | 5 |
| `text-[0.55rem]` | 8,8 | 26 | | `text-[0.5rem]` | 8 | 3 |
| `text-[0.68rem]` | 10,9 | 18 | | `text-[8px]` | 8 | 1 |

Dois problemas distintos:

1. **Família nova em pixels** (68 usos de `text-[8px]`–`text-[11px]`) que a auditoria de junho não registrava — concentrada em `validar/[hash]` (23), `GiseSupervisao` (12), `conf-ass` (9), `recebidos` (8). Além de duplicar a família em rem, px ignora o zoom de fonte do usuário (rem escala com a preferência do browser; px não).
2. **O piso desceu para 8px** (`text-[0.5rem]`, `text-[8px]`, `text-[0.55rem]` = 30 usos) — ilegível para qualquer usuário, e esses casos são labels uppercase com `tracking-wider`, que piora ainda mais.

**Correção estrutural** (a mesma recomendada em junho, agora com mais urgência): definir 2 tokens no `@theme` do `app.css` —

```css
@theme {
	--text-2xs: 0.7rem;   /* labels, badges — piso confortável */
	--text-3xs: 0.625rem; /* metadados densos — piso absoluto */
}
```

— e migrar mecanicamente: `0.68–0.7rem`/`11px` → `text-2xs`; `0.55–0.65rem`/`8–10px` → `text-3xs`. Some 12 decisões por linha; nasce uma regra que o autocomplete oferece sozinho.

### UX-4 · Superfícies elevadas: 9 combinações claro/escuro para o "mesmo" card (212 usos)

Medição de `bg-* dark:bg-*` em cards/modais:

| Combinação | Usos | | Combinação | Usos |
| --- | ---: | --- | --- | ---: |
| `bg-white dark:bg-surface-900` | 59 | | `bg-surface-100 dark:bg-surface-900` | 24 |
| `bg-surface-50 dark:bg-surface-900` | 36 | | `bg-surface-50 dark:bg-surface-950` | 14 |
| `bg-surface-100 dark:bg-surface-800` | 31 | | `bg-surface-50 dark:bg-surface-800` | 13 |
| `bg-white dark:bg-surface-800` | 30 | | `bg-white dark:bg-surface-950` | 4 + 1 |

Na prática são todos "superfície elevada sobre o fundo da página", mas cada arquivo sorteia um par — modais irmãos têm fundos diferentes (`ModalConfirmar` usa `surface-100/900`, `DialogInfo` usa `surface-50/800`, o logout do layout usa `white/900`). O tema não define um token de superfície elevada.

**Correção:** criar `@utility card-elevated` (sugestão: `bg-white dark:bg-surface-900 border border-surface-200 dark:border-white/10`, o par mais usado) e um segundo nível `card-elevated-2` (`dark:bg-surface-800`) para elementos aninhados. Migrar oportunisticamente.

### UX-5 · Dois spinners convivendo

`Spinner.svelte` (baseado em `Progress` do Skeleton, com `aria-label`) é usado em 6 arquivos — mas **5 arquivos rolam o próprio SVG `animate-spin`** com visual diferente (círculo com arco `opacity-25/75`): `+layout.svelte` (botão de logout), `FloatingRefresh`, `GiseSupervisao`, `res-gise/FormularioServico`, `res-gise/+page`. Dois desenhos de "carregando" no mesmo produto, e os SVGs manuais não têm `aria-label`.

**Correção:** substituir os 5 SVGs por `<Spinner size="xs|sm" />` (o componente já aceita `class` para cor).

### UX-6 · Modais: mecânica unificada, pele fragmentada

Todos os modais usam `Dialog`, mas cada um redesenha backdrop, card e rodapé:

- **Backdrop** — canônico `bg-surface-950/80 backdrop-blur-sm` (32×) contra 7× `/50` sem blur, 7× `/40` sem blur, 4× `/80 blur-md`, e 1× cada de `/95 blur-xl`, `/90 blur-lg`, `/60`, `/40 blur-sm`. O escurecimento da tela varia visivelmente entre modais vizinhos.
- **Z-index do conteúdo** — `z-50`, `z-[60]`, `z-[70]`, `z-[100]` sem escala documentada (ver UX-9).
- **Rodapé** — o padrão `flex-col-reverse sm:flex-row sm:justify-end` (Cancelar à esquerda no desktop, embaixo no mobile) convive com variantes: `DialogInfo` põe Cancelar como terceira linha full-width; o logout do layout empilha destrutivo em cima de Cancelar.

**Correção estrutural:** um componente `ModalShell.svelte` (backdrop + card + slot de rodapé) usado por todos — `ModalConfirmar.svelte` já é 80% disso; é promovê-lo a shell genérico. Ganha-se consistência e um único lugar para ajustar backdrop/raio/z-index.

### UX-7 · Três linguagens de ícone (persistente desde junho)

- **SVG inline estilo Heroicons** — dominante (dezenas de arquivos; só `GiseSeccional` tem 24 `<svg>`); paths repetidos entre arquivos (o "X" de fechar aparece redesenhado em ao menos 5 lugares).
- **lucide-svelte** — 12 arquivos (o pacote já está no bundle).
- **Emoji como ícone** — 23 ocorrências restantes (📋 ✅ ⚠️ etc.), que renderizam diferente por SO e não respeitam a cor do tema.

O layout já mitiga com o dicionário `ICONE` local, mas ele não é compartilhável. **Correção:** decidir por lucide (já é dependência) e migrar oportunisticamente, começando pelos emojis e pelos ícones repetidos (fechar, check, alerta). Sem big-bang: regra "código novo usa lucide".

### UX-8 · Border-radius sem regra (persistente; tema define os tokens)

O tema fixa `--radius-base: 0.75rem` (= `rounded-xl`) e `--radius-container: 1rem` (= `rounded-2xl`). Medição: `rounded-xl` 259 + `rounded-2xl` 144 seguem o token; **320 usos fora** (`rounded-lg` 207, `rounded` 97, `rounded-md` 16) + `rounded-3xl` 39. Elementos aninhados menores podem legitimamente usar raio menor, mas hoje inputs irmãos na mesma tela alternam `rounded-lg`/`rounded-xl` (ex.: `GiseSupervisao` linha 620 vs `SecaoHistorico` linha 291).

**Regra sugerida (documentar no README):** container/card = `rounded-2xl`; botão/input/badge-retangular = `rounded-xl`; chips/pills = `rounded-full`; `rounded-lg` só para elementos ≤ 32px de altura. `rounded`/`rounded-md` não se usa mais.

### UX-9 · Escala de z-index ad hoc

Valores em uso: `z-0/10/20/30/40`, `z-50` (39×), `z-[60]`, `z-[70]`, `z-[100]`, `z-[9999]` (toasts) e `10000` (barra de progresso, CSS). Funciona hoje porque alguém memorizou a ordem — mas não há escala documentada, e o salto `50 → 60 → 70 → 100 → 9999` mostra que cada camada nova chutou um número "acima de tudo".

**Correção barata:** documentar a escala no `app.css` (`10 dropdown · 40 topbar mobile · 50 sidebar/modal · 60 modal-sobre-modal · 70 modal-crítico · 9990 loading-overlay · 9999 toast · 10000 nav-progress`) e, idealmente, expor como variáveis `--z-*` no `@theme`.

### UX-10 · Miscelânea (baixo impacto)

| Item | Medição | Nota |
| --- | --- | --- |
| `active:scale-95` | 110 de 398 botões (28%; junho: 12%) | A micro-interação está virando padrão de fato — ou adota no preset global, ou remove; metade-termo é o pior estado |
| Breakpoint `min-[400px]` | 22 usos | Merece virar `--breakpoint-xs: 400px` no `@theme` (`xs:`) |
| Breakpoint `min-[900px]` | 8 usos, todos no layout (sidebar) | Estrutural e deliberado — ok, mas documentar por quê 900 e não `lg` (1024) |
| Corte tabela→cards | `md:` (4×), `lg:` (1×, TabelaEscalas), `sm:` (1×, TabelaServidores) | Se for deliberado (nº de colunas), documentar; senão, uniformizar em `md:` |
| `policiais/upload` | 2 `<table>` sem `table-wrap`/fallback mobile | Única tabela que estoura horizontalmente no celular; envolver em `table-wrap` |
| `transition-all` | 242 usos (vs 115 `transition-colors`) | `transition-all` anima `width/height/layout` sem querer e custa mais; preferir a propriedade específica em código novo |
| Toast description | `opacity-75` + `text-xs` | Contraste ok por ser fundo invertido, mas revisar se descrição merece 75% |

---

## 4. Status dos achados de junho (V-1…V-11)

| Achado | Status em 2026-07-11 |
| --- | --- |
| V-1 micro-tipografia | **Regrediu** — 199→408 usos, 10→12 tamanhos, família px nova (ver UX-3) |
| V-2 três linguagens de ícone | **Persiste** — 23 emojis, lucide 12 arquivos, SVG inline dominante (UX-7) |
| V-3 cores fora da paleta | **Quase resolvido** — resta 1 arquivo (`bem-vindo`) |
| V-4 border-radius | **Persiste** (UX-8) |
| V-5 `active:scale-95` parcial | **Piorou em ambiguidade** — 12%→28% (UX-10) |
| V-6 glass card ad hoc | **Resolvido** — `@utility card-glass` em `app.css` |
| V-7 empty states | Não re-medido em detalhe; 9 arquivos com "nenhum … encontrado" sem componente comum |
| V-8 focus em botões | **Persiste + caso novo grave** nos switches de conf-ass (UX-1) |
| V-9 `/validar` dialeto próprio | **Persiste** — segue sendo a página com mais texto minúsculo (23 usos px) |
| V-10/V-11 misc/rotas novas | Parcial — rotas novas (`auditoria/logs`) seguem presets de botão, mas herdam `rounded-lg` misto |

---

## 5. Plano de ação sugerido

**Rodada 1 — correções de acessibilidade (horas, sem risco visual):**
1. UX-1: anel de foco nos 4 switches de `/conf-ass`.
2. UX-2: varrer os `text-surface-400` que marcam *texto informativo* no tema claro → `text-surface-500 dark:text-surface-400`.
3. UX-6 (parte): `table-wrap` nas 2 tabelas de `policiais/upload`.
4. Eliminar os 30 usos ≤ 8,8px (`0.5rem`/`0.55rem`/`8px`) subindo-os um degrau.

**Rodada 2 — sistematização (1–2 dias):**
5. UX-3: tokens `--text-2xs`/`--text-3xs` no `@theme` + migração mecânica dos 408 usos.
6. UX-4: `@utility card-elevated` (+`-2`) e migração dos modais.
7. UX-6: promover `ModalConfirmar` a `ModalShell` genérico; unificar backdrop no canônico `/80 blur-sm`.
8. UX-5: trocar os 5 SVGs `animate-spin` por `<Spinner />`.

**Rodada 3 — guia vivo (½ dia):**
9. Documentar no README: escala de raio (UX-8), escala de z-index (UX-9), regra de texto pequeno, regra de ícone (lucide para código novo), decisão sobre `active:scale-95`.
10. Registrar `--breakpoint-xs: 400px` no `@theme` e substituir os 22 `min-[400px]`.

---

## 6. Apêndice — contagens-resumo

```
Arquivos .svelte analisados ............ 96
Modais (todos via Skeleton Dialog) ..... 31
Botões <button> ........................ 398   (110 com active:scale-95)
Presets de botão ....................... preset-filled-primary-500 ×114 (líder)
Texto arbitrário pequeno ............... 408 usos / 12 tamanhos (8px–11,2px)
Superfícies bg-*/dark:bg-* ............. 212 usos / 9 combinações
Backdrops de modal ..................... 8 variantes (canônico /80 blur-sm ×32)
rounded-* .............................. xl 259 · lg 207 · 2xl 144 · full 116 · base 97 · 3xl 39 · md 16
z-index ................................ 0/10/20/30/40/50/[60]/[70]/[100]/[9999]/10000
focus:outline-none sem substituto ...... 4 (switches conf-ass) — demais têm ring
text-surface-400 sem par dark: ......... 141
Cores fora da paleta ................... 11 (1 arquivo: bem-vindo)
Emojis como ícone ...................... 23
Spinners manuais (animate-spin svg) .... 5 arquivos (Spinner.svelte existe)
Tabelas sem wrapper responsivo ......... 1 arquivo (policiais/upload)
```

---

## 7. Re-varredura pós-remediação — 2026-07-12

Varredura completa após a implementação das rodadas 1–3 e das decisões finais (1a/2a/3b/4b), medindo cada achado novamente.

### 7.1 Confirmado resolvido

| Achado | Medição em 12/jul |
| --- | --- |
| UX-1 foco | 2 `outline-none` restantes, ambos legítimos (input do SearchableSelect com `focus-within` no container; switch `disabled` de conf-ass) |
| UX-2 contraste | 34 `text-surface-400` sem par dark, todos intencionais (ícones, estados disabled/inativos, marca-d'água) |
| UX-3 micro-tipografia | **0** tamanhos arbitrários; 93 `text-2xs` + 312 `text-3xs` |
| UX-4 superfícies | `card-elevated`/`-2` adotado em 30 arquivos |
| UX-5 spinners | 1 `animate-spin` restante (FloatingRefresh — rotação de ícone de refresh, legítimo) |
| UX-6 backdrops | 33× canônico `/80 blur-sm` + 4× `blur-md` **todos em modais empilhados z-[60]/[70]** (conforme regra); demais hits de `/40 /50 /90 /95` são fundos de código/sidebar, não backdrops |
| 1a tato | regra global em `app.css`; 6 inline restantes em elementos custom fora de `.btn` (deliberados) |
| Botões-ícone | 0 sem `aria-label` |
| Formulários | login com `autocomplete` correto (`username`/`current-password`/`one-time-code`) |

### 7.2 Encontrado e corrigido nesta varredura

1. **23 emojis-ícone remanescentes** — a lista da migração 2a era incompleta. Migrados para lucide: painel (🟡→Clock, 🔴→XCircle, 🔕→BellOff, 🔍→Search, 🎉→PartyPopper), login (📧→Mail, 📬→Inbox, 🔑→KeyRound), recebidos (📥→Inbox), escalas (🗂️→Archive), SignaturePad (✋ removido de string de status) e os bullets de status de `/validar` (✓/✕/⚠/? → Check/X/AlertTriangle/HelpCircle, uniformizando as tríades). Varredura unicode ampla final: **0 pictogramas** em markup.
2. **6 páginas sem `<h1>`** — títulos eram `<h2>` (super-admin e 3 boas-vindas) ou `<span>` (EscalaCabecalho). Promovidos a `<h1>` mantendo as classes (zero mudança visual). Restante: escala FDS não tem texto-título (só badge) — aceito.
3. **V-3 encerrado** — as 12 últimas cores fora da paleta (`indigo`/`teal` em `bem-vindo`) migradas para `secondary`/`primary`.

### 7.3 Apontado para decisão futura (não corrigido)

- **`tertiary` (150°) ≈ `success` (140°)**: os dois canais verdes são quase indistinguíveis (badges "ADM UNIDADE" vs "SUPERVISOR GISE" na sidebar). Ou o `tertiary` muda de matiz (ex.: violeta/rosa), ou assume-se a duplicação.
- **Banner "Cadastre sua rubrica" duplicado** em `escalas/+page` e `gise/[id]/+page` — candidato a componente.
- **Empty states quase-iguais** em 9 arquivos — candidato a componente `EmptyState`.
- Botões-ícone `p-1.5` (~30 px) em tabelas densas ficam abaixo dos 44 px de alvo de toque recomendados — mitigado pelo espaçamento das células; avaliar `p-2` no mobile.
