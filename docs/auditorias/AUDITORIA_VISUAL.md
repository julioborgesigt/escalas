# Auditoria Visual — Elementos de Interface

**Data:** 2026-06-10
**Escopo:** identidade visual, design tokens, tipografia, cores, iconografia, componentes recorrentes (cards, botões, badges, modais, empty states), dark mode e micro-interações. 75 arquivos Svelte analisados (62 rotas + 13 componentes de `$lib`).
**Método:** leitura do design system (`theme.css`, `app.css`), varredura de padrões em todos os `.svelte` com contagens reais (grep), e verificação manual dos achados citados. Números são **medidos no repositório**, não estimados. Onde a varredura automática divergiu da verificação manual, vale a verificação (anotado em cada caso).

---

## 1. Veredito geral

A identidade visual é **forte e deliberada**: tema "High-Tech Command Center" com paleta completa em oklch (11 tons + tokens de contraste por canal), tipografia em dois eixos (Inter corpo / Outfit títulos), glass cards com backdrop-blur, e dark mode com cobertura praticamente total. As estruturas grandes — modais, cabeçalhos de página, status do GISE — são **disciplinadas e centralizadas**.

A dívida visual está concentrada nas **micro-decisões**: 11 tamanhos arbitrários de texto pequeno (344 usos), três linguagens de ícone convivendo (emoji, lucide, SVG inline), meia dúzia de cores fora da paleta do tema, e border-radius distribuído sem regra apesar de o próprio tema definir tokens de raio. Nada disso quebra a experiência — mas é exatamente o tipo de ruído que separa "bonito" de "polido", e que cresce a cada feature nova se não houver regra escrita.

---

## 2. Fundamentos — o que o design system já tem (theme.css)

| Token | Valor | Observação |
|-------|-------|------------|
| Paleta | 7 canais (primary cyan, secondary indigo, tertiary emerald, success, warning, error rosa-neon, surface slate) × 11 tons em oklch | Completa, com `contrast-*` por tom — raro de ver bem feito |
| Tipografia | Inter (corpo, `letter-spacing 0.01em`) + Outfit (títulos, 700, `-0.02em`) | Hierarquia clara |
| Raio | `--radius-base: 0.75rem` (= `rounded-xl`), `--radius-container: 1rem` (= `rounded-2xl`) | **Definido mas subutilizado** — ver V-4 |
| Dark mode | Tokens `-dark` para fonte/fundo + classe `.dark` sem FOUC (init.js) | Sólido |

O tema dá régua para quase tudo que os achados abaixo apontam — a maior parte das correções é *usar o que já existe*.

---

## 3. O que já está consistente (padrões canônicos — não mexer, replicar)

| Padrão | Medição | Canônico |
|--------|---------|----------|
| **Modais** | 22× o mesmo wrapper de backdrop (`fixed inset-0 z-50 ... bg-surface-950/80 backdrop-blur-sm`), com poucas variantes deliberadas (z-[60]/z-[100] para modais empilhados) | Estrutura backdrop → card `bg-surface-100 dark:bg-surface-900 rounded-2xl` → rodapé `flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3` |
| **Título de página** | 12× `class="h1 text-2xl font-bold"` + subtítulo `text-sm text-surface-500 mt-0.5` + bloco `mb-6` | Uniforme em escalas, gise, recebidos, painel, unidades, policiais |
| **Glass card** | 16× `bg-white/80 dark:bg-surface-900/60 backdrop-blur-md border-surface-200 dark:border-white/5 shadow-xl` | O contêiner-assinatura do app |
| **Status do GISE** | 8 estados centralizados em `statusColor()` (`src/lib/gise/gise-formatters.ts`) | Excelente — única fonte da verdade |
| **CTA primário** | `preset-filled-primary-500` consistente | ✓ |
| **Destrutivo** | `preset-filled-error-500` + `active:scale-95` em todos os modais de exclusão | ✓ |
| **Cancelar** | `preset-outlined-surface-500` em todos os diálogos | ✓ |
| **Dark mode** | Sem gaps reais encontrados (os `bg-white` sem `dark:` são intencionais: knob de switch em `conf-ass`, flash de câmera no SignaturePad) | ✓ |
| **prefers-reduced-motion** | Cobertura global em `app.css` | ✓ |

---

## 4. Achados, do mais ao menos impactante

### V-1 · Micro-tipografia: 10 tamanhos arbitrários para "texto pequeno" (199 usos)

Distribuição medida (`text-[0.Xrem]` em todo o `src/`):

| Tamanho | px | Usos | Veredito |
|---------|----|-----:|----------|
| `text-[0.85rem]` | 13,6 | 2 | outlier (≈ `text-sm`) |
| `text-[0.8rem]` | 12,8 | 2 | outlier |
| `text-[0.7rem]` | 11,2 | 17 | ok como piso de labels (reduzido de 58) |
| `text-[0.68rem]` | 10,9 | 0 | redundante com 0.7 (removido!) |
| `text-[0.65rem]` | 10,4 | 80 | o mais usado (reduzido de 119) |
| `text-[0.62rem]` | 9,9 | 5 | redundante |
| `text-[0.6rem]` | 9,6 | 71 | abaixo do confortável (reduzido de 94) |
| `text-[0.58rem]` | 9,3 | 2 | redundante (reduzido de 16) |
| `text-[0.55rem]` | 8,8 | 16 | limite da legibilidade (reduzido de 27) |
| `text-[0.5rem]` | 8,0 | 3 | ilegível em tela comum |
| `text-[0.45rem]` | **7,2** | 1 | ilegível — marcador de dia no calendário (reduzido de 2) |

Diferenças de 0,3–0,5px entre classes (0.58 vs 0.6 vs 0.62) são invisíveis a olho nu — restam 10 decisões arbitrárias onde caberiam 3 (total de 199 usos atuais, reduzido de 344 usos originais devido a melhorias recentes de performance/UX). **Correção proposta:** definir 3 tokens no Tailwind (`@theme` no app.css) e migrar por busca-e-troca:

```css
@theme {
	--text-2xs: 0.7rem;   /* labels secundários — absorve 0.68/0.7/0.8/0.85 */
	--text-3xs: 0.65rem;  /* badges/chips — absorve 0.55–0.65 */
	/* nada abaixo de 0.65rem; os 0.45/0.5rem dos calendários precisam de redesign pontual (ex.: ponto colorido + tooltip em vez de texto) */
}
```

Nota: a tabela de servidores (`TabelaServidores.svelte`) já foi elevada na fase 2 da auditoria de performance (0.55→0.65, 0.6→0.7) — este achado cobre o restante do app.

### V-2 · Três linguagens de ícone convivendo

Inventário medido:

- **Emoji como ícone de UI** em 9 arquivos (`escalas/+page.svelte`, `painel`, `recebidos`, `login`, `conf-ass`, `validar/[hash]`, `GiseStatusAvisos`, `ModalDatasHoras`, `SignaturePad`): 🔒 📥 🔕 🎉 🔍 ✍️ 📋 ✅ ⚠️ …
- **lucide-svelte** em 6 arquivos (~13 ícones distintos: chevrons, Download, FileText, CheckCircle2, Clock, PenLine, X, Check, ShieldCheck, UserRound, Users, FileDown).
- **SVG inline** (~80 ocorrências), com paths idênticos duplicados entre arquivos — ex.: o checkmark `M5 13l4 4L19 7` em `CardGiseAtiva.svelte:145` e `:180` e no SignaturePad; a lupa de busca repetida em `recebidos` e outros; as setas de refresh em 3+ lugares.

Problemas práticos: emoji renderiza diferente por SO/fonte (Windows vs Android vs iOS), não respeita `currentColor` nem dark mode, e tem peso visual inconsistente ao lado de ícones de linha. A duplicação de SVG inline é dívida de manutenção (mudar espessura de traço = caçar N arquivos).

**Correção proposta (regra simples):** lucide para todo ícone funcional (ações, status, navegação); emoji permitido apenas em empty states como elemento *decorativo grande* (`text-4xl`, padrão que já existe) — nunca inline em botão/badge/label. Extrair os 3–4 SVGs mais duplicados para componentes (`IconCheck`, `IconRefresh`) ou substituí-los pelos equivalentes lucide (`Check`, `RefreshCw`), que já estão no bundle.

### V-3 · Cores fora da paleta do tema

Verificado manualmente (a varredura automática deu falso-negativo aqui):

1. **`bg-orange-500 hover:bg-orange-600`** — `CardGiseAtiva.svelte:165`, estado "extra parcial" de um botão cujos irmãos usam `preset-filled-success-500` e `preset-filled-warning-500`. Laranja não existe no tema; em telas com o warning âmbar ao lado, são dois amarelos-alaranjados quase iguais brigando. **Correção:** ou usar `preset-filled-warning-500` com outro elemento distintivo (ícone/contador), ou registrar um token (ex.: o tertiary emerald livre para "parcial").
2. **`bg-rose-600 hover:bg-rose-700`** — `produtividade/+page.svelte:534` (botão) e `bg-rose-500/5 border-rose-500/10 text-rose-500` em `conf-ass/+page.svelte:411-414` (alerta). O tema **tem** um canal error "Rosa/Vermelho Neon" exatamente para isso — `rose-*` do Tailwind é um vermelho *diferente* do `error-*` do tema. **Correção:** trocar por `error-*`.
3. **Hex no `<style>` do modal de policiais** — `policiais/+page.svelte:851-858`: `#f8fafc` / `#1f2937` para inputs do modal. São aproximações de `surface-50`/`surface-800` de outra paleta (Tailwind slate/gray default). **Correção:** `var(--color-surface-50)` / `var(--color-surface-800)` — acompanha o tema automaticamente.
4. **Gráficos do `/produtividade` com paleta Tailwind default** — `produtividade/+page.svelte:731-795`: `#f43f5e`, `#ef4444`, `#6366f1` passados ao chart.js. Os gráficos ficam visivelmente "de outro app" ao lado da paleta oklch. Canvas exige cor literal, mas ela pode vir do tema em runtime:

```ts
const css = getComputedStyle(document.documentElement);
const corError = css.getPropertyValue('--color-error-500').trim();
const corSecondary = css.getPropertyValue('--color-secondary-500').trim();
```

(Os hex em `@media print` de `produtividade:884` são aceitáveis — impressão tem requisitos próprios.)

### V-4 · Border-radius sem regra — apesar de o tema definir os tokens

Medição atual: `rounded-xl` 160× · `rounded-lg` 106× · `rounded-2xl` 90× · `rounded-full` 83× · `rounded-3xl` 27× · `rounded-md` 13×. (Contagens reduzidas em relação à medição original devido à padronização nas fases 2 e 3 de performance/UX, mas os desvios de `rounded-lg` e `rounded-md` persistem).

O `theme.css` define `--radius-base: 0.75rem` (xl) e `--radius-container: 1rem` (2xl) — ou seja, **a decisão já foi tomada** e o Skeleton expõe `rounded-base`/`rounded-container` para isso. Na prática, cada componente escolhe na mão, e os 207 `rounded-lg` + 31 `rounded-3xl` são desvios do próprio tema. **Correção proposta (regra de 3 linhas para o CLAUDE.md/guia):**

- Controles (botões, inputs, chips): `rounded-base` (xl).
- Contêineres (cards, modais, tabelas): `rounded-container` (2xl). `rounded-3xl` reservado ao card-moldura de página (uso atual em 31 lugares é majoritariamente esse — ok manter).
- `rounded-full`: avatares, dots, pills. `rounded-lg`: descontinuar em código novo.

Migração big-bang não vale o risco visual; aplicar a regra em código novo e oportunisticamente.

### V-5 · `active:scale-95` em 12% dos botões

81 usos, consistentes em destrutivos/warning e na maioria dos CTAs — mas ausentes em botões secundários e em vários CTAs equivalentes de outras páginas. O resultado é tátil-inconsistente: alguns botões "afundam", outros não, sem lógica perceptível ao usuário. **Correção:** decidir a regra (sugestão: todo `preset-filled-*` ganha `active:scale-95 transition-all`; `preset-outlined-*` nunca) e aplicar via classe utilitária ou no guia.

### V-6 · Glass card: 16× canônico + 5 variantes ad hoc

- `redefinir-senha/+page.svelte:101`: `bg-white/90 ... backdrop-blur-xl` (mais opaco, blur maior);
- `PainelAssinaturaDigital.svelte`: `border-white/8` (vs `/5` canônico);
- `SecaoHistorico.svelte:589`: `bg-surface-50/80 shadow-sm`;
- mais 2 one-offs de opacidade (`/80 dark:/80`, `/50 dark:/30`).

Nenhuma divergência parece intencional. **Correção:** extrair uma classe `card-glass` no `app.css` e usar nos 21 lugares:

```css
@utility card-glass {
	@apply bg-white/80 dark:bg-surface-900/60 backdrop-blur-md
		border border-surface-200 dark:border-white/5
		shadow-xl shadow-black/5 dark:shadow-black/20;
}
```

### V-7 · Empty states quase-iguais

8 ocorrências com a mesma anatomia (emoji grande + título + dica) mas paddings `py-12/16/20/32` e cores de texto variando. **Correção:** componente `EmptyState.svelte` (props: emoji, título, dica) com `py-16` — elimina a deriva e dá um ponto único para futura ilustração/ícone.

### V-8 · Focus states fortes em inputs, delegados nos botões

Inputs e selects têm anéis de foco explícitos e bonitos (`SearchableSelect`, `SecaoHistorico:589-595`, `redefinir-senha`). Botões dependem do estilo default dos presets do Skeleton — funcional, porém visualmente mais fraco que o padrão dos inputs. **Correção (baixa prioridade):** conferir no browser se o ring default dos presets atende contraste AA; se não, um global `button:focus-visible { @apply ring-2 ring-primary-500/40 outline-none; }` alinha tudo.

### V-9 · `/validar` fala outro dialeto de botão

`validar/+page.svelte:91` usa botão raw (`bg-primary-600 hover:bg-primary-700 ... rounded-2xl`) em vez dos presets usados no app inteiro. Como é a página pública de verificação (identidade própria, tipografia display `font-black uppercase tracking-[0.3em]`), pode ser **intencional** — mas hoje não está documentado. **Correção:** uma linha de comentário no topo da página declarando o desvio como deliberado, ou migrar para `preset-filled-primary-500` com classes adicionais.

### V-10 · Miscelânea (baixo impacto)

- **backdrop-blur:** 5 variantes (37 `sm`, 24 `md`, 4 `xl`, 2 sem sufixo, 1 `lg`). Regra implícita já é "sm para backdrops, md para cards" — formalizar e corrigir os 7 desviantes.
- **Spinners:** 6 SVGs `animate-spin` ad hoc vs 4 usos do componente `Spinner.svelte`. Unificar no componente.
- **Login h1** (`text-xl`) um degrau menor que o padrão interno (`text-2xl`) — provável intenção (card compacto), conferir.

### V-11 · Inconsistências Visuais nas Novas Rotas (res-gise e policiais)

Com a adição de novas rotas de produtividade GISE e gerenciamento de policiais, novos desvios visuais surgiram:
- **Uso de `rounded-3xl` (1.5rem):** Encontrado em cartões principais e contêineres (`res-gise/RelatorioProdutividade.svelte`, `res-gise/+page.svelte`, `policiais/+page.svelte`, `policiais/upload/+page.svelte`), ultrapassando os tokens de raio definidos no tema (`--radius-base: 0.75rem`/xl e `--radius-container: 1rem`/2xl).
- **Custom SVG Inline (`btnIcon`):** As páginas do `res-gise` implementam um snippet local chamado `btnIcon` que recebe caminhos SVG brutos (ex: `M5 13l4 4L19 7` ou caminhos maiores) e os renderiza inline. Esse padrão reforça o débito de ícones fragmentados mapeado em V-2.
- **Acúmulo de Micro-tipografia:** As telas de policiais (`policiais/+page.svelte` e `policiais/[id]/+page.svelte`) utilizam extensivamente `text-[0.7rem]` em rótulos de formulário, aumentando o acúmulo de tamanhos arbitrários e reforçando a necessidade da migração para `--text-2xs`.
- **Custom SegmentedControl:** Em `policiais/+page.svelte`, o controle de segmentos é customizado manualmente com Tailwind inline em vez de um padrão global reutilizável.

---

## 5. Plano de ação sugerido

### Rodada 1 — correções pontuais sem risco (½ dia)
1. Trocar `rose-*`/`orange-*` por `error-*`/token do tema (V-3.1, V-3.2) — 6 classes em 3 arquivos.
2. Hex do modal de policiais → `var(--color-surface-*)` (V-3.3).
3. Redesenhar os 2 marcadores de 7,2px do calendário (V-1) — ponto colorido + `title`.
4. Unificar os 5 glass cards desviantes no padrão canônico (V-6).

### Rodada 2 — sistematização (1–2 dias)
5. Tokens `--text-2xs`/`--text-3xs` + migração dos 199 usos por busca-e-troca dirigida, incluindo os novos rótulos das telas de policiais e GISE (V-1, V-11).
6. Classe `card-glass` (V-6) e componente `EmptyState` (V-7).
7. Paleta dos gráficos lida do tema em runtime (V-3.4).
8. Regra de ícones: substituir emojis funcionais, SVGs duplicados e snippets locais (`btnIcon`) por equivalentes Lucide (V-2, V-11) — manter emojis decorativos dos empty states.
9. Padronização de border-radius: substituir desvios de `rounded-3xl` e `rounded-lg` em `res-gise` e `policiais` para os tokens do tema (V-4, V-11).

### Rodada 3 — guia vivo (½ dia)
10. Seção "Padrões visuais" no CLAUDE.md: radius (V-4), `active:scale-95` (V-5), blur (V-10), ícones (V-2), micro-tipografia (V-1) — 15 linhas que impedem a dívida de voltar.

---

## 6. Apêndice — contagens-resumo

| Dimensão | Medição Atual (Pós Performance/UX) | Medição Original (Histórico) |
|----------|-----------------------------------|------------------------------|
| Tamanhos arbitrários de micro-texto | 10 variantes, 199 usos | 11 variantes, 344 usos |
| Fontes de ícone | emoji 9 arquivos · lucide 6 arq. (~13 ícones) · SVG inline/snippets ~80 | emoji 9 arq. · lucide 6 arq. · SVG inline ~80 |
| Glass card | 16 canônicos + 5 variantes (mais 2 novos com rounded-3xl) | 16 canônicos + 5 variantes |
| Backdrops de modal | 22 canônicos + variantes deliberadas | 22 canônicos + variantes deliberadas |
| Título de página | 12× o padrão canônico | 12× o padrão canônico |
| `active:scale-95` | 81 botões | 81 botões (~12%) |
| Border-radius | xl 160 · lg 106 · 2xl 90 · full 83 · 3xl 27 · md 13 | xl 230 · lg 207 · 2xl 120 · full 111 · 3xl 31 |
| backdrop-blur | sm 37 · md 24 · xl 4 · bare 2 · lg 1 | sm 37 · md 24 · xl 4 · bare 2 · lg 1 |
| Cores fora do tema | orange 2 classes · rose 5 · hex 2 (style block) + paleta chart.js | orange 2 classes · rose 5 · hex 2 + paleta chart.js |
| Pesos de fonte | bold 342 · semibold 125 · black 72 · extrabold 3 | bold 488 · semibold 189 · black 102 · extrabold 3 |
| Dark mode | sem gaps reais encontrados | sem gaps reais encontrados |
| Empty states | 8, com 4 paddings diferentes | 8, com 4 paddings diferentes |

**Como reproduzir:** os greps usados estão implícitos em cada tabela (`grep -rhoE "<padrão>" --include="*.svelte" src/routes src/lib | sort | uniq -c`). A varredura ampla foi feita por agente e os achados individuais citados foram verificados manualmente; duas alegações da varredura foram corrigidas na verificação (contagem de lucide e "ausência" de cores hardcoded).
