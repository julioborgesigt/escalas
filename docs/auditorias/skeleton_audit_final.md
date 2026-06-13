# Auditoria Final Consolidada — Skeleton UI v4 no projeto Escalas

Documento consolidando três auditorias independentes sobre o aproveitamento do
**Skeleton UI v4** (`@skeletonlabs/skeleton` + `@skeletonlabs/skeleton-svelte` 4.13)
combinado com **Tailwind CSS v4** e **Svelte 5 (runes)** no projeto
**Escalas de Plantão Policial (DPI SUL)**.

Fontes consolidadas:
- `SKELETON_AUDIT.md` — auditoria de alto nível com 3 frentes principais
- `SKELETON_DEEP_AUDIT.md` — auditoria visual profunda com 5 blueprints de refatoração
- Auditoria interna (este agente) — varredura por subutilização com contagens e file:line

---

## 1. Resumo Executivo

| Eixo | Avaliação |
|---|---|
| Configuração base (tema, build, fonts) | **A** — exemplar |
| Componentes Skeleton-svelte adotados | **B+** — bom, mas ~12 componentes ainda inexplorados |
| Consistência de tokens de tema | **B** — 5 pontos com cores hardcoded |
| Reuso de classes CSS do Skeleton (`btn`, `card`, `table`, `badge`) | **A-** — bem aplicado |
| Reinvenção de controles nativos | **C+** — spinners, tooltips, accordions custom proliferam |
| **Nota global consolidada** | **B+ (≈ 7.5 / 10)** |

**Veredito:** o projeto demonstra **maturidade arquitetural** (Svelte 5 com runes,
Tailwind v4 com `@source`, OKLCH no `theme.css`, Combobox encapsulado em
`SearchableSelect`). As subutilizações restantes são **superficiais** e
concentradas em três áreas: (1) controles HTML nativos não migrados, (2) spinners
SVG inline duplicados e (3) cores Tailwind cruas onde deveriam estar tokens do tema.

---

## 2. Pontos Fortes (não tocar — já está ótimo)

### 2.1 Tema OKLCH completo
`src/theme.css` define o tema `policial` com paleta matemática consistente em
todas as escalas (50→950) para 7 famílias (primary, secondary, tertiary, success,
warning, error, surface), incluindo `*-contrast-*` para garantir contraste em
modo claro/escuro. Usa formato OKLCH nativo do Tailwind v4.

### 2.2 Build pipeline
- `src/app.css` usa as diretivas `@source` do Tailwind v4 apontando para os dist
  do Skeleton, garantindo tree-shaking correto das classes utilizadas.
- `vite.config.ts` separa `@skeletonlabs` + `@zag-js` em chunk próprio (`skeleton`).
- `ssr.noExternal` inclui `@skeletonlabs/skeleton-svelte` e `@zag-js/svelte` —
  configuração correta para Cloudflare Workers.

### 2.3 Wrapper exemplar `SearchableSelect.svelte`
Encapsula `Combobox` + `useListCollection` + `Portal` do Skeleton com debounce,
loading state e tratamento de erro. **Referência interna** para futuros wrappers.

### 2.4 Componentes Skeleton já adotados (35 imports, 25 arquivos)
| Componente | Arquivos | Status |
|---|---|---|
| `Dialog` | 13 | ✅ Padrão dominante para modais |
| `Pagination` | 4 | ✅ |
| `SegmentedControl` | 4 | ✅ |
| `Combobox` | 1 (via SearchableSelect) | ✅ |
| `Popover` + `Portal` | 2 | ✅ |
| `Toast` (`createToaster`) | 1 (`lib/toast.ts`) | ✅ |
| Classes CSS: `table`, `badge`, `card`, `input`, `select`, `label`, `checkbox` | múltiplos | ✅ |

---

## 3. Achados Consolidados — Oportunidades por Componente

### 3.1 `<Switch>` — substituir checkboxes que são toggles

**Origem dos achados:** todas as três auditorias destacaram este ponto.

**Por que importa:** controles de "ligar/desligar uma opção" devem usar Switch
(deslizante, com transição, acessível via teclado, `aria-checked`). Checkbox
HTML é semântico apenas para **seleção múltipla** ou **confirmação binária
discreta**.

**Locais identificados:**

| Arquivo | Linhas | Contexto | Severidade |
|---|---|---|---|
| `src/routes/aceitar-termo/+page.svelte` | 67, 79, 96, 108 | 4 consentimentos LGPD (2 obrigatórios, 2 opcionais) | Alta — tela de primeira impressão |
| `src/routes/unidades/_components/ModalCadastrarUnidade.svelte` | regimes de escala | Plantão / Expediente / Fim de Semana | Alta — toggles puros |
| `src/routes/recebidos/+page.svelte` | 298 | "mostrar apenas não vistos" — toggle de filtro | Média |
| `src/routes/painel/+page.svelte` | 392, 404 | Filtros | Média |
| `src/routes/escalas/[id]/_components/TabelaServidores.svelte` | 311, 396, 602 | **Seleção múltipla** de linhas — manter checkbox | ✅ OK |
| `src/routes/escalas/[id]/_components/ListaFds.svelte` | 541 | **Seleção múltipla** | ✅ OK |
| `src/routes/gise/[id]/_components/GiseSupervisao.svelte` | 355 | Verificar contexto antes de migrar | Avaliar |

**Padrão de refatoração:**
```svelte
<!-- ANTES -->
<label class="flex items-center space-x-2">
  <input class="checkbox" type="checkbox" bind:checked={valor} />
  <span>Rótulo</span>
</label>

<!-- DEPOIS -->
<Switch
  checked={valor}
  onCheckedChange={(e) => (valor = e.checked)}
  controlBase="bg-surface-300 dark:bg-surface-700 data-[state=checked]:bg-primary-500"
  controlThumb="bg-white"
>
  <span class="text-sm">Rótulo</span>
</Switch>
```

---

### 3.2 `<Accordion>` — substituir `<details>/<summary>` artesanais

**Origem:** SKELETON_AUDIT.md + auditoria interna.

**Locais identificados:**

| Arquivo | Linhas | Contexto |
|---|---|---|
| `src/routes/policiais/upload/+page.svelte` | 113-137 | Lista de erros expansível após import Excel |
| `src/routes/gise/[id]/_components/GiseSeccional.svelte` | 434-465, 468-... | Duas seções colapsáveis com chevron manual e `[&::-webkit-details-marker]:hidden` |

**Ganho:** transição animada nativa, ARIA correto (`aria-expanded`,
`aria-controls`), suporte a múltiplos itens com `value={[...]}`, chevron animado
sem hacks de CSS para esconder o marker do Safari.

**Padrão de refatoração** (ver `SKELETON_AUDIT.md` seção B para diff completo):
```svelte
<Accordion value={isOpen ? ['k'] : []}>
  <Accordion.Item value="k">
    <Accordion.Control>
      <span>Título</span>
      <Accordion.Icon />
    </Accordion.Control>
    <Accordion.Panel>
      <!-- conteúdo -->
    </Accordion.Panel>
  </Accordion.Item>
</Accordion>
```

---

### 3.3 `<Avatar>` — perfil de usuário no sidebar

**Origem:** SKELETON_AUDIT.md + SKELETON_DEEP_AUDIT.md (Blueprint 1).

**Local:** `src/routes/+layout.svelte` (~linha 565)

**Estado atual:** nome do usuário em `<p>` puro + badges abaixo.

**Refatoração proposta** (Blueprint 1 do DEEP_AUDIT):
```svelte
const iniciaisUsuario = $derived(
  usuario?.nome
    ? usuario.nome.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
    : ''
);

<Avatar
  src={usuario?.avatarUrl}
  initials={iniciaisUsuario}
  background="bg-primary-500/20 text-primary-700 dark:text-primary-400 font-bold"
  border="border border-primary-500/30"
  width="w-9 h-9"
  rounded="rounded-full"
/>
```

**Pré-requisito:** verificar se `usuario.avatarUrl` existe no payload de
sessão; se não, ajustar tipos em `app.d.ts` ou usar apenas `initials`.

---

### 3.4 `<SegmentedControl>` — abas de Login (Policial / Administrador)

**Origem:** SKELETON_DEEP_AUDIT.md (Blueprint 2). **Não detectado** pela
auditoria interna nem por SKELETON_AUDIT.md — achado novo.

**Local:** `src/routes/login/+page.svelte`

**Estado atual:** dois `<button>` envoltos em uma div estilizada manualmente
para simular um segmented control. Inconsistente com o restante do app, que já
usa `SegmentedControl` em `policiais/`, `painel/`, `recebidos/`, `res-gise/`,
`produtividade/`, `unidades/`.

**Refatoração:** ver diff completo no Blueprint 2 do DEEP_AUDIT.

---

### 3.5 `<SearchableSelect>` — substituir `<datalist>` nativo

**Origem:** SKELETON_DEEP_AUDIT.md (Blueprint 5).

**Local:** `src/routes/unidades/_components/ModalCadastrarUnidade.svelte`
(campo "Cidade no Ceará")

**Problema:** `<datalist>` HTML nativo tem renderização inconsistente em iOS
Safari (omite scrollbars, quebra teclado virtual em alguns dispositivos).

**Solução:** reusar o wrapper interno `SearchableSelect.svelte` (que já
encapsula o `Combobox` do Skeleton). Reduz inconsistência cross-browser e
elimina a única instância de `<datalist>` no projeto.

---

### 3.6 `<ProgressRing>` — spinners SVG inline duplicados

**Origem:** auditoria interna (achado exclusivo, não está nos outros docs).

**Locais identificados (7 ocorrências):**

| Arquivo | Linha | Padrão |
|---|---|---|
| `src/lib/components/Spinner.svelte` | 18-22 | Wrapper custom com `border-current border-t-transparent animate-spin` |
| `src/lib/components/LoadingOverlay.svelte` | 36-41 | Dois rings concêntricos artesanais |
| `src/lib/components/SearchableSelect.svelte` | 184 | SVG inline animado dentro do combobox |
| `src/lib/components/FloatingRefresh.svelte` | 22 | `animate-spin` condicional |
| `src/routes/res-gise/FormularioServico.svelte` | 236 | SVG inline |
| `src/routes/res-gise/+page.svelte` | 337 | SVG inline |
| `src/routes/validar/[hash]/+page.svelte` | 358 | SVG inline dentro de botão |

**Padrão de refatoração:**
```svelte
import { ProgressRing } from '@skeletonlabs/skeleton-svelte';

<!-- indeterminate -->
<ProgressRing value={null} size="size-6" />

<!-- determinate (se aplicável) -->
<ProgressRing value={progresso} />
```

**Estratégia:** refatorar `Spinner.svelte` e `LoadingOverlay.svelte` para
internamente usar `ProgressRing` — propaga em todos os call-sites sem precisar
tocar em cada um.

---

### 3.7 `<Tooltip>` — substituir atributos `title=""`

**Origem:** auditoria interna (achado exclusivo).

**Contagem:** 44 ocorrências de `title="..."` em ações críticas (Editar, Baixar
PDF, Repetir em outros dias, etc.).

**Hotspots:**
- `src/routes/escalas/[id]/_components/ListaFds.svelte:579, 604`
- `src/routes/escalas/[id]/_components/TabelaServidores.svelte:359, 671`
- `src/routes/gise/_components/SecaoHistorico.svelte:451, 464, 497`
- `src/routes/gise/[id]/_components/GiseCabecalho.svelte:127, 139`
- `src/lib/components/SignaturePad.svelte:776`

**Problema do `title` HTML:** delay ~1.5s, não estiliza, não aparece em mobile,
sem suporte a teclado, escapa de qualquer paleta visual.

**Padrão de refatoração:**
```svelte
import { Tooltip } from '@skeletonlabs/skeleton-svelte';

<Tooltip>
  {#snippet trigger()}
    <button class="btn btn-icon">...</button>
  {/snippet}
  {#snippet content()}
    Editar registro
  {/snippet}
</Tooltip>
```

**Estratégia:** migrar gradualmente, priorizando botões-ícone em tabelas (alta
densidade de `title`).

---

### 3.8 Tokens de tema — eliminar cores Tailwind cruas

**Origem:** auditoria interna + SKELETON_DEEP_AUDIT.md (Blueprint 3 da página
`validar/[hash]`).

**Locais com cores hardcoded (deveria ser token do tema):**

| Arquivo | Linhas | Atual | Substituir por |
|---|---|---|---|
| `src/lib/components/SignaturePad.svelte` | 628 | `bg-amber-500` | `bg-warning-500` |
| `src/routes/gise/[id]/_components/GiseSupervisao.svelte` | 526, 569 | `bg-indigo-500/5`, `border-indigo-500/10` | `bg-secondary-500/5`, `border-secondary-500/10` |
| `src/routes/gise/[id]/_components/GiseSeccional.svelte` | 391, 1052 | `bg-amber-500/10`, `border-amber-500/20` | `bg-warning-500/10`, `border-warning-500/20` |
| `src/routes/validar/[hash]/+page.svelte` | 134, 234, 252, 255, 258, 268, 278, 373 | `bg-amber-*`, `text-amber-*`, `bg-success-500/10`, `bg-primary-50` | `preset-tonal-warning`, `preset-tonal-success`, `preset-tonal-primary` |
| `src/routes/produtividade/+page.svelte` | 544 | `bg-indigo-600`, `shadow-indigo-500/20` | `bg-secondary-600`, `shadow-secondary-500/20` |

**Ganho:** trocar a paleta primary/warning/etc. no `theme.css` passa a refletir
automaticamente nessas telas. Hoje quebra a promessa do design system.

**Refatoração detalhada** para `validar/[hash]/+page.svelte`: ver Blueprint 3
do DEEP_AUDIT (inclui troca de `bg-primary-50 dark:bg-primary-900/20` por
`preset-tonal-primary`, etc.).

---

### 3.9 Classe `btn` em botões artesanais

**Origem:** auditoria interna + SKELETON_DEEP_AUDIT.md (Blueprint 3).

**Padrão observado:** botões com Tailwind raw aplicado direto, em vez de usar
`class="btn preset-filled-primary-500"` etc.

**Exemplo (Blueprint 3 do DEEP_AUDIT):**
```svelte
<!-- ANTES (validar/[hash]/+page.svelte ~278) -->
<button class="flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-3
               bg-primary-600 hover:bg-primary-700 active:bg-primary-800
               disabled:bg-surface-400 text-white font-bold rounded-xl
               transition-colors text-sm">

<!-- DEPOIS -->
<button class="btn preset-filled-primary-500 w-full sm:w-auto font-bold
               rounded-xl active:scale-95 shadow-md flex items-center gap-2">
```

**Locais com maior densidade de botões raw:**
- `src/lib/components/PainelAssinaturaFDS.svelte` (~9 ocorrências)
- `src/lib/components/PainelAssinaturaDigital.svelte` (~8 ocorrências)
- `src/lib/components/FloatingRefresh.svelte:16`
- `src/lib/components/CodigoTimer.svelte`

---

### 3.10 `SkeletonCard.svelte` — nomenclatura confusa

**Origem:** auditoria interna + SKELETON_AUDIT.md recomendação 4.1.

**Achado:** `src/lib/components/SkeletonCard.svelte` é um **loading placeholder**
(skeleton screen), não tem relação com a biblioteca Skeleton UI. A implementação
está correta (usa `animate-pulse` + tokens de tema).

**Ação opcional:** renomear para `LoadingCard.svelte` ou `CardPlaceholder.svelte`
para evitar ambiguidade quando alguém procurar "componente do Skeleton" no
projeto. **Baixa prioridade**.

---

### 3.11 AppBar / NavBar custom em `+layout.svelte`

**Origem:** auditoria interna.

**Estado atual:** barra superior + sidebar artesanais (~700 linhas em
`src/routes/+layout.svelte`). Skeleton expõe `AppBar` e padrões de
`Navigation.Rail` / `Navigation.Bar`.

**Recomendação:** **manter como está**. Migração custosa, ganho marginal, e
o layout atual está bem testado. Anotar como dívida arquitetural de **baixa
prioridade** — só refatorar se houver outra justificativa.

---

### 3.12 Componentes Skeleton ainda inexplorados

Componentes da biblioteca que **não aparecem em nenhum import** do projeto e
que talvez tenham aplicação futura (não é dívida — só inventário):

- `Rating` — não aplicável ao domínio
- `FileUpload` — projeto usa `<input type="file">` em 1 lugar; avaliar
- `TagsInput` — não aplicável
- `Slider` — não aplicável
- `Progress` (barra horizontal) — usar quando tiver upload/processamento longo
- `Tabs` — projeto usa `SegmentedControl` (decisão de design intencional)

---

## 4. Plano de Ação Priorizado

Ordenado por **(impacto visível / esforço)**:

| # | Mudança | Esforço | Impacto | Arquivos afetados |
|---|---|---|---|---|
| 1 | Refatorar `Spinner.svelte` e `LoadingOverlay.svelte` para usar `ProgressRing` internamente | Baixo | Alto — propaga em 7 call-sites | 2 arquivos (wrappers internos) |
| 2 | Trocar 5 cores hardcoded por tokens (`bg-warning-*`, `bg-secondary-*`) | Trivial | Médio — restaura integridade do tema | 5 arquivos |
| 3 | `validar/[hash]/+page.svelte` — aplicar `preset-tonal-*` em cards de status (Blueprint 3) | Médio | Alto — tela pública de validação | 1 arquivo |
| 4 | Switch nos consentimentos de `aceitar-termo/+page.svelte` (Blueprint 4) | Médio | Alto — tela de primeira impressão | 1 arquivo |
| 5 | Switch nos toggles de `ModalCadastrarUnidade.svelte` (Blueprint 5 parcial) | Baixo | Médio | 1 arquivo |
| 6 | `<datalist>` → `<SearchableSelect>` em `ModalCadastrarUnidade.svelte` (Blueprint 5 parcial) | Baixo | Alto — corrige bug de iOS Safari | 1 arquivo |
| 7 | `<details>` → `<Accordion>` em `policiais/upload/+page.svelte` | Baixo | Médio | 1 arquivo |
| 8 | `<details>` → `<Accordion>` em `GiseSeccional.svelte` | Médio | Médio | 1 arquivo |
| 9 | `<Avatar>` no sidebar de `+layout.svelte` (Blueprint 1) | Médio | Médio — depende de ter `avatarUrl` | 1 arquivo + possível ajuste em `app.d.ts` |
| 10 | `<SegmentedControl>` no `login/+page.svelte` (Blueprint 2) | Médio | Médio — consistência com restante do app | 1 arquivo |
| 11 | Switch nos toggles de filtro em `recebidos/+page.svelte`, `painel/+page.svelte` | Baixo | Baixo | 2 arquivos |
| 12 | Migrar `title=""` críticos para `<Tooltip>` (botões-ícone de tabelas) | Médio-Alto | Médio — a11y + UX mobile | ~10 arquivos |
| 13 | Aplicar `class="btn ..."` em botões raw dos painéis de assinatura | Médio | Baixo-Médio | 2 arquivos |
| 14 | Renomear `SkeletonCard.svelte` → `LoadingCard.svelte` | Trivial | Baixo (clareza) | 1 arquivo + call-sites |
| 15 | AppBar/sidebar para componentes Skeleton | Alto | Baixo | `+layout.svelte` inteiro |

**Recomendação de execução:**
- **Sprint 1 (quick wins):** itens 1, 2, 5, 6, 7 — pequenos, sem risco, alto impacto agregado
- **Sprint 2 (telas públicas):** itens 3, 4, 9, 10 — refinam impressão externa
- **Sprint 3 (varredura):** itens 8, 11, 12, 13
- **Backlog:** itens 14, 15

---

## 5. Diretrizes para Manutenção Futura

Compiladas das três auditorias:

1. **Componente Skeleton > marcação crua.** Ao implementar UI nova, perguntar
   primeiro: "existe um componente do `@skeletonlabs/skeleton-svelte` para isso?".
   O motor Zag.js já garante ARIA, navegação por teclado, focus management.

2. **Tokens de tema > Tailwind raw.** Para cores semânticas (warning, success,
   primary, secondary), usar `bg-warning-500`, `text-success-700`, etc. — nunca
   `bg-amber-*` ou `bg-indigo-*` diretamente. Para cards de estado, preferir
   `preset-tonal-{warning|success|primary|error}`.

3. **Wrappers internos.** Quando um componente Skeleton precisar de configuração
   recorrente, encapsular em wrapper (padrão `SearchableSelect.svelte`). Evita
   prop drilling e padroniza visual.

4. **`@source` paths.** Ao adicionar nova lib que injeta classes Tailwind em
   runtime, adicionar diretiva `@source` em `app.css`.

5. **Acessibilidade implícita.** Para qualquer controle interativo (toggle,
   collapse, popup, tab), usar componente Skeleton — não roll-your-own. O
   custo de implementar ARIA correto manualmente é alto e fácil de errar.

6. **Animações.** Use `transition:fly`/`fade` do Svelte em conjunto com
   `animate-in fade-in duration-300` do Tailwind nos modais/popovers. Já
   respeitamos `prefers-reduced-motion` globalmente (`src/app.css:42`).

7. **CSP e `style-src`.** O projeto convive com `style-src 'unsafe-inline'` por
   conta de Skeleton + Tailwind arbitrary values (documentado em
   `svelte.config.js:34-50`). Trade-off consciente — não tentar fechar sem
   migração para CSS-in-JS com nonces.

---

## 6. Conclusão

O projeto **DPI SUL Escalas** está em **estado avançado de maturidade visual**.
A configuração do Skeleton v4 + Tailwind v4 + Svelte 5 está implementada com
qualidade — em particular o tema OKLCH e o wrapper `SearchableSelect`.

As subutilizações identificadas são **incrementais**, não estruturais.
Implementar os 11 primeiros itens do plano de ação (sprints 1 e 2 + parte da 3)
eleva a nota de **B+ (7.5)** para **A (9.0)** e reduz inconsistências
cross-browser, principalmente em iOS Safari.

Os achados exclusivos consolidados de cada auditoria foram:
- **SKELETON_AUDIT.md** trouxe Avatar no sidebar e o roteiro do Switch em ModalCadastrarUnidade.
- **SKELETON_DEEP_AUDIT.md** trouxe os 5 blueprints completos com diffs (incluindo o achado do SegmentedControl no login e do datalist → SearchableSelect).
- **Auditoria interna** trouxe os spinners reinventados (7 lugares), os 44 `title=""`, o mapeamento de cores hardcoded e o inventário completo dos imports atuais.

Próximo passo recomendado: executar **Sprint 1** (itens 1, 2, 5, 6, 7) num
único PR pequeno para colher os ganhos mais baratos.
