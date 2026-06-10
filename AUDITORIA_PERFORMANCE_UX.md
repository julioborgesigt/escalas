# Auditoria de Performance e Experiência de Usuário

**Data:** 2026-06-10
**Escopo:** front-end (bundle, rede, renderização), back-end (TTFB no Cloudflare Workers + D1) e UX percebida (feedback, navegação, mobile).
**Método:** build de produção real (`vite build`) com medição de chunks gzip, walk do grafo de imports por rota, leitura dirigida de `hooks.server.ts`, todos os `+page.server.ts`, componentes e migrations. Todos os números abaixo foram **medidos neste repositório**, não estimados.

> **Status — Fase 1 implementada (2026-06-10).** Resultados medidos pós-implementação:
>
> | Item | Resultado medido |
> |------|------------------|
> | P-1 Sentry lazy (`hooks.client.ts` + chunk `sentry` no `vite.config.ts`) | First-load JS: `/login` 159 → **130 kB gz** (−18%); todas as rotas −28/−29 kB gz. O chunk do Sentry (169 kB gz, namespace completo por ser import dinâmico) carrega no idle, fora do caminho crítico, sem nenhum importador estático. |
> | B-1 Batch usuário+aceite (`validarSessaoComAceite`) | 3-4 round-trips D1 → **2** por request autenticado (sessão; depois usuário + aceite + sliding-update num único `db.batch`). |
> | B-2 Paginação em `/recebidos` | Load com `limit 10` + filtros server-side via URL (seccional/unidade/mês/ano/vistos), `PaginationControls` ligado ao servidor; filtros persistidos continuam funcionando (reaplicados via `replaceState`). Removido o filtro invisível `filtroData` (estado sem input na UI). |
> | P-2 Fundo fixo → pseudo-elemento | `background-attachment: fixed` removido; gradientes do dark mode agora em `.dark body::before` composto na GPU. |
> | U-3 Dimensões de imagem | `width`/`height` (640×640, medido do asset) nos 3 logos in-repo (`/aceitar-termo`, `/termo/[versao]`, `/termo/dpo`). Os 3 brasões de `/validar*` vêm do R2 (`/api/validar/logo`) e a proporção real não é verificável pelo repositório — pendente: medir a imagem em produção e aplicar o mesmo fix. |
>
> Verificação: `svelte-check` 0 erros, ESLint 0 erros novos, 403/403 testes unitários passando, build de produção OK.
>
> **Correção ao achado P-1:** a estimativa original de “~60 kB gz de Sentry” veio da atribuição do visualizer (que refletia o build de servidor). A fatia real do SDK tree-shaken no bundle de cliente era **~29 kB gz** — o ganho medido. A seção P-1 abaixo mantém o texto original da auditoria; os números válidos são os desta tabela.

---

## 1. Sumário executivo

O projeto já está acima da média: face-api (1,3 MB) e chart.js carregam sob demanda, libs de PDF/crypto são server-only, há `manualChunks`, fontes self-hosted com `font-display: swap`, preload on-hover, barra de progresso de navegação, skeletons, debounce com `AbortController` e `db.batch()` nas mutações. A base é sólida.

Os ganhos restantes, em ordem de impacto:

| # | Achado | Impacto estimado | Esforço |
|---|--------|------------------|---------|
| 1 | **Sentry estático no caminho crítico** — ~60 kB gz em *toda* página, antes da hidratação | −37% do JS crítico do `/login` | Baixo |
| 2 | **3 queries D1 sequenciais por request autenticado** no `hooks.server.ts` | −10 a −60 ms de TTFB em **todas** as rotas | Médio |
| 3 | **`invalidateAll()` após cada mutação** — refetch do app inteiro com overlay bloqueante | Operações de 1–3 s → percepção instantânea | Médio |
| 4 | **`/recebidos` sem paginação** (`limit: undefined`) | Payload/TTFB cresce sem teto com o banco | Baixo |
| 5 | **`background-attachment: fixed` + gradientes no body** | Jank de scroll em mobile (repaint contínuo) | Baixo |
| 6 | **Fontes sem preload** (8 pesos, ~180 kB woff2) | Texto estável mais cedo, menos flash de swap | Baixo |
| 7 | **`/painel` sem streaming** — compliance pesado bloqueia o TTFB | Primeira pintura do painel ~2–5× mais rápida | Médio |

---

## 2. Números medidos (build de produção)

### 2.1 First-load JS por rota (closure de imports estáticos: entry + layout raiz + página)

| Rota | Arquivos | Raw | **Gzip** |
|------|---------:|----:|---------:|
| `/login` | 12 | 512 kB | **159 kB** |
| `/` (raiz) | 10 | 478 kB | **148 kB** |
| `/escalas` | 25 | 616 kB | **193 kB** |
| `/escalas/[id]` | 21 | 651 kB | **199 kB** |
| `/gise` | 19 | 597 kB | **187 kB** |
| `/gise/[id]` | 18 | 700 kB | **211 kB** |
| `/painel` | 14 | 505 kB | **157 kB** |
| `/recebidos` | 17 | 513 kB | **160 kB** |
| `/produtividade` | 11 | 507 kB | **157 kB** |
| `/validar/[hash]` | 12 | 505 kB | **156 kB** |

Somam-se a isso, na primeira visita: CSS **23 kB gz** + fontes **~180 kB** (8 woff2, cache imutável) + HTML. Visita inicial do `/login` ≈ **380–400 kB** transferidos.

### 2.2 Composição dos chunks compartilhados (carregados em todas as rotas)

| Chunk | Conteúdo | Raw | Gzip | Observação |
|-------|----------|----:|-----:|------------|
| `vendor` | Runtime Svelte/Kit **+ @sentry/browser inteiro** | 210 kB | 76 kB | **Sentry ≈ 190 kB raw / ~60 kB gz disso** — ver achado P-1 |
| `skeleton` | Skeleton UI + todas as máquinas zag-js | 229 kB | 60 kB | Agrupado pelo `manualChunks`; ver P-5 |
| `nodes/0` | Layout raiz | 27 kB | 7 kB | OK |

### 2.3 Chunks sob demanda (verificados como lazy — corretos)

| Chunk | Raw | Gzip | Quando carrega |
|-------|----:|-----:|----------------|
| face-api/tensorflow | 1.297 kB | 332 kB | Só via `await import()` no passo de câmera do `SignaturePad.svelte:171` ✅ |
| chart.js | 195 kB | 66 kB | Só via `await import('chart.js/auto')` em `/produtividade` (`+page.svelte:41`) ✅ |
| Modelos face-api | ~10 MB | — | `static/face-api/` com `Cache-Control: immutable` via `_headers` ✅ |

exceljs, jspdf, docx, pdf-lib, @signpdf, node-forge e qrcode: **100% server-only** (nenhum byte no client) ✅.

---

## 3. Achados de Performance — Front-end

### P-1 · ALTO — Sentry no caminho crítico de toda página

**Onde:** `src/hooks.client.ts:13` → `import * as Sentry from '@sentry/browser'`.

O import estático funde o SDK inteiro no chunk `vendor` junto com o runtime do Svelte — confirmado no build: o chunk de 210 kB raw (76 kB gz) que o `entry/start` importa contém `captureException` e o runtime de hidratação. Resultado: **~60 kB gz de Sentry são baixados, parseados e executados antes da hidratação em todas as páginas**, inclusive `/login` e `/validar` (públicas).

**Correção:** carregar o Sentry de forma assíncrona após a hidratação, com uma fila para erros que ocorram antes do SDK chegar:

```ts
// hooks.client.ts
import type { HandleClientError } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';

const dsn = env.PUBLIC_SENTRY_DSN;
type SentryMod = typeof import('@sentry/browser');
let sentry: SentryMod | null = null;
const fila: Array<() => void> = [];

if (dsn) {
	// idle: não disputa banda/CPU com a hidratação
	const boot = () =>
		import('@sentry/browser').then((mod) => {
			mod.init({ dsn, environment: env.PUBLIC_SENTRY_ENVIRONMENT || 'production', tracesSampleRate: 0, sendDefaultPii: false });
			sentry = mod;
			fila.splice(0).forEach((f) => f());
		});
	'requestIdleCallback' in window ? requestIdleCallback(() => boot()) : setTimeout(boot, 2000);
}

export const handleError: HandleClientError = ({ error, event, status, message }) => {
	const errorId = crypto.randomUUID().slice(0, 8);
	const capture = () =>
		sentry?.captureException(error, { tags: { errorId, path: event.url.pathname }, extra: { status, message } });
	sentry ? capture() : fila.push(capture);
	return { message: 'Ocorreu um erro inesperado. Tente novamente.', errorId };
};
```

**Ganho medido esperado:** `/login` cai de 159 kB → ~100 kB gz de JS crítico (−37%); todas as outras rotas ganham os mesmos ~60 kB. Trade-off: erros nos primeiros ~1–2 s entram na fila (não se perdem) e `window.onerror` global anterior ao init não é capturado — aceitável dado que o fluxo crítico (assinatura) acontece muito depois da hidratação.

### P-2 · MÉDIO — `background-attachment: fixed` causa jank de scroll em mobile

**Onde:** `src/app.css:26-36` — `body { background-attachment: fixed }` + dois `radial-gradient` no dark mode.

`background-attachment: fixed` desabilita a composição acelerada do fundo: cada frame de scroll repinta o gradiente (e no iOS o valor é simplesmente ignorado/degradado). Num app acessado por smartphone (existe até flag `restringirSmartphone`), isso custa fluidez exatamente onde o usuário mais percebe.

**Correção:** mover o fundo para um pseudo-elemento fixo composto na GPU:

```css
body { background-attachment: scroll; } /* remove o fixed */
.dark body::before {
	content: '';
	position: fixed;
	inset: 0;
	z-index: -1;
	pointer-events: none;
	background-image:
		radial-gradient(circle at top right, oklch(25% 0.05 210deg / 20%), transparent 40%),
		radial-gradient(circle at bottom left, oklch(25% 0.05 260deg / 20%), transparent 40%);
}
```

Mesmo visual, zero repaint por frame.

### P-3 · MÉDIO — Fontes: 8 pesos sem preload do peso crítico

**Onde:** `src/app.css:10-17` (Inter 400/500/600/700/900 + Outfit 500/700/800 = ~180 kB woff2).

O que já está certo: self-hosted, subset latin, `font-display: swap` (verificado no CSS do @fontsource). O problema é a **descoberta tardia**: o browser só descobre os woff2 depois de baixar e parsear o CSS, então o texto renderiza primeiro em fallback e "pisca" no swap.

**Correções:**
1. Preload dos 2 pesos acima da dobra em `src/app.html` (corpo + título):
```html
<link rel="preload" href="caminho-do-inter-latin-400.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="caminho-do-outfit-latin-700.woff2" as="font" type="font/woff2" crossorigin />
```
   Como o hash do arquivo muda por build, a forma robusta é importar o URL no layout raiz: `import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?url'` e emitir o `<link>` via `<svelte:head>`.
2. Avaliar cortar 1–2 pesos de Inter (500 *e* 600 *e* 700 raramente são todos distinguíveis; cada peso ≈ 20–25 kB). Requer conferir o uso real no Tailwind.

### P-4 · MÉDIO — Rotas `/gise/[id]` e `/escalas/[id]` com nodes grandes (modais estáticos)

**Onde:** `nodes/11` = 159 kB raw / 39 kB gz (`/gise/[id]`, 8 modais em `_components/modais/`); `nodes/8` = 113 kB raw / 28 kB gz (`/escalas/[id]`).

Todos os modais (ModalBreveRelatorio, ModalRelatorioDigital, ModalRubrica, ModalFinalizar…) entram no bundle inicial da rota, mas só abrem por ação do usuário.

**Correção (opcional, ganho médio):** importar dinamicamente os 2–3 modais mais pesados quando abertos pela primeira vez:

```svelte
{#if showRelatorio}
	{#await import('./_components/modais/ModalRelatorioDigital.svelte') then { default: Modal }}
		<Modal {...props} />
	{/await}
{/if}
```

Ganho: ~10–20 kB gz no first-load da rota mais pesada do app. Custo: leve atraso (~50–100 ms) na primeira abertura do modal — imperceptível com o chunk já no cache HTTP em aberturas seguintes.

### P-5 · BAIXO — `manualChunks` agrupa todas as máquinas zag-js num chunk único

**Onde:** `vite.config.ts` — `if (id.includes('@skeletonlabs') || id.includes('@zag-js')) return 'skeleton'`.

Uma rota que usa só `Dialog` baixa também combobox (51 kB raw), tabs, steps, pagination, popover, tooltip etc. (chunk de 229 kB raw / 60 kB gz). Em compensação, o chunk é compartilhado e cacheia uma única vez para o app inteiro — para um app interno com usuários recorrentes, o trade-off atual é **defensável**. Se quiser otimizar a primeira visita (ex.: `/login`, `/validar` para público externo), remova a linha do agrupamento e deixe o Rollup separar por máquina. Ganho estimado: ~20–30 kB gz na primeira página; custo: mais requests pequenos (irrelevante em HTTP/2+).

### P-6 · NOTA — `init.js` é um request render-blocking

**Onde:** `src/app.html` → `<script src="/init.js"></script>` (784 bytes, cache 1 h).

É o anti-FOUC do tema — precisa mesmo rodar antes do primeiro paint, e foi movido para arquivo por causa da CSP. Está correto; apenas registre que isso custa 1 RTT no primeiro acesso. Micro-otimização possível: voltar a inline adicionando o hash sha256 do script em `script-src` na CSP (o conteúdo é estático, o hash é estável por deploy). Ganho de ~1 RTT no primeiro acesso; só vale se buscar o último milissegundo do `/login`.

---

## 4. Achados de Performance — Back-end (TTFB)

### B-1 · ALTO — 3 queries D1 sequenciais em todo request autenticado

**Onde:** `src/hooks.server.ts:162` + `src/lib/auth.ts:306-358` + `src/hooks.server.ts:204`.

Sequência por request (antes de qualquer `load()` rodar):

1. `validarSessao` → `SELECT sessoes WHERE token = ?` (indexado ✅)
2. → `SELECT administradores|policiais WHERE id = ?` (depende do resultado de 1)
3. `temAceiteVigente` → `SELECT aceites_termos WHERE …` (indexado ✅, roda na maioria das rotas)

São **3 round-trips D1 em série** (~5–30 ms cada no Worker) = **15–90 ms de TTFB fixo** em todas as páginas e APIs autenticadas. O `calcularHashTermo` já é cacheado em módulo ✅ e o UPDATE de sliding session só roda além do threshold ✅ — o custo é mesmo só as queries.

**Correção em duas camadas:**

1. *Sem mudança de semântica* — paralelizar/batch o que não depende entre si. A query 3 só precisa de `usuario.tipo + usuario.id`, que já existem na linha da **sessão** (query 1). Ou seja, as queries 2 e 3 podem ir juntas num `db.batch()`:
   ```
   RT1: SELECT sessao
   RT2: batch[ SELECT usuario , SELECT aceite ]
   ```
   3 RTs → 2 RTs, −5 a −30 ms por request, sem nenhum risco novo.

2. *Opcional, ganho maior* — cache curtíssimo da sessão validada (Cache API edge, TTL 30–60 s, chave = hash do token), com invalidação explícita no logout (`excluirSessao`). Reduz para ~0 queries de auth na maioria dos requests. **Caveat de segurança:** janela de até 60 s para revogação de sessão/desativação de policial — decisão de produto; o padrão já existe no projeto (`lerPapelGise` TTL 60 s faz exatamente esse trade-off).

### B-2 · ALTO — `/recebidos` carrega a lista inteira sem paginação

**Onde:** `src/routes/recebidos/+page.server.ts:25-35` — `listarEscalas(..., { limit: undefined })`.

Payload e tempo de query crescem linearmente com o histórico do banco — hoje pode estar rápido, daqui a um ano não. O app **já tem** toda a infraestrutura: `PaginationControls.svelte`, padrão de URL `?page=` em `/escalas` e `/produtividade`.

**Correção:** replicar o padrão de `/escalas` (limit 20 + `PaginationControls`). Esforço baixo.

### B-3 · MÉDIO — `/painel`: compliance pesado bloqueia o TTFB e busca unidades 2×

**Onde:** `src/routes/painel/+page.server.ts`.

- `gerarCompliance` faz ~3 awaits sequenciais internos (`listaUnidades` linha 62 → `escalasPeriodo` linha 99 → `docs` linha 108) e depois computa matriz períodos × unidades em loops aninhados.
- `listarUnidades` é chamado de novo no `Promise.all` da linha 233 — **fetch duplicado** da mesma tabela no mesmo request.

**Correções:**
1. Passar `unidadesLista` já buscada para dentro de `gerarCompliance` (elimina 1 query).
2. Paralelizar `escalasPeriodo` + outras queries independentes internas.
3. **Streaming**: devolver `compliance` como promise não-aguardada e renderizar com `{#await}` + `SkeletonCard` (componente já existe). O shell do painel pinta em ~100 ms; o relatório chega quando estiver pronto. É a única página onde streaming do SvelteKit tem ROI claro hoje.

### B-4 · BAIXO — Índice composto para checagem de conflito de plantão

**Onde:** `src/lib/server/escala-conflict.ts:52-56` filtra `WHERE policial_id = ? AND data_plantao = ?`.

Existe `idx_escala_policiais_policial` (só `policial_id`), então **não é** full scan — o SQLite filtra `data_plantao` dentro das linhas do policial. Com histórico longo por policial, um índice composto elimina esse passo:

```sql
CREATE INDEX IF NOT EXISTS idx_escala_policiais_policial_data
  ON escala_policiais(policial_id, data_plantao);
```

Ganho pequeno hoje, cresce com o volume. Aproveite e confira com `EXPLAIN QUERY PLAN` no wrangler.

### B-5 · BAIXO — `/gise/[id]` busca e-mails e anula depois

**Onde:** `src/routes/gise/[id]/+page.server.ts:79-96` — `email`/`email_pessoal` entram no SELECT e são anulados em memória para não-admin.

Funciona, mas o dado pessoal trafega do D1 ao Worker sem necessidade. Mover a condição para a projeção do SELECT (selecionar as colunas só quando `isGeral`) é mais limpo sob a ótica LGPD de minimização — o ganho de performance em si é marginal.

### O que está certo no back-end (manter)

- `db.batch()` em todas as mutações de `/escalas/[id]` (insert/update/delete + refetch em 1 RT) — excelente.
- Bulk insert em chunks de 50 (`escalas/[id]/+page.server.ts:532`).
- `Promise.all` nos loads (`/gise/[id]` com 8 queries paralelas, `/escalas/[id]` com 3).
- Caches edge com TTL e invalidação (`cfg-ass-cache` 5 min, `gise-papel-cache` 60 s).
- Coleta de IDs + `inArray` em vez de N+1 (`escalas-detalhado.ts:180-207`).
- `Cache-Control: private, no-store` como default para respostas autenticadas — correto para segurança; não relaxe.
- Índices: cobertura geral boa (sessões, aceites, audit, escalas, gise) — confirmado nas migrations.

---

## 5. Achados de UX

### U-1 · ALTO — `invalidateAll()` após cada mutação torna ações simples lentas

**Onde (verificado):** `src/routes/escalas/+page.svelte:310` (excluir), `:377` (cancelar solicitação), `:412` (assinatura concluída); `src/routes/escalas/_components/DialogSolicitarAssinatura.svelte:84` (solicitar assinatura).

Cada uma dessas ações refaz **todos** os loads ativos — incluindo o `+layout.server.ts` (flags + papel GISE) e a lista completa — com `LoadingOverlay` bloqueando a tela. Em rede móvel, "excluir uma escala" custa 1–3 s de tela travada. Em contraste, remover policial em `/escalas/[id]:89-94` já usa **atualização local otimista** com rollback — o padrão certo já existe no código.

**Correção:**
1. Nos loads, declarar dependência nomeada: `depends('app:escalas')`.
2. Nas mutações, trocar `invalidateAll()` por `invalidate('app:escalas')` — revalida só a lista, não o layout.
3. Nos casos triviais (excluir da lista), aplicar o mesmo padrão otimista do remover-policial: atualizar o array local primeiro, reverter no erro.

**Ganho:** a ação parece instantânea; o overlay global pode até deixar de ser exibido para essas operações.

### U-2 · MÉDIO — Tabela de servidores ilegível no mobile

**Onde:** `src/routes/escalas/[id]/_components/TabelaServidores.svelte` — `text-[0.7rem] sm:text-xs` (≈11 px).

Nota importante: a alegação de que "a lista de escalas some no mobile" **não procede** — `TabelaEscalas.svelte:313` tem vista em cards (`lg:hidden`) ✅. O problema real é só o corpo da tabela de servidores, com fonte de 11 px e edição via toque em alvos pequenos.

**Correção:** subir para no mínimo `text-xs` (12 px) no mobile e garantir `overflow-x-auto` no wrapper; ou replicar o padrão de cards que a própria `TabelaEscalas` já usa.

### U-3 · MÉDIO — Imagens sem dimensões causam layout shift (CLS)

**Onde:** logos em `/aceitar-termo/+page.svelte`, `/validar/[hash]/+page.svelte`, `/termo/[versao]/+page.svelte`, `/termo/dpo/+page.svelte`.

`<img>` sem `width`/`height` faz o conteúdo "pular" quando a imagem chega — exatamente nas páginas públicas (validação de documento) onde a primeira impressão importa.

**Correção:** adicionar `width` e `height` intrínsecos (o CSS continua controlando o tamanho visual via classe; o atributo só reserva o espaço).

### U-4 · MÉDIO — Busca de destinatário (DPC) com feedback de loading fraco

**Onde:** `src/routes/escalas/_components/DialogSolicitarAssinatura.svelte:212-219`.

Tem debounce de 300 ms ✅ e spinner, mas minúsculo e inline — em rede lenta o usuário digita e acha que não aconteceu nada. O próprio `SearchableSelect.svelte` do projeto já resolve isso melhor (estado "Buscando…" + spinner + erro inline + `AbortController`).

**Correção:** usar o `SearchableSelect` existente nesse dialog, ou copiar seu estado de loading. Verificar também se essa busca manual cancela requests em voo (o `SearchableSelect` cancela ✅; o dialog usa `setTimeout` manual).

### U-5 · BAIXO — `/painel` sem skeleton durante a computação pesada

Cruza com B-3: com streaming + `{#await}` + `SkeletonCard`, o painel ganha tanto TTFB real quanto percepção. Hoje a página fica em branco esperando o compliance inteiro.

### U-6 · BAIXO — Pontos menores de acessibilidade

- Focus-trap dos modais: o `Dialog` do Skeleton (zag-js) já faz trap e restauração de foco por padrão — **nenhuma ação necessária**, apenas registrado.
- Auditar `btn-icon` avulsos sem `aria-label` (a maioria dos verificados tem ✅ — paginação, refresh, nav).
- `loading="lazy"` ausente nas imagens abaixo da dobra (menor, dado que o app quase não tem imagens).

### O que já está excelente em UX (não mexer)

- **Barra de progresso de navegação global** sempre no DOM, excluída da view transition (`+layout.svelte:164-171`) — implementação cuidadosa e rara de se ver correta.
- **View transitions** com `tick()` antes do snapshot e `resolve()` imediato — não atrasa a navegação.
- **Skeleton rows durante navegação** na tabela de escalas (`TabelaEscalas.svelte:104-125`).
- **`data-sveltekit-preload-data="hover"`** no body e nos links da sidebar — navegação começa no hover.
- **Debounce 300 ms + `AbortController` + mínimo de caracteres** no `SearchableSelect` — sem resultados fora de ordem.
- **Proteção contra duplo submit** consistente (botões `disabled` + `LoadingOverlay` com `aria-busy`).
- **Toasts centralizados** com ícones, cores e dismissal.
- **`prefers-reduced-motion`** global, **dark mode sem FOUC** via `init.js`, paginação server-side com scroll suave.

---

## 6. Plano de ação priorizado

### Fase 1 — alto impacto, baixo risco (1–2 dias) — ✅ CONCLUÍDA (ver Status no topo)

1. ~~**Defer do Sentry no client** (P-1)~~ ✅ −29 kB gz medidos no JS crítico de todas as páginas (estimativa original de −60 kB corrigida — ver Status).
2. ~~**Paginação em `/recebidos`** (B-2)~~ ✅ limit 10 + filtros server-side via URL.
3. ~~**Batch usuário+aceite no hooks** (B-1, camada 1)~~ ✅ 3-4 RTs → 2 RTs em todo request.
4. ~~**`width`/`height` nas imagens** (U-3) e **fundo fixo → pseudo-elemento** (P-2)~~ ✅ (pendência residual: brasão do R2 em `/validar*`, proporção não verificável pelo repo).

### Fase 2 — percepção de velocidade (2–4 dias)

5. **`invalidate('app:escalas')` + otimismo local nas mutações de `/escalas`** (U-1).
6. **Preload das 2 fontes críticas** (P-3) e avaliação de corte de pesos.
7. **Streaming + skeleton no `/painel`** (B-3 + U-5), incluindo dedup de `listarUnidades`.
8. **Loading state da busca DPC** (U-4) e fonte mínima de 12 px na tabela de servidores (U-2).

### Fase 3 — refinamento (quando houver folga)

9. Cache curto de sessão no edge (B-1, camada 2 — decidir janela de revogação aceitável).
10. Índice composto `escala_policiais(policial_id, data_plantao)` (B-4).
11. Dynamic import dos modais pesados de `/gise/[id]` (P-4).
12. Projeção condicional de e-mails em `/gise/[id]` (B-5) e revisão do agrupamento do chunk skeleton (P-5).

### Resultado esperado ao fim das fases 1–2

- `/login` primeira visita: ~380 kB → **~300 kB** transferidos; JS crítico −37%.
- TTFB de toda rota autenticada: **−10 a −60 ms** (mais −85% de queries de auth se a fase 3.9 for aceita).
- Mutações do dia a dia (excluir, solicitar, cancelar): de 1–3 s bloqueados → **percepção instantânea**.
- Scroll mobile sem jank; painel pintando o shell em ~100 ms.

---

## Apêndice — como reproduzir as medições

```bash
npm run build                      # gera .svelte-kit/output + bundle-stats.html
npx vite preview                   # servir o build local
# bundle-stats.html (rollup-plugin-visualizer) mostra a atribuição por módulo
# Lighthouse (Chrome DevTools) em /login e /escalas, mobile, Slow 4G, para LCP/CLS/TBT
# wrangler d1 execute <db> --command "EXPLAIN QUERY PLAN <query>" para validar índices
```

Os tamanhos por rota da seção 2.1 vêm de um walk do grafo de imports estáticos sobre `.svelte-kit/output/client/_app/immutable` (entry + nodes + chunks), gzip nível 6 — o mesmo que o usuário baixa na primeira visita sem cache.
