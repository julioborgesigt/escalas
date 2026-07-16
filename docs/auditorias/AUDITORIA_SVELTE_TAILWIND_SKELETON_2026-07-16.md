# Auditoria Svelte/SvelteKit + Tailwind CSS + Skeleton UI — 2026-07-16

> Registro histórico. Escopo: segurança, arquitetura SvelteKit, performance,
> design system (Tailwind/Skeleton), limpeza de código e acessibilidade.
> Nenhuma mudança de código foi aplicada — apenas relatório.

## Parte A — Sumário executivo

### Etapa 0 — Versões e stack detectadas

| Item          | Detectado                                                                 |
| ------------- | ------------------------------------------------------------------------- |
| Svelte        | 5.56.x (runes em todo o código; zero `export let`/`$:`/`writable`)        |
| SvelteKit     | 2.69.x                                                                     |
| Tailwind CSS  | v4 (`@tailwindcss/vite`, sem `tailwind.config.js` — config CSS-first)     |
| Skeleton UI   | v4 (`@skeletonlabs/skeleton` 4.13 + `@skeletonlabs/skeleton-svelte` 4.15) |
| Linguagem     | TypeScript estrito + Zod 4 (schemas em `src/lib/schemas`)                 |
| Adapter/runtime | `@sveltejs/adapter-cloudflare` — Cloudflare Workers/Pages + D1 (Drizzle) + R2 |
| Observabilidade | Sentry (browser + cloudflare), logger próprio com buffer por request     |
| Testes        | Vitest (unit, `src/lib`) + Playwright (E2E)                               |

Mapa de rotas: 32 páginas, 55 endpoints `+server.ts`. Módulos principais:
auth (login + 2FA + certificado ICP-Brasil), escalas (plantão/expediente/FDS),
GISE, produtividade (dashboard), LGPD/auditoria, validação pública de documentos
(`/validar/[hash]`).

Verificação estática executada nesta auditoria: `svelte-check` → **0 erros,
0 warnings** (6449 arquivos); `eslint src/` → **limpo**.

### Notas por categoria (0–10)

| Categoria      | Nota | Comentário |
| -------------- | ---- | ---------- |
| Segurança      | 9.5  | Defesa em camadas exemplar (CSP com nonce, CSRF double-submit timing-safe, cookies httpOnly/strict, guarda origin em /api/auth, headers COOP/COEP/CORP, sanitização server-side do único `{@html}`). Resta um desalinhamento de autorização em form actions de `/escalas` e uma divergência entre caminhos de exclusão. |
| Arquitetura    | 9    | Load server-side com `Promise.all`/streaming, `depends()` segmentado, composables com runes, `$lib/server` bem isolado. |
| Performance    | 8    | Chunking manual criterioso, lazy-load de Chart.js/Sentry, cache de sessão no edge. Um achado real: `/produtividade` agrega apenas a 1ª página de dados. |
| Design System  | 8.5  | Tokens Skeleton (`surface-*`, `preset-*`) usados de forma consistente com variantes dark. Valores arbitrários existentes são majoritariamente legítimos (`min-w-[…]`, `z-[70]`). Cores hex hardcoded nos charts de produtividade não seguem o tema. |
| Limpeza        | 9    | Zero `console.log` em produção, zero código morto evidente, comentários são de contexto (não didáticos). Pequenas duplicações pontuais. |
| A11y           | 8    | `aria-hidden` em ícones, labels associados, `alt` em todas as imagens. Cards expansíveis com `<div onclick>` e warnings suprimidos sem alternativa de teclado são o principal débito. |

### Top 5 problemas

1. **[Alta]** Dashboard `/produtividade` computa estatísticas/rankings/charts
   sobre apenas a primeira página (200 linhas) de respostas — números
   silenciosamente errados quando o total ultrapassa o limite.
2. **[Média]** Form actions `criar`/`excluir` de `/escalas` são menos
   restritivas que o `load` da mesma rota (qualquer policial autenticado da
   lotação pode criar/excluir via POST direto).
3. **[Média]** Action `excluirEscala` do `/painel` exclui a escala sem limpar
   R2/documentos, divergindo dos outros dois caminhos de exclusão.
4. **[Média]** Cards expansíveis de `/auditoria` e `/auditoria/logs` são
   `<div onclick>` sem teclado/role, com warnings de a11y suprimidos.
5. **[Baixa]** Cores hex hardcoded nos gráficos/rankings de `/produtividade`
   fora dos tokens do tema (não adaptam ao dark mode).

---

## Parte B — Achados detalhados

### B-1 · [Alta] Performance/Correção — [Esforço] Médio

**Arquivo:** `src/routes/produtividade/+page.server.ts:22-36` + `src/routes/produtividade/+page.svelte`

**O problema:** o `load` chama `listarTodasRespostasGise(db, { page, mes, ano })`,
que é paginada — `src/lib/db/gise/respostas.ts:643` aplica
`limit = min(500, max(1, opts?.limit ?? 200))`. A página, porém, trata
`data.lista` como o universo completo: todos os filtros (ano, seccional,
período) são estado client-side (`$state`) sem `goto`, e `data.pagination`
retornado pelo load **nunca é consumido** (nenhuma ocorrência de
`pagination`/`goto`/`page=` no `+page.svelte`). Consequência: com mais de 200
respostas acumuladas, stats, rankings e charts passam a refletir só as 200 mais
recentes — o dashboard erra silenciosamente, sem indicação na UI.

**Código atual vs proposto (diff mínimo, sem mudar comportamento da UI):**

```diff
 // src/routes/produtividade/+page.server.ts
-const [resultLista, modeloOpRow, modeloSeintRow, seccionais] = await Promise.all([
-	listarTodasRespostasGise(db, { page, mes, ano }),
+const [primeira, modeloOpRow, modeloSeintRow, seccionais] = await Promise.all([
+	listarTodasRespostasGise(db, { page: 1, limit: 500, mes, ano }),
 	buscarGiseModeloFormulario(db, 'operacional'),
 	buscarGiseModeloFormulario(db, 'seint'),
 	buscarSeccionaisUnidades(db)
 ]);
+// Dashboard agrega o conjunto completo — busca as páginas restantes em paralelo.
+const restantes =
+	primeira.totalPages > 1
+		? await Promise.all(
+				Array.from({ length: primeira.totalPages - 1 }, (_, i) =>
+					listarTodasRespostasGise(db, { page: i + 2, limit: 500, mes, ano })
+				)
+			)
+		: [];
+const respostas = [...primeira.respostas, ...restantes.flatMap((r) => r.respostas)];
```

(e retornar `lista: respostas`). Alternativa melhor a médio prazo (refatoração):
mover a agregação de stats/rankings para o servidor e enviar apenas os
agregados — o payload atual cresce sem teto com o histórico. Enquanto isso, o
campo `pagination` não usado deveria sair do retorno do load (código morto).

---

### B-2 · [Média] Segurança (autorização — defesa em profundidade) — [Esforço] Quick win — *suspeita a confirmar*

**Arquivo:** `src/routes/escalas/+page.server.ts:279-281` (`criar`) e `:367-400` (`excluir`)

**O problema:** o `load` desta rota só admite `admin_seccional`/`admin_unidade`
(linhas 46-51), mas as form actions não replicam o guarda:

- `criar` exige apenas sessão (`if (!u) return fail(401)`), então **qualquer
  policial autenticado** pode criar escala para a própria lotação via POST
  direto (`/escalas?/criar`), fora da UI.
- `excluir` permite exclusão a qualquer policial cuja `lotacao` coincida com a
  da escala — sem exigir papel de administração — enquanto a action irmã
  `criarComBase` (linha 432) valida papel corretamente.

A biblioteca `verificarPermissaoEscala` (`src/lib/server/escala-permissao.ts`)
documenta "mesma lotação → sempre permitido" para **leitura/assinatura**;
exclusão é destrutiva e hoje herda essa permissividade só nesses dois pontos.
Classifico como suspeita a confirmar: pode ser fluxo legado intencional, mas o
padrão do restante do código (painel, recebidos, criarComBase) exige papel.

**Código atual vs proposto:**

```diff
 	criar: async ({ request, locals, platform }) => {
 		const u = locals.usuario;
 		if (!u) return fail(401, { error: 'Não autorizado' });
+		if (u.tipo !== 'admin' && u.papel !== 'admin_seccional' && u.papel !== 'admin_unidade') {
+			return fail(403, { error: 'Sem permissão' });
+		}
```

(mesmo guarda no início de `excluir`, preservando o escopo por lotação já
existente para `admin_seccional`.)

---

### B-3 · [Média] Segurança/Consistência (higiene de dados, LGPD) — [Esforço] Quick win

**Arquivo:** `src/routes/painel/+page.server.ts:263-290`

**O problema:** existem três caminhos de exclusão de escala. Dois deles —
`/recebidos` (`excluir`, linhas 108-116) e `/escalas` (`excluir`, linhas
402-409) — chamam `limparR2DocumentoEscala` + `excluirDocumentoEscala` antes do
`DELETE`, exatamente pelo motivo documentado no próprio código (R2-1: a FK é
`ON DELETE CASCADE`, então sem a limpeza o blob assinado, a cópia de
conferência e a selfie biométrica ficam **órfãos e irrastreáveis no R2**, com
PII forense). O caminho do `/painel` só chama `excluirEscala`. A UI do painel
oferece exclusão apenas para itens `nao_assinada` (que normalmente não têm
documento), mas o servidor não valida isso — um POST com `escala_id` de escala
assinada reproduz exatamente o cenário R2-1 já corrigido nos outros caminhos.

**Código atual vs proposto:**

```diff
 // src/routes/painel/+page.server.ts
-import { getDB, listarUnidades, excluirEscala, ... } from '$lib/db';
+import { getDB, listarUnidades, excluirEscala, excluirDocumentoEscala, getR2, hasR2, ... } from '$lib/db';
+import { limparR2DocumentoEscala } from '$lib/server/r2-cleanup';
 ...
 		const db = getDB(platform);
+		if (hasR2(platform)) {
+			await limparR2DocumentoEscala(db, getR2(platform), escalaId);
+		}
+		await excluirDocumentoEscala(db, escalaId);
 		await excluirEscala(db, escalaId);
```

Ideal (DRY): extrair um helper único `excluirEscalaCompleta(db, platform, id)`
em `$lib/server`, usado pelos três call sites — hoje a lógica está triplicada
e já divergiu uma vez.

---

### B-4 · [Média] A11y — [Esforço] Quick win

**Arquivos:**
- `src/routes/auditoria/+page.svelte:555-560` (e `616-620`)
- `src/routes/auditoria/logs/+page.svelte:305-310` (e `339-344`)

**O problema:** os cards mobile de log expandem via `<div onclick>` com
`cursor-pointer`, e os warnings `a11y_click_events_have_key_events` /
`a11y_no_static_element_interactions` foram suprimidos **sem justificativa e
sem alternativa de teclado** — usuário de teclado/leitor de tela não consegue
expandir os detalhes. (Contraste: as supressões em `ListaFds.svelte:442` e
`TabelaServidores.svelte:214` são acompanhadas de `role`/handlers condicionais,
e a de `login/+page.svelte:452` tem justificativa em comentário — padrão
correto.)

**Código atual vs proposto:**

```diff
-<!-- svelte-ignore a11y_click_events_have_key_events -->
-<!-- svelte-ignore a11y_no_static_element_interactions -->
 <div
 	class="rounded-xl ... cursor-pointer ..."
+	role="button"
+	tabindex="0"
+	aria-expanded={expandido === log.id}
 	onclick={() => (expandido = expandido === log.id ? null : log.id)}
+	onkeydown={(e) => {
+		if (e.key === 'Enter' || e.key === ' ') {
+			e.preventDefault();
+			expandido = expandido === log.id ? null : log.id;
+		}
+	}}
 >
```

O `div` interno com `onclick={(e) => e.stopPropagation()}` (linha 616/339) pode
manter a supressão, mas merece o comentário de justificativa (é só barreira de
propagação, não interação própria).

---

### B-5 · [Baixa] Design System (sincronização de tema) — [Esforço] Médio

**Arquivo:** `src/routes/produtividade/+page.svelte:733, 753, 764, 775, 786, 797` (+ CSS em `888, 919, 923`)

**O problema:** os rankings/detalhamentos e datasets de Chart.js recebem cores
hex literais (`#f43f5e`, `#ef4444`, `#6366f1`), fora dos tokens do tema
Skeleton — os mesmos semânticos existem como `error-500`/`indigo` no tema
ativo. Efeito prático: os blocos não reagem à alternância light/dark e uma
mudança de tema exigirá caça manual. Atenuante consciente: Chart.js e o export
PNG (`export-charts.ts`) precisam de cores concretas em runtime, então o custo
de ler `getComputedStyle(document.documentElement).getPropertyValue('--color-error-500')`
(tokens CSS do Skeleton v4) só se justifica se a paleta divergir do tema. Fica
registrado como dívida de consistência, não como defeito.

**Proposta mínima:** centralizar as cores num objeto único
(`const CORES_CHARTS = { prisoes: '...', drogas: '...', armas: '...' }`) — hoje
cada hex aparece 2×; num segundo passo, derivá-las dos tokens via
`getComputedStyle`.

---

### B-6 · [Baixa] Limpeza/DRY — [Esforço] Quick win

**Ocorrências:**

1. `$effect` do prompt de cadastro de rubrica duplicado byte-a-byte:
   `src/routes/escalas/+page.svelte:303-309` e
   `src/routes/gise/[id]/+page.svelte:407-413` → extrair para
   `$lib/composables` (ex.: `useOfertaRubrica(() => precisaRubrica)`).
2. Ícone de checkmark como SVG inline no card mobile do painel
   (`src/routes/painel/+page.svelte:758-771`) enquanto a tabela desktop usa
   `CheckCircle2` de lucide-svelte (`:644`) — mesma tela, dois padrões.
   Ocorrência análoga em `src/routes/produtividade/+page.svelte:824-830`.
3. Estrutura tabela-desktop + cards-mobile de `/auditoria` e `/auditoria/logs`
   é quase idêntica (dois arquivos ~780/340 linhas) — candidata a componente
   compartilhado em `$lib/components` quando houver mexida nessas telas.

---

## O que foi verificado e está em ordem (para referência futura)

- **XSS:** único `{@html}` do projeto (`termo/[versao]/+page.svelte:43`) recebe
  HTML sanitizado no servidor (`$lib/server/termo/sanitize.ts`).
- **Segredos:** nenhuma chave hardcoded; únicos `PUBLIC_*` são DSN/environment
  do Sentry (públicos por natureza); `wrangler.toml` só tem vars não-secretas.
- **Cookies/sessão:** `session_token` httpOnly + sameSite strict + secure;
  CSRF double-submit com comparação timing-safe; localStorage guarda apenas
  preferências de UI (tema, filtros), nunca tokens.
- **Autorização central:** `hooks.server.ts` valida sessão para tudo que não é
  rota pública; todas as rotas `/api/admin/*` usam `requireAdmin`/superadmin.
- **Estado compartilhado SSR:** caches server-side (sessão, papel GISE, config)
  usam Cache API com chave derivada por SHA-256 do token — sem vazamento entre
  usuários; nenhum estado por usuário em escopo de módulo.
- **Padrões Svelte 5:** 100% runes; zero `export let`, `writable()`, `$:`,
  `onMount`+fetch para dados de load.
- **Erros de API:** zero `return json({ error })` manual; padrão
  `$lib/server/api` seguido em todas as rotas.
- **Fetch no cliente:** único `fetch` cru fora de `$lib/api-fetch`
  (`PainelAssinaturaFDS.svelte:55`) é POST de form action com FormData — a
  exceção documentada no CLAUDE.md.
- **try/catch silenciosos:** todos os `catch {}` inspecionados têm comentário
  de justificativa e fallback são (cache miss → DB, log best-effort etc.).
- **Imagens:** todas com `alt`; libs pesadas (face-api, pdf, office, chart.js,
  Sentry) em chunks dedicados com lazy-load.

## Parte C — Plano de ação

Checklist priorizado:

- [ ] **B-3** (quick win, Média): unificar exclusão de escala num helper com
      limpeza R2 e usá-lo no `/painel`.
- [ ] **B-2** (quick win, Média): replicar o guarda de papel do `load` nas
      actions `criar`/`excluir` de `/escalas` — *confirmar antes se policiais
      comuns devem mesmo poder criar/excluir escalas da própria lotação*.
- [ ] **B-4** (quick win, Média): teclado/role nos cards expansíveis de
      auditoria e logs.
- [ ] **B-1** (médio, Alta): corrigir a agregação truncada de `/produtividade`
      (curto prazo: buscar todas as páginas; médio prazo: agregar no servidor).
- [ ] **B-6.1/6.2** (quick wins, Baixa): extrair composable da rubrica; trocar
      SVGs inline por lucide.
- [ ] **B-5** (médio, Baixa): centralizar cores dos charts e derivar dos tokens.
- [ ] **B-6.3** (refatoração, Baixa): componente compartilhado para as telas de
      auditoria — só quando houver mudança funcional nelas.

Automação (parcialmente já presente):

- Já em uso: `svelte-check`, `eslint-plugin-svelte` (com `--max-warnings 0` no
  CI), `prettier-plugin-svelte`, `knip`, Vitest coverage, Playwright.
- Sugestões incrementais: (1) regra ESLint local proibindo
  `svelte-ignore a11y_*` sem comentário de justificativa na linha seguinte
  (padrão que o repo já pratica nos casos bons); (2) teste E2E de fumaça para
  `/produtividade` com seed > 1 página de respostas, que teria pego o B-1;
  (3) `eslint-plugin-svelte` rule `svelte/no-at-html-tags` já coberta — manter.
