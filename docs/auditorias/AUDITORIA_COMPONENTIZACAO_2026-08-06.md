# Auditoria — componentização e reuso de UI (06/ago/2026)

**Status:** remediação do lote principal **e** P3 cosméticos **feita** (06/ago);
restam só C-MANTER explícitos e split opcional de tabelas painel/recebidos.  
**Objetivo:** facilitar manutenção e compreensão — maximizar componentes comuns
onde o ROI é alto, e **não** unificar o que explode props ou mistura
semânticas de domínio.  
**Escopo:** `src/lib/components/**`, `src/lib/composables/**`,
`src/routes/**/_components/**`, páginas `+page.svelte` / `+layout.svelte`.  
**Fora de escopo:** lógica de servidor, autorização, goldens de PDF/e-mail
(cobertos por outras auditorias abertas).

## Método — verificação em loop

| Passo | Ação | Resultado |
| ----- | ---- | --------- |
| 1 | Inventário glob de `$lib/components` + `**/_components` + composables | 28 + 45 + ~18 |
| 2 | Agentes paralelos (duplicação UI × páginas grandes / classes) | Candidatos ranqueados |
| 3 | Contagem de linhas (`rg` + LiteralPath) nos maiores `.svelte` | Top: `GiseSupervisao` 1028 |
| 4 | Grep de fingerprints (`Array.from length 24/60`, overlay `z-50`, `Limpar filtros`, `ModalShell`, `table-wrap`) | Clusters confirmados |
| 5 | Leitura direta dos P1 (`ModalShell`, `ModalConfirmar`, painel×escalas, `BotoesAcao`×`GiseActionButton`, `conf-ass` switches) | Evidência de drift |
| 6 | Cruzamento com README §10, CLAUDE.md e `AUDITORIA_COMENTARIOS_DUPLICACAO_EXTRACAO_2026-08-06.md` §4 (arquivada — [`docs/HISTORICO.md`](../HISTORICO.md)) | COMP-EXTRAIR / COMP-MANTER alinhados |

**Não executado nesta rodada:** refatorações ou commits — só diagnóstico.  
**2ª passagem (revisão de tarefas):** mesma data — re-grep + leitura dos call
sites; sequência e escopos ajustados em §6 e §10.

## Como ler

| Código | Significado |
| ------ | ----------- |
| C-EXTRAIR | Markup/script candidato a componente ou composable compartilhado |
| C-PROMOVER | Já existe em `_components` de rota; 2+ rotas usam — subir para `$lib` ou pasta de domínio |
| C-FATIAR | Arquivo grande com ≥2 jobs — split local (não necessariamente `$lib`) |
| C-ADOTAR | Componente/composable **já existe** e a rota ainda reimplementa |
| C-MOVER | Convenção de pasta (`_components/`), sem mudar API |
| C-MANTER | Parecido de propósito — **não** extrair às cegas |
| C-SAUDÁVEL | Já componentizado corretamente — não reabrir |

`Sev`: **P0** (a11y/z-index/contrato visual quebrado de forma ativa) · **P1**
(manutenção alta / drift perigoso / página ilegível) · **P2** (ROI médio) ·
**P3** (polimento).

---

## 0. Snapshot do inventário

| Bucket | Qtd | Notas |
| ------ | --: | ----- |
| `$lib/components/**/*.svelte` | **28** | Inclui `bem-vindo/*` (4) |
| Rotas `**/_components/**/*.svelte` | **45** | Escalas / GISE / res-gise / policiais / unidades |
| Módulos `_components` (`.ts` / `.svelte.ts`) | **~6** | `useEdicaoInlineServidor`, `useResGise`, `gise-seccional-estado`, … |
| `$lib/composables` | **~18** | Camada boa: filtros, busca, assinatura, scroll lock |
| `+page.svelte` | **33** | Várias >800 ln sem `_components` |

### 0.1 — Legado Svelte 4

| Padrão | Status |
| ------ | ------ |
| `export let` | **0** |
| `on:click` / `on:submit` | **0** |
| `<slot>` | **0** (snippets) |
| `svelte/store` | **0** em UI |

Dívida de migração Svelte 4→5 em componentes: **fechada**. Foco = estrutura e
reuso, não runes.

### 0.2 — Maiores arquivos Svelte (linhas, 06/ago)

| Ln | Arquivo | Classificação |
| --: | ------- | ------------- |
| 1028 | `gise/[id]/_components/GiseSupervisao.svelte` | **C-FATIAR P1** |
| 941 | `produtividade/+page.svelte` | **C-FATIAR P1** |
| 921 | `+layout.svelte` | C-MANTER (chrome app; já usa `$lib`) |
| 876 | `escalas/+page.svelte` | C-FATIAR P2 (já tem `_components`) |
| 872 | `login/+page.svelte` | **C-FATIAR P1** (0 `_components`) |
| 866 | `painel/+page.svelte` | **C-FATIAR + C-ADOTAR P1** |
| 864 | `gise/[id]/+page.svelte` | C-MANTER como orquestrador (já fatiado) |
| 862 | `policiais/+page.svelte` | **C-FATIAR P1** (modal inline) |
| 834 | `recebidos/+page.svelte` | **C-FATIAR + C-ADOTAR P1** |
| 808 | `auditoria/+page.svelte` | C-FATIAR P2 |
| 749 | `escalas/_components/ModalNovaEscala.svelte` | C-MANTER (wizard; exceção ModalShell) |
| 735 | `escalas/[id]/_components/ListaFds.svelte` | C-EXTRAIR hora (via Seletor) |
| 698 | `$lib/components/SignaturePad.svelte` | C-SAUDÁVEL (já tem composables) |
| 664 | `GiseLoteAssinaturas.svelte` | C-FATIAR P2 se crescer |
| 653 | `TabelaServidores.svelte` | C-EXTRAIR hora |

---

## 1. Mapa do que já está saudável (C-SAUDÁVEL)

Não “componentizar por componentizar”. Estas camadas já concentram o contrato
certo — mudanças futuras devem **passar por elas**, não criar paralelo.

| Peça | Papel | Consumidores (ordem de grandeza) |
| ---- | ----- | -------------------------------: |
| `ModalShell` | Dialog acessível + z-index + pending + famílias | ~17–24 imports |
| `SearchableSelect` | Select async/sync | ~12 |
| `Spinner` / skeletons / `LoadingOverlay` | Loading | layout + listagens |
| `BotaoVoltar` | Navegação de detalhe | 6 |
| `PainelAssinaturaToken` + pad + rubrica | Fluxo certificado | multi-domínio |
| `PainelAssinaturaEscala` → Digital / FDS | Fachadas de domínio | escalas |
| `bem-vindo/*` | Shell de boas-vindas | 4 páginas |
| `Paginador` / `PaginationControls` | Paginação (dois contratos) | listagens |
| `useBuscaDebounce` / `useFiltrosPaginados` / `useConfirmationDialog` | Estado de UI | parcial — ver C-ADOTAR |
| `useEdicaoInlineServidor` + `escala-horarios` | Edição inline escalas | tabelas FDS/plantão |
| `FormularioServico` + rota `relatorio/[giseId]` | README §10 (modal vs rota) | res-gise |

**Assinatura:** não fundir `PainelAssinaturaDigital` / `FDS` / `Token` / `Escala`.
São fluxos legais/dispositivo diferentes já fatiados de propósito.

---

## 2. Achados — extrair / adotar / fatiar

### 2.1 — C-ADOTAR / C-EXTRAIR · P1 · Confirmações e `ModalShell`

**Problema:** README §10 manda código novo por `ModalShell`. Escalas listagem já
migrou; painel / recebidos / policiais / vários modais GISE ainda montam o
overlay à mão — mesmo fingerprint de classes.

**Fingerprint (7+ arquivos):**

```text
fixed inset-0 z-50 flex items-center justify-center p-4
bg-surface-950/80 backdrop-blur-sm overflow-y-auto
```

**Evidência lado a lado:**

- Bom: `escalas/+page.svelte` ~L560 — `<ModalShell title="Excluir Escala?" …>`
- Drift (migrar): `painel` ~L540, `recebidos` ~L794, `policiais` delete ~L575
- Drift (migrar): `ModalReabrir`, `ModalRemoverSeccional`, `ModalFinalizar`
- **Cuidado:** `policiais` ~L336 é **cadastro** (overlay cru) — extrair modal,
  não tratar como confirm (§2.3 / tarefa 4)
- **C-MANTER / migrar só com children ricos:** `ModalExcluirGise` (fetch de
  impacto async — cabeçalho do arquivo explica o porquê)
- Adapter local: `escalas/[id]/_components/ModalConfirmar.svelte` → promover

**Também:** `confirm()` nativo ainda em `GiseSupervisao` ~L349 e `perfil` ~L89.
(`SignaturePad.confirm` é método interno — ignorar no grep.)

**Ação:** ver lote A em §6 (lista fechada de migração).

---

### 2.2 — C-EXTRAIR · P1 · `SeletorHoraMinuto` (+ constantes)

**Problema:** pares `<select>` hora/minuto idênticos; arrays `Array.from({ length: 24|60 })`
recriados; rótulo `{h}h` repetido em 5+ UIs — drift de estilo latente.

| Onde gera `horas`/`minutos` | Onde renderiza `{#each horas}` |
| --------------------------- | ------------------------------ |
| `ModalNovaEscala.svelte` L30–31 | L515+ |
| `FormAdicionarServidores.svelte` L63–64 | L422+ |
| `escalas/[id]/+page.svelte` L51–52 (passa props) | `ListaFds`, `TabelaServidores`, `ModalEditarPlantao` |

**Destino:** `$lib/components/SeletorHoraMinuto.svelte` + `HORAS`/`MINUTOS` em
`$lib/utils/` ou módulo de domínio escalas (se quiser evitar `$lib` poluído —
ainda assim **uma** fonte).

**Esforço:** S–M. ROI máximo desta auditoria.

---

### 2.3 — C-FATIAR · P1 · Páginas / componentes ilegíveis

| Alvo | Ln | Split sugerido |
| ---- | --: | -------------- |
| `GiseSupervisao.svelte` | 1028 | Designação · rodagem · documentos (+ trocar `confirm`) |
| `login/+page.svelte` | 872 | `login/_components/` por fluxo (admin / policial / recovery / cert) — **fluxos separados**, não um mega-form |
| `produtividade/+page.svelte` | 941 | `useProdutividade.svelte.ts` + seções chart/ranking |
| `policiais/+page.svelte` | 862 | `ModalCadastrarPolicial` → `_components/` (espelha unidades) |
| `painel/+page.svelte` | 866 | Filtros + tabela compliance + confirm → `_components/` |
| `recebidos/+page.svelte` | 834 | Idem (página-irmã do painel) |

Critério de sucesso: página vira orquestração (<~400 ln de script+markup de
cola); jobs nomeados em arquivos com cabeçalho.

---

### 2.4 — C-ADOTAR · P1/P2 · Composables e componentes existentes

| Já existe | Quem usa | Quem reimplementa | Revisão |
| --------- | -------- | ----------------- | ------- |
| `useFiltrosPaginados` | escalas, policiais, unidades | **recebidos** (URL+query+LS à mão — encaixe natural) | **Adotar em recebidos** |
| idem | — | **painel** (filtro majoritariamente **cliente** + streaming; LS de filtros ≠ `compliance_ignorados`) | Adotar só persistência opcional; **não** forçar query |
| `ModalShell` | escalas, unidades, assinatura, vários GISE | confirms listados em §2.1 | Lote A |
| `ToggleSwitch` | policiais | **`conf-ass`** — 4× switch custom em `primary-500` (componente usa `success-500`) | Estender cor ou aceitar `success` |
| `Paginador` | listagens | `HistoricoServidor` | **Baixar** — ROI baixo (lista client) |
| `useConfirmationDialog` | policiais, escalas/[id] | painel/recebidos estado ad-hoc | Adotar junto do ModalShell |

Adotar > inventar `FilterBar` universal (props explodem — §3).

---

### 2.5 — C-EXTRAIR · P2 · Chrome de listagem

| Padrão | Arquivos | Destino |
| ------ | -------- | ------- |
| Botão “Limpar filtros” + `temFiltros ? warning : outlined opacity-40` | escalas, policiais, unidades, recebidos, painel, `SecaoHistorico` | `$lib/components/BotaoLimparFiltros.svelte` **ou** snippet exportado |
| Empty state `text-center py-12 text-surface-600…` | TabelaEscalas, TabelaPlantao, policiais, escalas/[id] ×2 | `$lib/components/EstadoVazio.svelte` (só listagens) |
| Snippet `kpi` byte-igual | `auditoria/+page` ~L249 e `logs/+page` ~L99 | `auditoria/_components/KpiCard.svelte` |
| Badges tipo/status desktop↔mobile | `TabelaEscalas` | snippets/`BadgeTipoEscala` locais |
| Banner erro auth | login / alterar-senha / redefinir-senha | `_components` de auth ou `$lib` fino |

---

### 2.6 — C-MANTER (revisado) · Botões de ação GISE × res-gise

| Peça | Forma | Drift já existente |
| ---- | ----- | ------------------ |
| `GiseActionButton.svelte` | Componente `$props` | `rounded-lg font-semibold`; suporte a `href` + `pendingCrud` |
| `res-gise/.../BotoesAcao.svelte` | Snippets `<script module>` | `rounded-xl font-bold`; texto “Carregando...” no label |

**Decisão revisada:** C-MANTER + documentar o espelhamento nos dois cabeçalhos.
Unificar em `$lib` só se alguém for mudar o visual dos dois de propósito
(P3 opcional) — hoje o risco de regressão supera o ganho.

---

### 2.7 — C-MOVER · P3 · Convenção de pasta

| Arquivo | Problema | Ação |
| ------- | -------- | ---- |
| `perfil/ModalAlterarEmailPessoal.svelte` | Ao lado da página, fora de `_components/` | Mover para `perfil/_components/` (CLAUDE.md) |

Não promover para `$lib`.

---

### 2.8 — Tabelas — sem `Table` genérico (de propósito)

Padrão repetido em 10+ arquivos:

```html
<div class="hidden md:block table-wrap …"><table class="table">…</table></div>
<div class="md:hidden space-y-3">…cards…</div>
```

**Não** extrair um `DataTable` genérico agora: colunas, ações e cards mobile são
domínio. O que vale:

- Skeleton já compartilhado (`SkeletonTableRows`)
- Badges / empty / filtros (acima)
- Manter `_components` por rota (`TabelaEscalas`, `TabelaServidores`, …)

---

## 3. C-MANTER — explicitamente não unificar

| Padrão | Motivo |
| ------ | ------ |
| Grades de calendário (4) — `CalendarioSelecaoDias`, inline Nova Escala, Criar GISE, DatasHoras | Semânticas diferentes (multi-dia, FDS, feriado por dia, single-day). CLAUDE.md + auditoria de duplicação §4.2. Compartilhar só `MESES_PT` / `DIAS_SEMANA_CURTO` / `isoData` |
| `Paginador` × `PaginationControls` | Contratos diferentes (só botões vs contador+scroll) — cabeçalho de `Paginador` documenta |
| Exceções `ModalShell`: `ModalNovaEscala`, `ModalDatasHoras`, `ModalBreveRelatorio`, `ModalCriarGise`, `ModalDownloadExtras`, logout `z-[100]`, `DialogInfo`, máquina RH de `PainelAcoesServidor`, `ConfigurarFormulario` | Interação / altura / empilhamento — registrar no arquivo, não forçar shell |
| `ModalExcluirGise` (por enquanto) | Conteúdo async de impacto; migrar só preservando o fetch — não é confirm de 2 botões |
| `GiseActionButton` × `BotoesAcao` | Drift visual já existe (`rounded-lg`/`semibold` vs `rounded-xl`/`bold`) — documentar, não unificar às cegas |
| Quatro fluxos em `login/+page` | UX + não vazar existência de matrícula — fatiar por fluxo, não fundir |
| `TabelaPlantao` / `TabelaServidores` / `ListaFds` | Estruturas de domínio diferentes; helpers de edição já compartilhados |
| Escalas tables × GISE cards de equipe | Domínios espelhados, modelos de interação distintos |
| `PainelAssinatura*` | Variantes legais/dispositivo |
| FilterBar mega-componente | Preferir `useFiltrosPaginados` + UI local |
| `+layout.svelte` (~921) | Chrome único; não “fatiar por fatiar” sem ganho de teste |

---

## 4. Inventário `$lib/components` — propósito e consumidores

| Componente | Propósito | Consumo | Nota |
| ---------- | --------- | ------: | ---- |
| `ModalShell` | Primitive de diálogo | alto | **Aumentar adoção** (§2.1) |
| `SearchableSelect` | Select com busca | alto | C-SAUDÁVEL |
| `Spinner` | Spinner inline | alto | C-SAUDÁVEL |
| `Skeleton*` | Skeletons same-path | médio | C-SAUDÁVEL |
| `BotaoVoltar` | Voltar | médio | C-SAUDÁVEL |
| `IconTooltip` | Ícone + tooltip | médio | C-SAUDÁVEL |
| `SignaturePad` | Assinatura tela + liveness | médio | C-SAUDÁVEL (grande, mas justificado) |
| `PainelAssinaturaToken` | Botão/fluxo A3 | médio | C-SAUDÁVEL |
| `ModalCadastrarRubrica` | Cadastro rubrica | médio | C-SAUDÁVEL |
| `bem-vindo/*` | Shell boas-vindas | 4 páginas | C-SAUDÁVEL |
| `Paginador` / `PaginationControls` | Paginação | médio | C-MANTER pair |
| `CodigoTimer` | OTP | 3 | C-SAUDÁVEL |
| `CamposNovaSenha` | Força de senha | 2 | C-SAUDÁVEL |
| `DialogSolicitarAssinatura` | Pedir assinatura DPC | 2 | C-SAUDÁVEL |
| `FloatingRefresh` | FAB invalidate | 2 | C-SAUDÁVEL |
| `ToggleSwitch` | Switch | só policiais | Adotar em `conf-ass` |
| `LoadingOverlay` / `AvisoCadastroRubrica` | Globais no layout | 1 (layout) | C-SAUDÁVEL |
| `PainelAssinaturaEscala/Digital/FDS` | Fachadas escalas | 1 cadeia | C-SAUDÁVEL |

Nada crítico “promovido demais” para `$lib` por engano. `ToggleSwitch` é o
único borderline single-domain — manter se `conf-ass` passar a usá-lo.

---

## 5. `_components` por domínio — privado vs candidato

| Domínio | Ficar privado | Candidato a subir / compartilhar |
| ------- | ------------- | -------------------------------- |
| `escalas/[id]` | Tabelas, ListaFds, forms, cabecalho, calendário | Hora/minuto → `$lib`; `ModalConfirmar` → `$lib` |
| `escalas/` | ModalNovaEscala, TabelaEscalas, SecaoAssinaturas | Badges internos |
| `gise/[id]` | Supervisão, Seccional, Equipe, Slot, Lote, modais | Confirms → ModalShell; ActionButton alinhamento |
| `gise/` | Card ativa, histórico, criar, DialogInfo | — |
| `res-gise/` | Formulario, Relatorio, Configurar, useResGise | BotoesAcao ↔ GiseActionButton |
| `policiais/[id]` | PainelAcoes, Historico | Paginador no histórico |
| `unidades/` | Cadastrar / Desativar | Já usam ModalShell — referência |

---

## 6. Sequência recomendada (revisada — ROI × risco)

> Status por tarefa após 2ª passagem: ver **§10**.

### Lote A — mecânico, baixo risco, alto retorno (1 PR)

1. **`SeletorHoraMinuto` + HORAS/MINUTOS** — 3 geradores + renders em ListaFds/TabelaServidores/ModalEditarPlantao  
2. **Confirms simples → `ModalShell` / `ConfirmDialog`** — painel, recebidos, policiais (delete), `ModalReabrir`, `ModalRemoverSeccional`, `ModalFinalizar`  
   - *Não* nesta leva: `ModalExcluirGise` (conteúdo async), wizards, `PainelAcoesServidor`, `ConfigurarFormulario`  
3. **`confirm()` → modal** — só `GiseSupervisao` L349 e `perfil` L89 (`SignaturePad.confirm` é método, não `window.confirm`)

### Lote B — compreensão (1–2 PRs)

4. Extrair `ModalCadastrarPolicial` (overlay ~L336 de `policiais/+page` — cadastro, não confirm)  
5. Split `GiseSupervisao` (designação · rodagem · documentos)  
6. `login/_components/*` por fluxo (já documentado no cabeçalho da página)  
7. `useProdutividade.svelte.ts` (+ seções de chart/ranking se couber no mesmo PR)  
8. **recebidos:** adotar `useFiltrosPaginados` (encaixe natural: URL + query + localStorage) **e** extrair confirm/`_components`  
9. **painel:** extrair `_components` + migrar confirm; `useFiltrosPaginados` só se for persistência sem query — **não** forçar o mesmo molde de recebidos (`compliance_ignorados` fica separado)

### Lote C — chrome (P2/P3; pode ir junto do B)

10. `BotaoLimparFiltros` (6 sites) — priorizar sobre `EstadoVazio`  
11. `ToggleSwitch` em `conf-ass` — **estender** com variante de cor (`primary` vs `success` atual do componente) ou aceitar unificar em `success`  
12. `auditoria/_components/KpiCard`  
13. Badges `TabelaEscalas` (desktop↔mobile)  
14. Mover `perfil/ModalAlterarEmailPessoal` → `_components/`  
15. ActionButton GISE ↔ res-gise → **C-MANTER + documentar** (já divergiram visualmente; unificar é P3 opcional)

### Lote D — não fazer nesta onda

- Mega-calendário / `DataTable` genérico / fundir painéis de assinatura / fundir fluxos de login / FilterBar universal  
- Unificar `ModalExcluirGise` à força sem preservar contagem de impacto  
- `HistoricoServidor` → `Paginador` (paginação client de lista pequena — ROI baixo)  
- Banner erro auth (3 sites) — só se passar por login/`_components` no lote B  

---

## 7. Métricas-alvo (próxima medição)

| Métrica | Hoje (06/ago, revalidado) | Alvo pós lote A–B |
| ------- | ------------------------: | ----------------: |
| Arquivos Svelte ≥900 ln | 3 (`GiseSupervisao`, produtividade, layout) | ≤1 (só layout se justificado) |
| `+page.svelte` ≥800 ln sem `_components` de peso | login, painel, recebidos, policiais (modal), produtividade | 0 |
| Confirms simples ainda com Dialog cru | painel, recebidos, policiais delete, 3 modais GISE | 0 |
| `Array.from({ length: 24\|60 })` para selects de hora | 3 geradores | 1 módulo |
| `window.confirm` / `confirm(` nativo em UI | 2 | 0 |
| `conf-ass` switches custom | 4 | 0 (`ToggleSwitch`) |
| `useFiltrosPaginados` em listagens URL-driven | 3 (escalas/policiais/unidades) | **+recebidos** (painel opcional) |

Comando útil para revalidar tamanhos:

```bash
# PowerShell: caminhos com [id] exigem -LiteralPath
rg --files -g "*.svelte" src | % { ... }
```

---

## 8. Relação com outras auditorias abertas

| Documento | Sobreposição |
| --------- | ------------ |
| `AUDITORIA_COMENTARIOS_DUPLICACAO_EXTRACAO_2026-08-06.md` §4 (arquivada — [`docs/HISTORICO.md`](../HISTORICO.md)) | Mesmos COMP-EXTRAIR (hora, ModalShell, GiseSupervisao, …) — esta auditoria **aprofunda** inventário, métricas e C-MANTER de UI |
| [`AUDITORIA_FLUXOS_AUTORIZACAO_2026-08-06.md`](./AUDITORIA_FLUXOS_AUTORIZACAO_2026-08-06.md) | Não misturar: fatiar UI não altera guards de servidor |
| README §10 / CLAUDE.md | Fonte de verdade visual e regra “extrair antes de comentar” / calendários |

Ao fechar esta auditoria (achados resolvidos ou aceitos), remover o arquivo do
working tree e catalogar em [`docs/HISTORICO.md`](../HISTORICO.md).

---

## 9. Veredito

A base compartilhada (**ModalShell, SearchableSelect, assinatura, skeletons,
bem-vindo, composables**) já é forte. O ganho de manutenção não está em mais
abstração de calendário/assinatura — está em:

1. **Adotar o que já existe** (ModalShell, ToggleSwitch, `useFiltrosPaginados` em **recebidos**);  
2. **Extrair duplicação mecânica** (hora/minuto, confirms simples, limpar filtros);  
3. **Fatiar arquivos >800–1000 ln** para um job por arquivo.

Zero P0 de componentização. P1s são drift e compreensão — PRs pequenos.

---

## 10. Revisão das tarefas (2ª passagem — 06/ago; remediação na mesma data)

Revalidação + execução da ordem acordada (Fases 1–5). Status abaixo reflete
o working tree após a remediação.

| # | Tarefa (lote) | Sev | Status revisão | Nota |
| - | ------------- | --- | -------------- | ---- |
| 1 | `SeletorHoraMinuto` + constantes | P1 | **FEITO 06/ago** | Call sites ListaFds / TabelaServidores / ModalEditarPlantao / Form / ModalNova — props `horas`/`minutos` removidos da árvore |
| 2 | Confirms → ModalShell | P1 | **FEITO 06/ago** | painel, recebidos, policiais delete, ModalReabrir/Remover/Finalizar |
| 3 | `confirm()` → modal | P1 | **FEITO 06/ago** | GiseSupervisao + perfil (rubrica) |
| 4 | `ModalCadastrarPolicial` | P1 | **FEITO 06/ago** | `policiais/_components/ModalCadastrarPolicial.svelte` |
| 5 | Split `GiseSupervisao` | P1 | **FEITO 06/ago** | Facade ~133 ln + `supervisao/*` (designação/docs/papéis) |
| 6 | `login/_components/*` | P1 | **FEITO 06/ago** | FormCredenciais / 2FA / PrimeiroAcesso / RecuperacaoSenha |
| 7 | `useProdutividade` | P1 | **FEITO 06/ago** | `useProdutividade.svelte.ts` + seções ranking/gráficos; page ~310 ln |
| 8a | recebidos + `useFiltrosPaginados` | P1 | **FEITO 06/ago** | URL + debounce unidade + restore 1ª visita preservados |
| 8b | painel + `useFiltrosPaginados` | P2 | **BAIXADO** | Filtro cliente + streaming; confirm → ModalShell feito |
| 9 | painel/recebidos `_components` | P1 | **PARCIAL / 4B** | Confirms no ModalShell; split de tabelas **não** seguir (decisão 06/ago) |
| 10 | `BotaoLimparFiltros` | P2 | **FEITO 06/ago** | 6 sites + SecaoHistorico |
| 10b | `EstadoVazio` | P3 | **FEITO 06/ago** | `$lib/components/EstadoVazio.svelte` + 6 call sites |
| 11 | `ToggleSwitch` em `conf-ass` | P2 | **FEITO 06/ago** | `cor="primary"` no componente + 4 switches |
| 12 | `KpiCard` auditoria/logs | P3 | **FEITO 06/ago** | `auditoria/_components/KpiCard.svelte` |
| 13 | Badges `TabelaEscalas` | P2 | **FEITO 06/ago** | `BadgeTipoEscala` / `BadgeStatusEscala` com `tamanho` |
| 14 | Mover modal e-mail perfil | P3 | **FEITO 06/ago** | `perfil/_components/ModalAlterarEmailPessoal.svelte` |
| 15 | Unificar ActionButton | P3 | **REJEITADO → C-MANTER** | Documentado nos cabeçalhos de `GiseActionButton` e `BotoesAcao` |
| — | Banner erro auth | P3 | **ADIADO** | 3 sites; aproveitar se login for fatiado |
| — | `HistoricoServidor` → Paginador | P3 | **REJEITADO** | Paginação client pequena; ROI baixo |
| — | `ModalExcluirGise` → ModalShell | P2 | **FEITO 12/ago** | Shell com children; fetch de impacto preservado |
| — | C-MANTER calendários / assinatura / DataTable / FilterBar | — | **CONFIRMADO** | Sem mudança |

### Checklist rápido pós-implementação (quando houver PR)

```text
[x] Nenhum Array.from({ length: 24|60 }) fora do módulo de constantes
[x] painel/recebidos/policiais delete / ModalReabrir|Remover|Finalizar usam ModalShell
[x] confirm( nativo = 0 em routes (exceto nomes de método)
[x] recebidos usa useFiltrosPaginados
[x] GiseSupervisao < ~400 ln por arquivo após split
[x] login tem _components por fluxo
[x] conf-ass usa ToggleSwitch (com cor acordada)
[x] perfil/ModalAlterarEmailPessoal sob _components/
[x] ActionButtons: cabeçalhos documentam C-MANTER (se não unificados)
```
